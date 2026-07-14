import { describe, expect, it } from "vitest";
import { diffJson, formatJson, searchJson } from "./jsonStudio";
describe("JSON Studio", () => {
  it("formats, searches paths and calculates bounded diffs", () => {
    expect(formatJson({ ok: true })).toContain("\n");
    expect(searchJson({ member: { id: 1 } }, "id")).toContain("$.member.id");
    expect(diffJson({ price: 10 }, { price: 12 })).toEqual([{ path: "$.price", before: 10, after: 12 }]);
  });
});
