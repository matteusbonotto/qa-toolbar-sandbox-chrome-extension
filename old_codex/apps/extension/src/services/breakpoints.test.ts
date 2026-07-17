import { describe, expect, it } from "vitest";
import { defaultBreakpointPresets, rotatePreset, validateDimensions } from "./breakpoints";
describe("breakpoint presets", () => {
  it("ships the eight requested presets and validates custom sizes", () => {
    expect(defaultBreakpointPresets).toHaveLength(8);
    expect(rotatePreset(defaultBreakpointPresets[1]!).width).toBe(667);
    expect(validateDimensions(375, 667)).toBe(true);
    expect(validateDimensions(10, 10)).toBe(false);
  });
});
