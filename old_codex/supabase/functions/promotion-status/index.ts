import { serverConfig } from "../_shared/config.ts";
import { serve } from "../_shared/handler.ts";
import { jsonResponse, requirePost } from "../_shared/http.ts";
import { stripeClient } from "../_shared/stripe.ts";

serve(async (request) => {
  requirePost(request);
  const promotion = await stripeClient().promotionCodes.retrieve(serverConfig().launchPromotionCodeId, {
    expand: ["promotion.coupon"],
  });
  const maximum = promotion.max_redemptions ?? 15;
  const remaining = Math.max(0, maximum - promotion.times_redeemed);
  const coupon = promotion.promotion.type === "coupon" && typeof promotion.promotion.coupon !== "string"
    ? promotion.promotion.coupon
    : null;
  return jsonResponse(request, {
    code: promotion.code,
    active: promotion.active && remaining > 0,
    maximumRedemptions: maximum,
    remainingRedemptions: remaining,
    percentOff: coupon?.percent_off ?? 30,
  });
});
