import { createHash } from "node:crypto";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { billingConfig } from "../_shared/config.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";
import { Stripe, stripeClient } from "../_shared/stripe.ts";

interface CheckoutInput {
  planKey: string;
  billingCycle: "monthly" | "yearly";
  requestId: string;
  referralCode?: string;
  voucherCode?: string;
}

function parseInput(value: unknown): CheckoutInput {
  if (!value || typeof value !== "object") throw new ApiError(400, "invalid_request");
  const input = value as Record<string, unknown>;
  const planKey = String(input.planKey ?? "");
  const billingCycle = String(input.billingCycle ?? "");
  const requestId = String(input.requestId ?? "");
  const referralCode = input.referralCode ? String(input.referralCode).trim().toUpperCase() : undefined;
  const voucherCode = input.voucherCode ? String(input.voucherCode).trim().toUpperCase() : undefined;
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(planKey) || !["monthly", "yearly"].includes(billingCycle)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || (referralCode && !/^QTS-[A-F0-9]{8}$/.test(referralCode))
    || (voucherCode && !/^[A-Z0-9-]{6,64}$/.test(voucherCode))) {
    throw new ApiError(400, "invalid_request");
  }
  return { planKey, billingCycle: billingCycle as CheckoutInput["billingCycle"], requestId, referralCode, voucherCode };
}

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "checkout-create-session", 8, 3_600);
  const input = parseInput(await readJson(request));
  const admin = adminClient();

  const { data: plan, error: planError } = await admin.from("plans").select("id,key,name")
    .eq("key", input.planKey).eq("is_active", true).maybeSingle();
  if (planError || !plan) throw new ApiError(404, "plan_not_found");

  let voucherDiscount: {
    label: string;
    percentOff: number | null;
    amountOffMinor: number | null;
    discountCurrency: string | null;
  } | null = null;

  if (input.voucherCode) {
    const voucherHash = createHash("sha256").update(input.voucherCode).digest("hex");
    const [{ data: campaignRow }, { data: voucherRow }] = await Promise.all([
      admin.from("voucher_campaigns").select("kind").eq("code_hash", voucherHash).maybeSingle(),
      admin.from("vouchers").select("kind").eq("code_hash", voucherHash).maybeSingle(),
    ]);
    const voucherKind = campaignRow?.kind ?? voucherRow?.kind ?? null;

    if (voucherKind !== "discount") {
      // days/lifetime -- unchanged: grants access directly, never touches Stripe.
      const redeemed = await admin.rpc("redeem_voucher", { target_user_id: user.id, voucher_hash: voucherHash });
      if (redeemed.error || !redeemed.data?.[0]) throw new ApiError(409, "voucher_unavailable");
      return jsonResponse(request, {
        accessGranted: true,
        voucherRedeemed: true,
        label: redeemed.data[0].label,
        expiresAt: redeemed.data[0].access_expires_at,
      });
    }

    // kind === 'discount' -- reserve it (so the same code can't be consumed twice while this
    // checkout is in flight) and fall through to a real Stripe Checkout Session below.
    const reserved = await admin.rpc("reserve_voucher_discount", {
      target_user_id: user.id, voucher_hash: voucherHash, request_id_input: input.requestId,
    });
    if (reserved.error || !reserved.data?.[0]) {
      const code = reserved.error?.message?.includes("voucher_already_redeemed")
        ? "voucher_already_redeemed" : "voucher_unavailable";
      throw new ApiError(409, code);
    }
    const discount = reserved.data[0];
    if (discount.target_plan_id && discount.target_plan_id !== plan.id) {
      await admin.rpc("release_voucher_reservation", { request_id_input: input.requestId });
      throw new ApiError(409, "voucher_plan_mismatch");
    }
    voucherDiscount = {
      label: discount.label,
      percentOff: discount.percent_off ?? null,
      amountOffMinor: discount.amount_off_minor ?? null,
      discountCurrency: discount.discount_currency ?? null,
    };
  }

  if (plan.key === "smoke-test") {
    const { data: expiresAt, error } = await admin.rpc("activate_free_trial", { target_user_id: user.id });
    if (error) throw new ApiError(409, "free_trial_unavailable");
    return jsonResponse(request, { accessGranted: true, planKey: plan.key, expiresAt });
  }

  const { data: existing } = await admin.from("checkout_sessions").select("checkout_url,status,expires_at")
    .eq("user_id", user.id).eq("request_id", input.requestId).maybeSingle();
  if (existing?.checkout_url && existing.status === "open") {
    return jsonResponse(request, { checkoutUrl: existing.checkout_url, reused: true });
  }
  const { data: activeSubscription } = await admin.from("subscriptions").select("id")
    .eq("user_id", user.id).in("status", ["active", "trialing", "past_due"]).maybeSingle();
  if (activeSubscription) throw new ApiError(409, "subscription_already_exists");

  const { data: price, error: priceError } = await admin.from("stripe_prices")
    .select("provider_price_id").eq("plan_id", plan.id).eq("billing_cycle", input.billingCycle)
    .eq("is_active", true).maybeSingle();
  if (priceError || !price) throw new ApiError(409, "price_not_configured");

  let { data: customer } = await admin.from("payment_customers").select("provider_customer_id")
    .eq("user_id", user.id).maybeSingle();
  const stripe = stripeClient();
  if (!customer) {
    const created = await stripe.customers.create({ email: user.email, metadata: { supabase_user_id: user.id } }, {
      idempotencyKey: `customer:${user.id}`,
    });
    const persisted = await admin.from("payment_customers").upsert({
      user_id: user.id, provider: "stripe", provider_customer_id: created.id,
    }, { onConflict: "user_id" }).select("provider_customer_id").single();
    if (persisted.error || !persisted.data) throw new Error("Could not persist Stripe customer");
    customer = persisted.data;
  }

  if (input.referralCode) {
    await admin.rpc("register_referral", { target_user_id: user.id, referral_code_input: input.referralCode });
  }
  const config = billingConfig();

  let session: Stripe.Checkout.Session;
  try {
    let discounts: Stripe.Checkout.SessionCreateParams["discounts"];
    if (voucherDiscount) {
      const coupon = voucherDiscount.percentOff
        ? await stripe.coupons.create({ percent_off: voucherDiscount.percentOff, duration: "once" }, {
          idempotencyKey: `voucher-coupon-pct:${input.voucherCode}`,
        })
        : await stripe.coupons.create({
          amount_off: voucherDiscount.amountOffMinor!,
          currency: voucherDiscount.discountCurrency ?? "brl",
          duration: "once",
        }, { idempotencyKey: `voucher-coupon-amt:${input.voucherCode}` });
      discounts = [{ coupon: coupon.id }];
    }
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.provider_customer_id,
      client_reference_id: user.id,
      line_items: [{ price: price.provider_price_id, quantity: 1 }],
      // A voucher discount is never combined with a manually typed Stripe promo code.
      allow_promotion_codes: voucherDiscount ? false : true,
      ...(discounts ? { discounts } : {}),
      ...(voucherDiscount ? { expires_at: Math.floor(Date.now() / 1000) + 30 * 60 } : {}),
      success_url: config.checkoutSuccessUrl,
      cancel_url: config.checkoutCancelUrl,
      metadata: {
        supabase_user_id: user.id, plan_key: plan.key, billing_cycle: input.billingCycle,
        ...(voucherDiscount ? { voucher_request_id: input.requestId } : {}),
      },
      subscription_data: { metadata: { supabase_user_id: user.id, plan_key: plan.key } },
    }, { idempotencyKey: `checkout:${user.id}:${input.requestId}` });
  } catch (error) {
    if (voucherDiscount) await admin.rpc("release_voucher_reservation", { request_id_input: input.requestId });
    throw error;
  }
  if (!session.url?.startsWith("https://checkout.stripe.com/")) {
    if (voucherDiscount) await admin.rpc("release_voucher_reservation", { request_id_input: input.requestId });
    throw new Error("Stripe returned an invalid Checkout URL");
  }

  const persisted = await admin.from("checkout_sessions").upsert({
    user_id: user.id, plan_id: plan.id, billing_cycle: input.billingCycle, request_id: input.requestId,
    provider_session_id: session.id, checkout_url: session.url, status: "open",
    expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  }, { onConflict: "user_id,request_id" });
  if (persisted.error) throw new Error("Could not persist Checkout session");
  return jsonResponse(request, { checkoutUrl: session.url });
});
