import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.3";
import { selectBestEntitlement, type EntitlementCandidate } from "./entitlements.ts";

// The single place that decides which plan/features a user currently has. access-status signs the
// result for the extension; other functions (multi-tester) call this directly so a feature gate can
// never drift from what access-status reports.

interface PlanRelation { id: string; key: string; name: string; }
interface FeatureRelation { key: string; }
interface GrantRow {
  source: string;
  expires_at: string | null;
  created_at: string;
  plans: PlanRelation | PlanRelation[] | null;
}

export interface SubscriptionSummary {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider_subscription_id: string | null;
}

export interface ResolvedAccess {
  selectedGrant: EntitlementCandidate | null;
  features: Record<string, boolean | number | string>;
  subscription: SubscriptionSummary | null;
  confirmedPayment: boolean;
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function resolveAccess(admin: SupabaseClient, userId: string, now = new Date().toISOString()): Promise<ResolvedAccess> {
  const [{ data: grants, error: grantsError }, { data: subscription, error: subscriptionError }] = await Promise.all([
    admin.from("entitlement_grants")
      .select("source,expires_at,created_at,plans(id,key,name)")
      .eq("user_id", userId).is("revoked_at", null).lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`).order("created_at", { ascending: false }),
    admin.from("subscriptions")
      .select("status,current_period_end,cancel_at_period_end,provider_subscription_id,plans(id,key,name)")
      .eq("user_id", userId).in("status", ["active", "trialing", "past_due"])
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (grantsError || subscriptionError) throw new Error("Could not load access status");

  const grantRows = (grants ?? []) as GrantRow[];
  const subscriptionGrant = grantRows.find((grant) => grant.source === "subscription") ?? null;
  const { data: confirmedPayment } = subscription?.provider_subscription_id
    ? await admin.from("payment_events").select("id").eq("user_id", userId)
      .eq("provider_subscription_id", subscription.provider_subscription_id)
      .in("event_type", ["checkout.session.completed", "invoice.paid"])
      .gt("amount_minor", 0).limit(1).maybeSingle()
    : { data: null };
  const paidAccess = subscription?.status === "active" && Boolean(subscriptionGrant) && Boolean(confirmedPayment);
  const eligibleGrants = grantRows.filter((grant) => grant.source !== "subscription" || paidAccess);
  const planIds = [...new Set(eligibleGrants.map((grant) => relation<PlanRelation>(grant.plans)?.id)
    .filter((planId): planId is string => Boolean(planId)))];
  const featuresByPlan = new Map<string, Record<string, boolean | number | string>>();

  if (planIds.length) {
    const { data: rows, error } = await admin.from("plan_features")
      .select("plan_id,value,features(key)").in("plan_id", planIds);
    if (error) throw new Error("Could not load plan features");
    for (const row of rows ?? []) {
      const key = relation<FeatureRelation>(row.features as FeatureRelation | FeatureRelation[] | null)?.key;
      if (!key) continue;
      const values = featuresByPlan.get(row.plan_id) ?? {};
      values[key] = row.value as boolean | number | string;
      featuresByPlan.set(row.plan_id, values);
    }
  }

  const candidates: EntitlementCandidate[] = eligibleGrants.map((grant) => {
    const plan = grant.source === "subscription" && paidAccess
      ? relation<PlanRelation>(subscription?.plans as PlanRelation | PlanRelation[] | null)
      : relation<PlanRelation>(grant.plans);
    return {
      source: grant.source,
      expiresAt: grant.source === "subscription" && paidAccess
        ? subscription?.current_period_end ?? grant.expires_at
        : grant.expires_at,
      createdAt: grant.created_at,
      plan,
      features: plan ? featuresByPlan.get(plan.id) ?? {} : {},
      unrestricted: !plan,
    };
  });
  const selectedGrant = selectBestEntitlement(candidates);
  const features: Record<string, boolean | number | string> = { ...selectedGrant?.features };
  if (selectedGrant?.unrestricted) {
    const { data: rows, error } = await admin.from("features").select("key").eq("value_type", "boolean");
    if (error) throw new Error("Could not load features");
    for (const row of rows ?? []) features[row.key] = true;
  }
  return {
    selectedGrant,
    features,
    subscription: subscription ? {
      status: subscription.status,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      provider_subscription_id: subscription.provider_subscription_id,
    } : null,
    confirmedPayment: Boolean(confirmedPayment),
  };
}
