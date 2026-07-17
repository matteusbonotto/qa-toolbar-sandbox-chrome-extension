export type PlanId = "smoke-test" | "regression-runner" | "root-cause-analyst" | "release-manager";

export interface PricingPlan {
  id: PlanId;
  priceMonthly: number;
  /** Total charged per year (already discounted vs. 12x the monthly price). */
  priceYearly: number;
  recommended?: boolean;
}

export const pricingPlans: PricingPlan[] = [
  { id: "smoke-test", priceMonthly: 0, priceYearly: 0 },
  { id: "regression-runner", priceMonthly: 19, priceYearly: 182 },
  { id: "root-cause-analyst", priceMonthly: 39, priceYearly: 374, recommended: true },
  { id: "release-manager", priceMonthly: 69, priceYearly: 662 },
];

export interface VoucherCode {
  code: string;
  percentOff: number;
}

export const voucherCodes: VoucherCode[] = [
  { code: "QASANDBOX10", percentOff: 10 },
  { code: "TESTEBEM20", percentOff: 20 },
];
