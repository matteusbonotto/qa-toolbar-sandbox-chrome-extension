import { adminClient, authenticatedUser, enforceRateLimit } from "../_shared/auth.ts";
import { selectBestEntitlement, type EntitlementCandidate } from "../_shared/entitlements.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, requirePost } from "../_shared/http.ts";
import { stripeClient } from "../_shared/stripe.ts";

interface PlanRelation { id: string; key: string; name: string; }
interface RevocableCandidate extends EntitlementCandidate { grantId: string; }

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "cancel-access", 5, 3_600);
  const admin = adminClient();
  const now = new Date().toISOString();

  // A real, Stripe-backed subscription takes priority: cancel it there (source of truth for
  // billing), never by touching entitlement_grants directly - the existing webhook already syncs
  // entitlement_grants once Stripe confirms the change, so this function doesn't duplicate that.
  const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
    .select("id,provider_subscription_id,current_period_end,cancel_at_period_end")
    .eq("user_id", user.id).in("status", ["active", "trialing", "past_due"])
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (subscriptionError) throw new Error("Could not load subscription");

  if (subscription) {
    if (!subscription.cancel_at_period_end) {
      try {
        await stripeClient().subscriptions.update(subscription.provider_subscription_id, { cancel_at_period_end: true });
      } catch (error) {
        console.error("cancel-access: stripe subscription update failed", { message: error instanceof Error ? error.message : String(error) });
        throw new ApiError(409, "stripe_subscription_unavailable");
      }
      // Optimistic local update so the next access-status/pricing refresh reflects it immediately
      // instead of waiting on the async customer.subscription.updated webhook round trip; the
      // webhook still runs and simply confirms the same state (idempotent, no conflict).
      const { error: updateError } = await admin.from("subscriptions")
        .update({ cancel_at_period_end: true }).eq("id", subscription.id);
      if (updateError) throw new Error("Could not persist cancellation state");
    }
    return jsonResponse(request, { canceled: true, mode: "at_period_end", accessUntil: subscription.current_period_end });
  }

  // No billing-backed subscription: fall back to revoking whichever non-billing grant (trial,
  // voucher, manual or founder courtesy) is currently the visitor's active plan, using the exact
  // same selection rule access-status uses so this revokes the one thing they actually see as
  // "their plan" - never a weaker grant sitting underneath it.
  const { data: grants, error: grantsError } = await admin.from("entitlement_grants")
    .select("id,source,expires_at,created_at,plans(id,key,name)")
    .eq("user_id", user.id).is("revoked_at", null).lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`).order("created_at", { ascending: false });
  if (grantsError) throw new Error("Could not load entitlement grants");
  if (!grants?.length) throw new ApiError(409, "nothing_to_cancel");

  const candidates: RevocableCandidate[] = grants.map((grant) => {
    const plan = relation<PlanRelation>(grant.plans as PlanRelation | PlanRelation[] | null);
    return {
      grantId: grant.id as string,
      source: grant.source as string,
      expiresAt: grant.expires_at as string | null,
      createdAt: grant.created_at as string,
      plan,
      features: {},
      unrestricted: !plan,
    };
  });
  const best = selectBestEntitlement(candidates) as RevocableCandidate | null;
  if (!best) throw new ApiError(409, "nothing_to_cancel");

  const { error: revokeError, count } = await admin.from("entitlement_grants")
    .update({ revoked_at: now }, { count: "exact" })
    .eq("id", best.grantId).eq("user_id", user.id).is("revoked_at", null);
  if (revokeError) throw new Error("Could not revoke access grant");
  if (!count) throw new ApiError(409, "nothing_to_cancel");

  return jsonResponse(request, { canceled: true, mode: "immediate" });
});
