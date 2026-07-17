export type PlanId = "smoke-test" | "regression-runner" | "root-cause-analyst" | "release-manager";

export interface PricingPlan {
  id: PlanId;
  price: number;
  recommended?: boolean;
}

export const pricingPlans: PricingPlan[] = [
  { id: "smoke-test", price: 0 },
  { id: "regression-runner", price: 19 },
  { id: "root-cause-analyst", price: 39, recommended: true },
  { id: "release-manager", price: 69 },
];

export interface VoucherCode {
  code: string;
  percentOff: number;
}

export const voucherCodes: VoucherCode[] = [
  { code: "QASANDBOX10", percentOff: 10 },
  { code: "TESTEBEM20", percentOff: 20 },
];
