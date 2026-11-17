// Regras puras do reembolso automático (sem rede), para serem testadas isoladas.
// Arrependimento: 7 dias no Brasil (CDC art. 49), 14 dias para consumidores da UE.

const EU = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
  "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export function withdrawalDays(country: string | null | undefined): number {
  return country && EU.has(country.toUpperCase()) ? 14 : 7;
}

export interface RefundCheck {
  paidAt: number | null; // segundos (Stripe)
  nowMs: number;
  country: string | null | undefined;
  amount: number;
  alreadyRefundedBefore: boolean; // mesma conta, e-mail ou cartão já teve reembolso automático
  disputed: boolean;
}

export type RefundVerdict = { ok: true } | { ok: false; reason: "no_payment" | "window_expired" | "already_refunded" | "disputed" };

export function refundVerdict(c: RefundCheck): RefundVerdict {
  if (!c.paidAt || c.amount <= 0) return { ok: false, reason: "no_payment" };
  if (c.disputed) return { ok: false, reason: "disputed" };
  if (c.alreadyRefundedBefore) return { ok: false, reason: "already_refunded" };
  const limitMs = c.paidAt * 1000 + withdrawalDays(c.country) * 86_400_000;
  if (c.nowMs > limitMs) return { ok: false, reason: "window_expired" };
  return { ok: true };
}
