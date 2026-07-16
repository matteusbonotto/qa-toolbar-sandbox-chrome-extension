import { describe, expect, it, vi } from "vitest";
import { authorizeExtensionSurface } from "./accessGate";

const validSession = {
  accessToken: "a".repeat(32),
  refreshToken: "refresh-token",
  expiresAt: 1_900_000_000,
  user: { id: "d5c9b84c-0564-4fc8-87ad-12409180403b", email: "qa@example.test" },
};

describe("extension access gate", () => {
  it("allows a surface only when the backend session provider returns a valid session", async () => {
    await expect(authorizeExtensionSurface({ session: vi.fn(async () => validSession) })).resolves.toEqual(validSession);
  });

  it.each([
    ["missing session", async () => null],
    ["refresh or network failure", async () => { throw new Error("offline"); }],
  ])("fails closed for %s", async (_scenario, session) => {
    await expect(authorizeExtensionSurface({ session })).resolves.toBeNull();
  });
});
