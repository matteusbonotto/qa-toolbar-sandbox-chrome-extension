import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash";

describe("sha256Hex", () => {
  it("normalizes voucher codes and returns a 64-character digest", async () => {
    const normalized = await sha256Hex("  qa-2026  ");
    expect(normalized).toMatch(/^[a-f0-9]{64}$/);
    expect(normalized).toBe(await sha256Hex("QA-2026"));
  });
});
