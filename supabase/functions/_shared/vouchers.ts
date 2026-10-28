// Shared voucher helpers for voucher-redeem, voucher-preview and checkout-create-session.

// Error codes the voucher RPCs (redeem_voucher / reserve_voucher_discount) raise on purpose and
// that the clients know how to explain. Anything else (unknown code, exhausted campaign, a DB or
// network failure) collapses into voucher_unavailable so internals never leak to the caller.
// voucher_domain_not_allowed exists since 2026-10-28: e-mail domain restricted vouchers
// (allowed_email_domains), see supabase/migrations/20261028120000_voucher_email_domain_restriction.sql.
export type VoucherRpcErrorCode = "voucher_domain_not_allowed" | "voucher_already_redeemed" | "voucher_unavailable";

export function voucherRpcErrorCode(error: { message?: string | null } | null | undefined): VoucherRpcErrorCode {
  const message = String(error?.message ?? "");
  if (message.includes("voucher_domain_not_allowed")) return "voucher_domain_not_allowed";
  if (message.includes("voucher_already_redeemed")) return "voucher_already_redeemed";
  return "voucher_unavailable";
}

// Public preview shape of allowed_email_domains: null means "any e-mail" (the column is NULL or an
// empty array, which the database treats the same way). Never returns an empty array, so the
// Landing only has to test for null.
export function allowedEmailDomainsPayload(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const domains = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return domains.length ? domains : null;
}
