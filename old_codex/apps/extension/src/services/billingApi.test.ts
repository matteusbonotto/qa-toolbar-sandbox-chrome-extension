import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingApi } from "./billingApi";

const api = new BillingApi({
  supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
  supabasePublicKey: "sb_publishable_example",
});

afterEach(() => vi.restoreAllMocks());

describe("BillingApi", () => {
  it("uses POST JSON and never puts commercial data in a query string", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      checkoutUrl: "https://checkout.stripe.com/c/pay/test",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.createCheckout("valid-token", "pro_monthly")).resolves.toContain("checkout.stripe.com");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("?");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toMatchObject({ priceKey: "pro_monthly" });
  });

  it("rejects an attacker-controlled redirect URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      checkoutUrl: "https://evil.example/steal",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.createCheckout("valid-token", "pro_monthly")).rejects.toThrow("rejected");
  });

  it("sends Scale and referral choices in the signed-in POST body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      checkoutUrl: "https://checkout.stripe.com/c/pay/test",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.createCheckout("valid-token", "scale_yearly", "QTS-1234ABCD");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("?");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      priceKey: "scale_yearly",
      referralCode: "QTS-1234ABCD",
    });
  });
});
