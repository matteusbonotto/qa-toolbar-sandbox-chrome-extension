import { beforeEach, describe, expect, it, vi } from "vitest";
import { addStatusEvidence, evidenceHistory } from "./evidence";

describe("evidence history", () => {
  beforeEach(() => { let data: Record<string, unknown> = {}; vi.stubGlobal("browser", { storage: { local: { get: vi.fn(async (key: string) => ({ [key]: data[key] })), set: vi.fn(async (value: Record<string, unknown>) => { data = { ...data, ...value }; }) } } }); });
  it("persists statuses newest-first", async () => {
    await addStatusEvidence("pass", "https://example.test/checkout");
    await addStatusEvidence("block", "https://example.test/payment", "API unavailable");
    expect((await evidenceHistory()).map((entry) => entry.status)).toEqual(["block", "pass"]);
  });
});
