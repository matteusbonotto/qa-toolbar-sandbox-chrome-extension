import { useMemo, useState } from "react";
import { pricingPlans, voucherCodes } from "../data/pricingData";
import { startCheckout } from "../services/checkout";
import { useI18n } from "../i18n/I18nProvider";
import { SegmentedControl } from "../components/SegmentedControl";

type BillingCycle = "monthly" | "yearly";

function formatPrice(value: number, locale: string, freeLabel: string): string {
  if (value === 0) return freeLabel;
  const currency = locale === "en" ? "USD" : "BRL";
  const localeTag = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR";
  return value.toLocaleString(localeTag, { style: "currency", currency, minimumFractionDigits: 0 });
}

export function PricingSection() {
  const { t, locale } = useI18n();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("yearly");
  const [voucherInput, setVoucherInput] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState<{ code: string; percentOff: number } | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<Record<string, boolean>>({});
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);

  function handleApplyVoucher() {
    const code = voucherInput.trim().toUpperCase();
    if (!code) {
      setVoucherError(t.pricing.voucherErrorEmpty);
      setAppliedVoucher(null);
      return;
    }
    const match = voucherCodes.find((v) => v.code === code);
    if (!match) {
      setVoucherError(t.pricing.voucherErrorInvalid);
      setAppliedVoucher(null);
      return;
    }
    setVoucherError(null);
    setAppliedVoucher(match);
  }

  async function handleSelectPlan(planId: string) {
    setPendingPlanId(planId);
    await startCheckout({ planId, voucherCode: appliedVoucher?.code ?? null });
    setCheckoutStatus((prev) => ({ ...prev, [planId]: true }));
    setPendingPlanId(null);
  }

  const discountedPrices = useMemo(() => {
    const percentOff = appliedVoucher?.percentOff ?? 0;
    return Object.fromEntries(
      pricingPlans.map((plan) => {
        const base = billingCycle === "yearly" ? plan.priceYearly : plan.priceMonthly;
        return [plan.id, Math.round(base * (1 - percentOff / 100))];
      }),
    );
  }, [appliedVoucher, billingCycle]);

  return (
    <section className="qts-section" id="planos">
      <div className="qts-container">
        <span className="qts-eyebrow">{t.pricing.eyebrow}</span>
        <h2>{t.pricing.title}</h2>
        <p className="qts-section-lead">{t.pricing.lead}</p>

        <div className="qts-billing-toggle-row">
          <SegmentedControl
            label=""
            value={billingCycle}
            onChange={(value) => setBillingCycle(value as BillingCycle)}
            options={[
              { id: "monthly", label: t.pricing.billingMonthly },
              { id: "yearly", label: `${t.pricing.billingYearly} · ${t.pricing.billingYearlySavings}` },
            ]}
          />
        </div>

        <div className="qts-voucher-row">
          <input
            type="text"
            className="qts-voucher-input"
            placeholder={t.pricing.voucherPlaceholder}
            value={voucherInput}
            onChange={(event) => setVoucherInput(event.target.value)}
          />
          <button type="button" className="qts-btn qts-btn-ghost" onClick={handleApplyVoucher}>
            {t.pricing.voucherApply}
          </button>
          {appliedVoucher ? (
            <span className="qts-voucher-applied">
              {appliedVoucher.code} {t.pricing.voucherAppliedSuffix} — {appliedVoucher.percentOff}%
            </span>
          ) : null}
          {voucherError ? <span className="qts-voucher-error">{voucherError}</span> : null}
        </div>

        <div className="qts-pricing-grid">
          {pricingPlans.map((plan) => {
            const planText = t.pricing.plans[plan.id];
            const isFree = plan.priceMonthly === 0;
            const periodLabel = billingCycle === "yearly" ? t.pricing.perYear : t.pricing.perMonth;
            return (
              <div key={plan.id} className={`qts-plan-card${plan.recommended ? " is-recommended" : ""}`}>
                {plan.recommended ? <span className="qts-plan-badge">{t.pricing.recommendedBadge}</span> : null}
                <h3>{planText.name}</h3>
                <p className="qts-plan-tagline">{planText.tagline}</p>
                <div className="qts-plan-price">
                  <strong>{formatPrice(discountedPrices[plan.id] ?? 0, locale, t.pricing.free)}</strong>
                  <span>{isFree ? t.pricing.freeNote : periodLabel}</span>
                </div>
                <ul className="qts-plan-features">
                  {planText.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`qts-btn ${plan.recommended ? "qts-btn-primary" : "qts-btn-ghost"} qts-plan-cta`}
                  onClick={() => handleSelectPlan(plan.id)}
                  disabled={pendingPlanId === plan.id}
                >
                  {isFree ? t.pricing.ctaFree : t.pricing.ctaPaid}
                </button>
                {checkoutStatus[plan.id] ? <p className="qts-plan-status">{t.pricing.checkoutPending}</p> : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
