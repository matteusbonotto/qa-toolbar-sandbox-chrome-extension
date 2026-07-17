import Stripe from "npm:stripe@22.3.1";
import { billingConfig } from "./config.ts";

export function stripeClient(): Stripe {
  return new Stripe(billingConfig().stripeSecretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export { Stripe };
