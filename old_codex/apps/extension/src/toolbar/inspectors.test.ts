import { describe, expect, it } from "vitest";
import { inspectorMatches } from "./ToolbarApp";

const inspector = { id: "inspector", name: "Pedidos", pathPattern: "/api/orders", method: "GET", visualization: "cards", primaryFields: ["id"], listPath: "data", filters: [{ field: "meta.country", operator: "equals" as const, value: "BR" }], mappings: {}, version: "1", status: "active", enabled: true };
const record = { id: "record", kind: "fetch" as const, method: "GET", url: "https://example.test/api/orders?page=1", status: 200, durationMs: 12, payload: { meta: { country: "BR" }, data: [{ id: 1 }] }, capturedAt: new Date().toISOString() };

describe("declarative inspectors", () => {
  it("matches configured method, endpoint and payload filters without executable expressions", () => {
    expect(inspectorMatches(inspector, record)).toBe(true);
    expect(inspectorMatches({ ...inspector, method: "POST" }, record)).toBe(false);
    expect(inspectorMatches({ ...inspector, filters: [{ field: "meta.country", operator: "equals", value: "AR" }] }, record)).toBe(false);
  });
});
