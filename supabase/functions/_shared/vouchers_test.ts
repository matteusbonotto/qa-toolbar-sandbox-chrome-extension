import { assertEquals } from "jsr:@std/assert";
import { allowedEmailDomainsPayload, voucherRpcErrorCode } from "./vouchers.ts";

Deno.test("domain restriction error from the RPC is surfaced, not collapsed into voucher_unavailable", () => {
  assertEquals(voucherRpcErrorCode({ message: "voucher_domain_not_allowed" }), "voucher_domain_not_allowed");
});

Deno.test("already redeemed keeps its own code", () => {
  assertEquals(voucherRpcErrorCode({ message: "voucher_already_redeemed" }), "voucher_already_redeemed");
});

Deno.test("every other failure collapses into voucher_unavailable", () => {
  assertEquals(voucherRpcErrorCode({ message: "voucher_unavailable" }), "voucher_unavailable");
  assertEquals(voucherRpcErrorCode({ message: 'column reference "kind" is ambiguous' }), "voucher_unavailable");
  assertEquals(voucherRpcErrorCode({ message: null }), "voucher_unavailable");
  assertEquals(voucherRpcErrorCode(null), "voucher_unavailable");
  assertEquals(voucherRpcErrorCode(undefined), "voucher_unavailable");
});

Deno.test("preview exposes the domain list, and null for no restriction", () => {
  assertEquals(allowedEmailDomainsPayload(["mblabs.com.br"]), ["mblabs.com.br"]);
  assertEquals(allowedEmailDomainsPayload(["mblabs.com.br", "bankeiro.com.br"]), ["mblabs.com.br", "bankeiro.com.br"]);
  assertEquals(allowedEmailDomainsPayload(null), null);
  assertEquals(allowedEmailDomainsPayload(undefined), null);
  assertEquals(allowedEmailDomainsPayload([]), null);
  assertEquals(allowedEmailDomainsPayload("mblabs.com.br"), null);
});
