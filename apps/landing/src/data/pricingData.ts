export type PlanId = "smoke-test" | "regression-runner" | "root-cause-analyst" | "release-manager";

export interface PricingPlan {
  id: PlanId;
  isFree?: boolean;
  recommended?: boolean;
}

export const pricingPlans: PricingPlan[] = [
  { id: "smoke-test", isFree: true },
  { id: "regression-runner" },
  { id: "root-cause-analyst", recommended: true },
  { id: "release-manager" },
];
