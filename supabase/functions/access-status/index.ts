import { resolveAccess } from "../_shared/access.ts";
import { signAccessToken } from "../_shared/access_token.ts";
import { adminClient, authenticatedUser, enforceRateLimit } from "../_shared/auth.ts";
import { chromeWebStoreUrl } from "../_shared/config.ts";
import { serve } from "../_shared/handler.ts";
import { jsonResponse, requirePost } from "../_shared/http.ts";

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "access-status", 300, 3_600);
  const now = new Date().toISOString();
  const { selectedGrant, features, subscription, confirmedPayment } = await resolveAccess(adminClient(), user.id, now);

  // Signed separately from the rest of the response: this is the only part the client is allowed
  // to trust without a fresh round trip to this function (see access_token.ts). Everything else
  // below (billing, installUrl, ...) is either UI-only or re-derived from `active`/`features` on
  // every real check anyway, so it doesn't need to ride inside the signature.
  const active = Boolean(selectedGrant);
  const selectedPlan = selectedGrant?.plan
    ? { key: selectedGrant.plan.key, name: selectedGrant.plan.name }
    : null;
  const token = await signAccessToken({ active, plan: selectedPlan, features });

  return jsonResponse(request, {
    active: Boolean(selectedGrant),
    plan: selectedGrant?.plan ? { key: selectedGrant.plan.key, name: selectedGrant.plan.name } : null,
    source: selectedGrant?.source ?? null,
    expiresAt: selectedGrant?.expiresAt ?? null,
    billing: subscription ? {
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      paymentConfirmed: confirmedPayment,
    } : null,
    features,
    token,
    installUrl: active ? chromeWebStoreUrl() : null,
    checkedAt: now,
  });
});
