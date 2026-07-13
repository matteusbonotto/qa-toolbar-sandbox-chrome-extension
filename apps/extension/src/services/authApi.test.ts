import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApi } from "./authApi";

const session = {
  accessToken: "access-token-value-long-enough",
  refreshToken: "refresh-token-value-long-enough",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "d5c9b84c-0564-4fc8-87ad-12409180403b", email: "qa@example.test" },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AuthApi", () => {
  it("accepts opaque refresh tokens regardless of their provider-defined length", async () => {
    const shortRefreshSession = { ...session, refreshToken: "opaque-token" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(shortRefreshSession), { status: 200 })));
    const storage = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    const api = new AuthApi("https://example.supabase.co", "public-key", storage);

    await expect(api.signIn("qa@example.test", "safe-password")).resolves.toMatchObject(shortRefreshSession);
  });

  it("sends credentials only in a POST body and persists the session between instances", async () => {
    const values: Record<string, unknown> = {};
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
      remove: vi.fn(async (key: string) => { delete values[key]; }),
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
    const api = new AuthApi("https://abcdefghijklmnopqrst.supabase.co", "sb_publishable_example", storage);
    await api.signIn("qa@example.test", "safe-password");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("?");
    expect(options?.method).toBe("POST");
    expect(String(options?.body)).toContain("qa@example.test");
    expect(storage.set).toHaveBeenCalledWith({ qtsAuthSession: session });
    const restoredApi = new AuthApi("https://abcdefghijklmnopqrst.supabase.co", "sb_publishable_example", storage);
    await expect(restoredApi.session()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
