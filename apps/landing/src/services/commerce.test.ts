import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingCommerce, hasReleaseAccess, type BillingStatus } from "./commerce";

const status = (trial: boolean, subscription: string | null): BillingStatus => ({
  plan: { key: subscription ? "pro" : "free", name: subscription ? "Pro" : "Starter" },
  subscription: subscription ? { status: subscription, currentPeriodEnd: null, cancelAtPeriodEnd: false } : null,
  trial: { active: trial, endsAt: trial ? "2026-08-01T00:00:00.000Z" : null, daysRemaining: trial ? 10 : 0 },
});

describe("landing commerce access", () => {
  afterEach(() => vi.restoreAllMocks());

  it("releases only an active trial or confirmed Stripe subscription", () => {
    expect(hasReleaseAccess(status(true, null))).toBe(true);
    expect(hasReleaseAccess(status(false, "active"))).toBe(true);
    expect(hasReleaseAccess(status(false, "trialing"))).toBe(true);
    expect(hasReleaseAccess(status(false, "past_due"))).toBe(false);
    expect(hasReleaseAccess(status(false, null))).toBe(false);
  });

  it("rejects non-Supabase and insecure backend URLs", () => {
    expect(() => new LandingCommerce("http://project.supabase.co", "public-key")).toThrow();
    expect(() => new LandingCommerce("https://evil.example", "public-key")).toThrow();
  });

  it("accepts only short-lived release links from the configured Supabase project", async () => {
    const api = new LandingCommerce("https://project.supabase.co", "public-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      downloadUrl: "https://project.supabase.co/storage/v1/object/sign/extension-releases/release.zip?token=signed",
      expiresIn: 60,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.releaseUrl("valid-access-token")).resolves.toContain("extension-releases");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      downloadUrl: "https://evil.example/release.zip",
      expiresIn: 60,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.releaseUrl("valid-access-token")).rejects.toThrow("rejeitado");
  });
});
