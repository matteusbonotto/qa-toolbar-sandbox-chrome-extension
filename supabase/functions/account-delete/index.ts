import { z } from "npm:zod@4.4.3";
import { adminClient, authenticatedUser, enforceRateLimit, publicClient } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";
import { stripeClient } from "../_shared/stripe.ts";

// LGPD self-service account deletion. Requirements confirmed with the founder before building
// this: cancel any active Stripe subscription immediately (no more billing), hard-delete personal
// data right away, but never touch payment_events/webhook_events/subscriptions rows — those stay
// for fiscal/legal retention (LGPD Art. 16), anonymized via the FK's ON DELETE SET NULL
// (see migration 20260720030000_payment_events_user_delete_set_null.sql).
const schema = z.object({
  password: z.string().min(8).max(200),
}).strict();

const BLOCKING_STATUSES = new Set(["past_due", "unpaid"]);
const CANCELABLE_STATUSES = new Set(["active", "trialing"]);

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "account-delete", 5, 3_600);
  const parsed = schema.safeParse(await readJson(request, 4_096));
  if (!parsed.success) throw new ApiError(400, "invalid_request");
  if (!user.email) throw new ApiError(400, "account_missing_email");

  // Re-confirm the password right before an irreversible action — a leftover/stolen access token
  // alone must not be enough to delete the account.
  const { error: reauthError } = await publicClient().auth.signInWithPassword({ email: user.email, password: parsed.data.password });
  if (reauthError) throw new ApiError(401, "invalid_password");

  const admin = adminClient();
  const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
    .select("status,provider_subscription_id")
    .eq("user_id", user.id)
    .in("status", ["active", "trialing", "past_due", "unpaid"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw new Error("Could not load subscription status");

  if (subscription && BLOCKING_STATUSES.has(subscription.status)) throw new ApiError(409, "payment_past_due");

  if (subscription?.provider_subscription_id && CANCELABLE_STATUSES.has(subscription.status)) {
    try {
      await stripeClient().subscriptions.cancel(subscription.provider_subscription_id);
    } catch (error) {
      console.error("account-delete: Stripe cancellation failed", error instanceof Error ? error.message : String(error));
      throw new ApiError(502, "subscription_cancel_failed");
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("account-delete: deleteUser failed", deleteError.message);
    throw new ApiError(500, "account_delete_failed");
  }

  return jsonResponse(request, { deleted: true });
});
