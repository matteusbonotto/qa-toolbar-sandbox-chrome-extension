import { describe, expect, it } from "vitest";
import { diffJson, formatJson, inferJsonSchema, queryJsonPath, searchJson } from "./jsonStudio";
describe("JSON Studio", () => {
  it("formats, searches paths and calculates bounded diffs", () => {
    expect(formatJson({ ok: true })).toContain("\n");
    expect(searchJson({ member: { id: 1 } }, "id")).toContain("$.member.id");
    expect(diffJson({ price: 10 }, { price: 12 })).toEqual([{ path: "$.price", before: 10, after: 12 }]);
  });
  it("queries bounded JSON paths and generates a non-executable schema view", () => {
    const payload = { data: { items: [{ id: 7, active: true }] } };
    expect(queryJsonPath(payload, "$.data.items[0].id")).toBe(7);
    expect(inferJsonSchema(payload)).toMatchObject({ type: "object", properties: { data: { type: "object" } } });
    expect(() => queryJsonPath(payload, "$..constructor()")).toThrow();
  });
});
