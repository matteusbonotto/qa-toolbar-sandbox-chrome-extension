import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingCommerce, hasReleaseAccess, type BillingStatus } from "./commerce";

const status = (trial: boolean, subscription: string | null, paymentConfirmed = false): BillingStatus => ({
  plan: { key: subscription ? "pro" : "free", name: subscription ? "Pro" : "Starter" },
  paymentConfirmed,
  subscription: subscription ? { status: subscription, currentPeriodEnd: null, cancelAtPeriodEnd: false } : null,
  trial: { active: trial, endsAt: trial ? "2026-08-01T00:00:00.000Z" : null, daysRemaining: trial ? 10 : 0 },
});

describe("landing commerce access", () => {
  afterEach(() => vi.restoreAllMocks());

  it("unlocks installation only for confirmed server-side access", () => {
    expect(hasReleaseAccess(status(true, null))).toBe(false);
    expect(hasReleaseAccess(status(false, "active"))).toBe(false);
    expect(hasReleaseAccess(status(false, "active", true))).toBe(true);
    expect(hasReleaseAccess(status(false, "trialing", true))).toBe(false);
    expect(hasReleaseAccess(status(false, "past_due", true))).toBe(false);
    expect(hasReleaseAccess(status(false, null, true))).toBe(false);
  });

  it("rejects non-Supabase and insecure backend URLs", () => {
    expect(() => new LandingCommerce("http://project.supabase.co", "public-key")).toThrow();
    expect(() => new LandingCommerce("https://evil.example", "public-key")).toThrow();
  });

  it("redeems vouchers only through the authenticated backend", async () => {
    const api = new LandingCommerce("https://project.supabase.co", "public-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      redeemed: true,
      label: "Acesso QA",
      expiresAt: "2027-07-13T00:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.redeemVoucher("valid-access-token", "TEST-CODE")).resolves.toMatchObject({ redeemed: true });
  });

  it("reads the server-side Stripe promotion counter", async () => {
    const api = new LandingCommerce("https://project.supabase.co", "public-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      code: "30OFF", active: true, maximumRedemptions: 15, remainingRedemptions: 12, percentOff: 30,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.promotionStatus()).resolves.toMatchObject({ code: "30OFF", remainingRedemptions: 12 });
  });
});
