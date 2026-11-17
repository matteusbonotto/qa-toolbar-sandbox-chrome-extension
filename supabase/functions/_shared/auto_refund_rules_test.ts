// Reembolso automático: prazo (7 dias BR, 14 UE), uma vez só, sem contestação.
import { assertEquals } from "jsr:@std/assert";
import { refundVerdict, withdrawalDays } from "./auto_refund_rules.ts";

const day = 86_400_000;
const paidAt = 1_700_000_000;
const base = { paidAt, nowMs: paidAt * 1000 + 3 * day, country: "BR", amount: 2990, alreadyRefundedBefore: false, disputed: false };

Deno.test("dentro de 7 dias, primeira vez: reembolsa", () => {
  assertEquals(refundVerdict(base), { ok: true });
});

Deno.test("8º dia no Brasil não reembolsa; na UE ainda sim", () => {
  const late = { ...base, nowMs: paidAt * 1000 + 8 * day };
  assertEquals(refundVerdict(late), { ok: false, reason: "window_expired" });
  assertEquals(refundVerdict({ ...late, country: "de" }), { ok: true });
  assertEquals(refundVerdict({ ...base, country: "de", nowMs: paidAt * 1000 + 15 * day }), { ok: false, reason: "window_expired" });
  assertEquals(withdrawalDays(null), 7);
});

Deno.test("conta, e-mail ou cartão com reembolso anterior não reembolsa", () => {
  assertEquals(refundVerdict({ ...base, alreadyRefundedBefore: true }), { ok: false, reason: "already_refunded" });
});

Deno.test("contestação aberta ou sem pagamento não reembolsa", () => {
  assertEquals(refundVerdict({ ...base, disputed: true }), { ok: false, reason: "disputed" });
  assertEquals(refundVerdict({ ...base, amount: 0 }), { ok: false, reason: "no_payment" });
  assertEquals(refundVerdict({ ...base, paidAt: null }), { ok: false, reason: "no_payment" });
});
