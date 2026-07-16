import Stripe from "npm:stripe@22.3.1";
import { adminClient } from "./auth.ts";
import { serverConfig } from "./config.ts";

export function stripeClient(): Stripe {
  return new Stripe(serverConfig().stripeSecretKey, {
    apiVersion: "2026-06-24.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export type PaidPriceKey = "pro_monthly" | "pro_yearly" | "scale_monthly" | "scale_yearly";

function envPrice(priceKey: PaidPriceKey): string {
  const config = serverConfig();
  return ({
    pro_monthly: config.proMonthlyPriceId,
    pro_yearly: config.proYearlyPriceId,
    scale_monthly: config.scaleMonthlyPriceId,
    scale_yearly: config.scaleYearlyPriceId,
  } satisfies Record<PaidPriceKey, string>)[priceKey];
}

/**
 * The admin panel edits `plan_prices` so Stripe price IDs can change without
 * a redeploy. Until an admin sets a row for a plan/interval, checkout keeps
 * using the environment-configured price, so nothing breaks on first boot.
 */
export async function allowedPrice(priceKey: PaidPriceKey): Promise<string> {
  const [planKey, billingInterval] = priceKey === "pro_monthly"
    ? ["pro", "monthly"] as const
    : priceKey === "pro_yearly"
      ? ["pro", "yearly"] as const
      : priceKey === "scale_monthly"
        ? ["scale", "monthly"] as const
        : ["scale", "yearly"] as const;

  const { data: plan } = await adminClient().from("plans").select("id").eq("key", planKey).maybeSingle();
  if (plan) {
    const { data: price } = await adminClient().from("plan_prices")
      .select("stripe_price_id").eq("plan_id", plan.id).eq("billing_interval", billingInterval).maybeSingle();
    if (price?.stripe_price_id) return price.stripe_price_id;
  }
  return envPrice(priceKey);
}
