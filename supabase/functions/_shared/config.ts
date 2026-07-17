export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

function requiredHttpsUrl(name: string): string {
  const value = new URL(requiredEnv(name));
  if (value.protocol !== "https:" && value.hostname !== "localhost") throw new Error(`Invalid ${name}`);
  return value.href;
}

export function billingConfig() {
  return {
    stripeSecretKey: requiredEnv("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: requiredEnv("STRIPE_WEBHOOK_SECRET"),
    checkoutSuccessUrl: requiredHttpsUrl("CHECKOUT_SUCCESS_URL"),
    checkoutCancelUrl: requiredHttpsUrl("CHECKOUT_CANCEL_URL"),
  };
}

export function chromeWebStoreUrl(): string {
  const value = new URL(requiredEnv("CHROME_WEB_STORE_URL"));
  if (value.protocol !== "https:" || value.hostname !== "chromewebstore.google.com"
    || value.username || value.password) {
    throw new Error("Invalid CHROME_WEB_STORE_URL");
  }
  return value.href;
}
