import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApi } from "./authApi";

const session = {
  accessToken: "access-token-value-long-enough",
  refreshToken: "refresh-token-value-long-enough",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "d5c9b84c-0564-4fc8-87ad-12409180403b", email: "qa@example.test" },
};

afterEach(() => vi.restoreAllMocks());

describe("AuthApi", () => {
  it("sends credentials only in a POST body and stores the session ephemerally", async () => {
    const storage = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
    const api = new AuthApi("https://abcdefghijklmnopqrst.supabase.co", "sb_publishable_example", storage);
    await api.signIn("qa@example.test", "safe-password");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("?");
    expect(options?.method).toBe("POST");
    expect(String(options?.body)).toContain("qa@example.test");
    expect(storage.set).toHaveBeenCalledWith({ qtsAuthSession: session });
  });

  it("creates the trial account with explicit terms and an optional referral", async () => {
    const storage = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
    const api = new AuthApi("https://abcdefghijklmnopqrst.supabase.co", "sb_publishable_example", storage);
    await api.signUp("qa@example.test", "safe-password", true, "QTS-1234ABCD");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("?");
    expect(JSON.parse(String(options?.body))).toEqual({
      email: "qa@example.test",
      password: "safe-password",
      acceptedTerms: true,
      referralCode: "QTS-1234ABCD",
    });
    expect(storage.set).toHaveBeenCalledWith({ qtsAuthSession: session });
  });
});
