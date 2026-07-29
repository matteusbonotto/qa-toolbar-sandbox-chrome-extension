import { assertEquals } from "jsr:@std/assert";
import { selectBestEntitlement } from "./entitlements.ts";

const lowerVoucher = {
  source: "voucher",
  expiresAt: "2026-09-01T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  plan: { id: "starter", key: "smoke-test", name: "Smoke Test" },
  features: { inspector: true },
};
const permanentManager = {
  source: "manual",
  expiresAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  plan: { id: "manager", key: "release-manager", name: "Release Manager" },
  features: { inspector: true, reports: true, releases: true },
};

Deno.test("a newer lower voucher cannot downgrade a permanent stronger manual grant", () => {
  assertEquals(selectBestEntitlement([lowerVoucher, permanentManager])?.source, "manual");
});

Deno.test("permanent access wins when capabilities are equal", () => {
  const temporary = { ...permanentManager, source: "voucher", expiresAt: "2027-01-01T00:00:00.000Z", createdAt: "2026-08-01T00:00:00.000Z" };
  assertEquals(selectBestEntitlement([temporary, permanentManager])?.source, "manual");
});

Deno.test("unrestricted administrative access wins without relying on a plan name", () => {
  const unrestricted = { ...lowerVoucher, source: "founder", plan: null, features: {}, unrestricted: true };
  assertEquals(selectBestEntitlement([permanentManager, unrestricted])?.source, "founder");
});
