import { describe, expect, it } from "vitest";
import { pricingPlans } from "./pricingData";

describe("pricingPlans", () => {
  it("keeps the four unique plans in the intended upgrade order", () => {
    expect(pricingPlans.map((plan) => plan.id)).toEqual([
      "smoke-test",
      "regression-runner",
      "root-cause-analyst",
      "release-manager",
    ]);
    expect(new Set(pricingPlans.map((plan) => plan.id)).size).toBe(pricingPlans.length);
  });

  it("has exactly one free and one recommended plan", () => {
    expect(pricingPlans.filter((plan) => plan.isFree)).toHaveLength(1);
    expect(pricingPlans.filter((plan) => plan.recommended)).toHaveLength(1);
  });
});
