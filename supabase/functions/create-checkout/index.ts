import { z } from "npm:zod@4.4.3";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serverConfig } from "../_shared/config.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";
import { allowedPrice, stripeClient } from "../_shared/stripe.ts";

const requestSchema = z.object({
  priceKey: z.enum(["pro_monthly", "pro_yearly", "scale_monthly", "scale_yearly"]),
  requestId: z.string().uuid(),
  referralCode: z.string().trim().regex(/^QTS-[A-Z0-9]{8}$/).optional(),
}).strict();

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "create-checkout", 8, 3600);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");

  const admin = adminClient();
  const { data: activeSubscription } = await admin.from("subscriptions").select("id")
    .eq("user_id", user.id).in("status", ["active", "trialing", "past_due"]).maybeSingle();
  if (activeSubscription) throw new ApiError(409, "subscription_already_exists");

  const stripe = stripeClient();
  const { data: customerRecord } = await admin.from("payment_customers")
    .select("provider_customer_id").eq("user_id", user.id).maybeSingle();

  let customerId = customerRecord?.provider_customer_id as string | undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    }, { idempotencyKey: `customer:${user.id}` });
    customerId = customer.id;
    const { error } = await admin.from("payment_customers").upsert({
      user_id: user.id,
      provider: "stripe",
      provider_customer_id: customerId,
    }, { onConflict: "user_id" });
    if (error) throw new Error("Could not persist billing customer");
  }

  const config = serverConfig();
  const { data: profile } = await admin.from("profiles").select("trial_ends_at").eq("id", user.id).maybeSingle();
  const trialEnd = profile?.trial_ends_at ? Math.floor(new Date(profile.trial_ends_at).getTime() / 1000) : null;
  const preservesTrial = Boolean(trialEnd && trialEnd > Math.floor(Date.now() / 1000) + 172_800);
  let referralApplied = false;
  if (parsed.data.referralCode) {
    const { data } = await admin.rpc("register_referral", { target_user_id: user.id, referral_code: parsed.data.referralCode });
    referralApplied = data === true;
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: allowedPrice(parsed.data.priceKey), quantity: 1 }],
    allow_promotion_codes: !referralApplied,
    ...(referralApplied ? { discounts: [{ promotion_code: config.referralPromotionCodeId }] } : {}),
    success_url: config.checkoutSuccessUrl,
    cancel_url: config.checkoutCancelUrl,
    metadata: { supabase_user_id: user.id, price_key: parsed.data.priceKey, referral_applied: String(referralApplied) },
    subscription_data: {
      metadata: { supabase_user_id: user.id, price_key: parsed.data.priceKey },
      ...(preservesTrial ? { trial_end: trialEnd! } : {}),
    },
  }, { idempotencyKey: `checkout:${user.id}:${parsed.data.requestId}` });

  if (!session.url?.startsWith("https://checkout.stripe.com/")) throw new Error("Stripe returned an invalid Checkout URL");
  return jsonResponse(request, { checkoutUrl: session.url });
});
