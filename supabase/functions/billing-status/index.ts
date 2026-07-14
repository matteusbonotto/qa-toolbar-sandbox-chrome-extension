import { z } from "npm:zod@4.4.3";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";
import { serverConfig } from "../_shared/config.ts";
import { signOfflineEntitlement } from "../_shared/offline-token.ts";

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
  const [{ data: subscription }, { data: grants }, { data: overrides }, { data: referral }, { data: flags }] = await Promise.all([
    admin.from("subscriptions").select("status,current_period_end,cancel_at_period_end,provider_subscription_id,plans(key,name)")
      .eq("user_id", user.id).in("status", ["active", "trialing", "past_due"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("entitlement_grants").select("source,expires_at,plans(key,name)")
      .eq("user_id", user.id).is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${now}`).order("expires_at", { ascending: false }),
    admin.from("entitlement_overrides").select("value,expires_at,features(key)")
      .eq("user_id", user.id).is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${now}`),
    admin.from("referral_profiles").select("code,qualified_referrals").eq("user_id", user.id).maybeSingle(),
    admin.from("feature_flags").select("key,enabled,config"),
  ]);

  const trialGrant = grants?.find((entry) => entry.source === "trial");
  const accessGrant = grants?.find((entry) => entry.source !== "trial") ?? trialGrant;
  const { data: confirmedPayment } = subscription?.provider_subscription_id
    ? await admin.from("payment_events").select("id")
      .eq("user_id", user.id)
      .eq("provider_subscription_id", subscription.provider_subscription_id)
      .in("event_type", ["checkout.session.completed", "invoice.paid"])
      .gt("amount_minor", 0)
      .limit(1)
      .maybeSingle()
    : { data: null };
  const paidSubscription = subscription?.status === "active" && Boolean(confirmedPayment);
  const planRelation = paidSubscription ? subscription?.plans : accessGrant?.plans;
  const relatedPlan = Array.isArray(planRelation) ? planRelation[0] : planRelation;
  const plan = relatedPlan ? { key: relatedPlan.key, name: relatedPlan.name } : { key: "free", name: "Starter" };
  const planKey = plan.key;
  const { data: planRow } = await admin.from("plans").select("id").eq("key", planKey ?? "free").single();
  const { data: featureRows } = planRow ? await admin.from("plan_features").select("value,features(key)").eq("plan_id", planRow.id) : { data: [] };
  const features = Object.fromEntries((featureRows ?? []).flatMap((entry) => {
    const feature = Array.isArray(entry.features) ? entry.features[0] : entry.features;
    return feature?.key ? [[feature.key, entry.value]] : [];
  }));
  for (const flag of flags ?? []) {
    if (flag.key in features && flag.enabled === false) features[flag.key] = false;
  }
  const trialEnd = trialGrant?.expires_at ?? null;
  const daysRemaining = trialEnd ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86_400_000)) : 0;
  const grantEnd = accessGrant?.expires_at ?? null;
  const accessEnd = paidSubscription ? subscription?.current_period_end ?? null : grantEnd;
  const accessActive = paidSubscription || Boolean(accessGrant);
  const accessDaysRemaining = accessEnd ? Math.max(0, Math.ceil((new Date(accessEnd).getTime() - Date.now()) / 86_400_000)) : null;
  const checkedAt = Math.floor(Date.now() / 1000);
  const offlinePayload = { version: 1, subject: user.id, installationId: parsed.data.installationId, plan, features, featureFlags: Object.fromEntries((flags ?? []).map((flag) => [flag.key, { enabled: flag.enabled, config: flag.config }])), access: { active: accessActive, source: paidSubscription ? "stripe" : accessGrant?.source ?? null, expiresAt: accessEnd }, issuedAt: checkedAt, expiresAt: checkedAt + 86_400, graceUntil: checkedAt + 259_200 };
  const offlineToken = await signOfflineEntitlement(offlinePayload);
  return jsonResponse(request, {
    plan,
    paymentConfirmed: Boolean(confirmedPayment),
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
    featureFlags: Object.fromEntries((flags ?? []).map((flag) => [flag.key, { enabled: flag.enabled, config: flag.config }])),
    access: {
      active: accessActive,
      source: paidSubscription ? "stripe" : accessGrant?.source ?? null,
      expiresAt: accessEnd,
      daysRemaining: accessDaysRemaining,
      expiryWarning: accessDaysRemaining !== null && accessDaysRemaining <= 30,
      installUrl: serverConfig().chromeWebStoreUrl,
    },
    trial: { active: Boolean(trialGrant), endsAt: trialEnd, daysRemaining },
    referral: { code: referral?.code ?? null, qualified: referral?.qualified_referrals ?? 0 },
    checkedAt: now,
    offlineToken,
  });
});
