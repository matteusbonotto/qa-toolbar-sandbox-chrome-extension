export interface CheckoutRequest {
  planId: string;
  voucherCode: string | null;
}

export interface CheckoutResult {
  ok: boolean;
}

/**
 * The Stripe-backed checkout API doesn't exist yet (backend rebuild is pending).
 * This stub keeps the UI flow honest instead of faking a redirect: the caller
 * shows a localized "not wired up yet" message instead of pretending to succeed.
 */
export async function startCheckout({ planId, voucherCode }: CheckoutRequest): Promise<CheckoutResult> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  console.info("[checkout] would start Stripe checkout for", { planId, voucherCode });
  return { ok: false };
}
