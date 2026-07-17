import { adminClient, authenticatedUser, enforceRateLimit } from "../_shared/auth.ts";
import { chromeWebStoreUrl } from "../_shared/config.ts";
import { serve } from "../_shared/handler.ts";
import { jsonResponse, requirePost } from "../_shared/http.ts";

interface PlanRelation {
  key: string;
  name: string;
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "access-status", 120, 3_600);

  const admin = adminClient();
  const now = new Date().toISOString();
  const [{ data: grants, error: grantsError }, { data: subscription, error: subscriptionError }] = await Promise.all([
    admin.from("entitlement_grants")
      .select("source,expires_at,created_at,plans(key,name)")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("created_at", { ascending: false }),
    admin.from("subscriptions")
      .select("status,current_period_end,cancel_at_period_end,provider_subscription_id,plans(key,name)")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing", "past_due"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (grantsError || subscriptionError) throw new Error("Could not load access status");

  const nonSubscriptionGrant = grants?.find((grant) => grant.source !== "subscription") ?? null;
  const subscriptionGrant = grants?.find((grant) => grant.source === "subscription") ?? null;
  const { data: confirmedPayment } = subscription?.provider_subscription_id
    ? await admin.from("payment_events")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider_subscription_id", subscription.provider_subscription_id)
      .in("event_type", ["checkout.session.completed", "invoice.paid"])
      .gt("amount_minor", 0)
      .limit(1)
      .maybeSingle()
    : { data: null };

  const paidAccess = subscription?.status === "active" && Boolean(subscriptionGrant) && Boolean(confirmedPayment);
  const selectedGrant = nonSubscriptionGrant ?? (paidAccess ? subscriptionGrant : null);
  const rawPlan = relation<PlanRelation>(paidAccess ? subscription?.plans : selectedGrant?.plans);
  const active = Boolean(selectedGrant);

  return jsonResponse(request, {
    active,
    plan: rawPlan ? { key: rawPlan.key, name: rawPlan.name } : null,
    source: selectedGrant?.source ?? null,
    expiresAt: paidAccess ? subscription?.current_period_end ?? null : selectedGrant?.expires_at ?? null,
    billing: subscription ? {
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      paymentConfirmed: Boolean(confirmedPayment),
    } : null,
    installUrl: active ? chromeWebStoreUrl() : null,
    checkedAt: now,
  });
});
