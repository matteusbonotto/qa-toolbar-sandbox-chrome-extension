import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";
import { stripeClient } from "../_shared/stripe.ts";

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "rewards-spin", 5, 60);
  const input = await readJson(request);
  const requestId = typeof input === "object" && input !== null && "requestId" in input ? String(input.requestId) : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new ApiError(400, "invalid_request");
  }
  const admin = adminClient();
  const { data, error } = await admin.rpc("spin_reward_wheel", {
    request_id_input: requestId,
    target_user_id_input: user.id,
  });
  if (error || !data?.[0]) {
    const known = ["insufficient_reward_points", "daily_spin_limit", "reward_program_unavailable", "reward_debt_outstanding"]
      .find((code) => error?.message?.includes(code));
    if (known) throw new ApiError(409, known);
    throw new Error("Reward spin failed");
  }
  const result = data[0];
  const { data: benefit } = await admin.from("reward_benefits").select("id,kind,discount_percent,status")
    .eq("id", result.benefit_id).eq("user_id", user.id).single();

  // Subscribers receive a discount on their next invoice immediately. Users without an
  // active subscription keep it in their wallet and checkout reserves it automatically.
  if (benefit?.kind === "discount_percent" && benefit.status === "available") {
    const { data: subscription } = await admin.from("subscriptions").select("provider_subscription_id")
      .eq("user_id", user.id).in("status", ["active", "trialing", "past_due"]).maybeSingle();
    if (subscription?.provider_subscription_id) {
      const stripe = stripeClient();
      const coupon = await stripe.coupons.create({ percent_off: benefit.discount_percent!, duration: "once" }, {
        idempotencyKey: `reward-coupon:${benefit.id}`,
      });
      await stripe.subscriptions.update(subscription.provider_subscription_id, { discounts: [{ coupon: coupon.id }] });
      const marked = await admin.rpc("mark_reward_discount_applied", {
        target_user_id: user.id,
        benefit_id_input: benefit.id,
        stripe_coupon_id_input: coupon.id,
        stripe_subscription_id_input: subscription.provider_subscription_id,
      });
      if (marked.error) throw new Error("Reward was won but could not be marked as applied");
      result.applied_to_subscription = true;
    }
  }
  return jsonResponse(request, result);
});
