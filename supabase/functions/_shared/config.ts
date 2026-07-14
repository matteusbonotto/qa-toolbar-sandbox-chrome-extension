export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

export function serverConfig() {
  const chromeWebStoreUrl = Deno.env.get("CHROME_WEB_STORE_URL")?.trim() ?? "https://chromewebstore.google.com/";
  const storeUrl = new URL(chromeWebStoreUrl);
  if (storeUrl.protocol !== "https:" || storeUrl.hostname !== "chromewebstore.google.com") {
    throw new Error("Invalid CHROME_WEB_STORE_URL");
  }
  return {
    supabaseUrl: requiredEnv("SUPABASE_URL"),
    supabasePublicKey: Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? requiredEnv("APP_SUPABASE_PUBLIC_KEY"),
    supabaseSecretKey: Deno.env.get("SUPABASE_SECRET_KEY") ?? requiredEnv("APP_SUPABASE_SECRET_KEY"),
    stripeSecretKey: requiredEnv("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "",
    proMonthlyPriceId: requiredEnv("STRIPE_PRO_MONTHLY_PRICE_ID"),
    proYearlyPriceId: requiredEnv("STRIPE_PRO_YEARLY_PRICE_ID"),
    scaleMonthlyPriceId: requiredEnv("STRIPE_SCALE_MONTHLY_PRICE_ID"),
    scaleYearlyPriceId: requiredEnv("STRIPE_SCALE_YEARLY_PRICE_ID"),
    referralPromotionCodeId: requiredEnv("STRIPE_REFERRAL_PROMOTION_CODE_ID"),
    checkoutSuccessUrl: requiredEnv("CHECKOUT_SUCCESS_URL"),
    checkoutCancelUrl: requiredEnv("CHECKOUT_CANCEL_URL"),
    chromeWebStoreUrl: storeUrl.href,
  };
}
