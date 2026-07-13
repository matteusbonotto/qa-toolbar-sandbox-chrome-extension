import { z } from "npm:zod@4.4.3";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const requestSchema = z.object({ installationId: z.string().uuid() }).strict();

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "billing-status", 120, 3600);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");

  const admin = adminClient();
  const { data: installation, error: installationError } = await admin.from("installations")
    .select("id, revoked_at").eq("id", parsed.data.installationId).eq("user_id", user.id).maybeSingle();
  if (installationError || !installation || installation.revoked_at) throw new ApiError(403, "installation_not_active");

  const now = new Date().toISOString();
  const [{ data: subscription }, { data: grants }, { data: overrides }, { data: referral }] = await Promise.all([
    admin.from("subscriptions").select("status,current_period_end,cancel_at_period_end,plans(key,name)")
      .eq("user_id", user.id).in("status", ["active", "trialing", "past_due"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("entitlement_grants").select("source,expires_at,plans(key,name)")
      .eq("user_id", user.id).is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${now}`).order("expires_at", { ascending: false }),
    admin.from("entitlement_overrides").select("value,expires_at,features(key)")
      .eq("user_id", user.id).is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${now}`),
    admin.from("referral_profiles").select("code,qualified_referrals").eq("user_id", user.id).maybeSingle(),
  ]);

  const trialGrant = grants?.find((entry) => entry.source === "trial");
  const planRelation = trialGrant?.plans ?? subscription?.plans;
  const relatedPlan = Array.isArray(planRelation) ? planRelation[0] : planRelation;
  const plan = relatedPlan ? { key: relatedPlan.key, name: relatedPlan.name } : { key: "free", name: "Starter" };
  const planKey = plan.key;
  const { data: planRow } = await admin.from("plans").select("id").eq("key", planKey ?? "free").single();
  const { data: featureRows } = planRow ? await admin.from("plan_features").select("value,features(key)").eq("plan_id", planRow.id) : { data: [] };
  const features = Object.fromEntries((featureRows ?? []).flatMap((entry) => {
    const feature = Array.isArray(entry.features) ? entry.features[0] : entry.features;
    return feature?.key ? [[feature.key, entry.value]] : [];
  }));
  const trialEnd = trialGrant?.expires_at ?? null;
  const daysRemaining = trialEnd ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86_400_000)) : 0;
  return jsonResponse(request, {
    plan,
    subscription: subscription ? {
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    } : null,
    overrides: (overrides ?? []).map((entry) => ({
      feature: entry.features,
      value: entry.value,
      expiresAt: entry.expires_at,
    })),
    features,
    trial: { active: Boolean(trialGrant), endsAt: trialEnd, daysRemaining },
    referral: { code: referral?.code ?? null, qualified: referral?.qualified_referrals ?? 0 },
    checkedAt: now,
  });
});
