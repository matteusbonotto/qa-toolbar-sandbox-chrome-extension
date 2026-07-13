import Stripe from "npm:stripe@22.3.1";
import { serverConfig } from "./config.ts";

export function stripeClient(): Stripe {
  return new Stripe(serverConfig().stripeSecretKey, {
    apiVersion: "2026-06-24.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export type PaidPriceKey = "pro_monthly" | "pro_yearly" | "scale_monthly" | "scale_yearly";

export function allowedPrice(priceKey: PaidPriceKey): string {
  const config = serverConfig();
  return ({
    pro_monthly: config.proMonthlyPriceId,
    pro_yearly: config.proYearlyPriceId,
    scale_monthly: config.scaleMonthlyPriceId,
    scale_yearly: config.scaleYearlyPriceId,
  } satisfies Record<PaidPriceKey, string>)[priceKey];
}
