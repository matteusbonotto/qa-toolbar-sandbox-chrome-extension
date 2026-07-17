import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { pricingPlans, type PlanId } from "../data/pricingData";
import {
  loadAccessStatus,
  loadPriceCatalog,
  signIn,
  signOut,
  signUp,
  startCheckout,
  type AccessStatus,
  type BillingCycle,
  type DisplayPrice,
  type PriceCatalog,
} from "../services/checkout";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { useI18n } from "../i18n/I18nProvider";
import { SegmentedControl } from "../components/SegmentedControl";

const voucherPattern = /^[A-Z0-9-]{6,64}$/;

function formatPrice(price: DisplayPrice | undefined, locale: string, unavailable: string): string {
  if (!price) return unavailable;
  const localeTag = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR";
  return (price.amountMinor / 100).toLocaleString(localeTag, {
    style: "currency",
    currency: price.currency.toUpperCase(),
  });
}

export function PricingSection() {
  const { t, locale } = useI18n();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("yearly");
  const [priceCatalog, setPriceCatalog] = useState<PriceCatalog>({});
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [voucherInput, setVoucherInput] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState<string | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<PlanId | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(() => {
    const state = new URLSearchParams(window.location.search).get("checkout");
    if (state === "success") return t.pricing.paymentProcessing;
    if (state === "cancelled") return t.pricing.paymentCanceled;
    return null;
  });
  const [statusError, setStatusError] = useState(false);
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const checkoutReturn = new URLSearchParams(window.location.search).get("checkout");

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setPricingError(t.pricing.configUnavailable);
      return;
    }
    const client = supabase;
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: authSubscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    void loadPriceCatalog()
      .then((catalog) => {
        setPriceCatalog(catalog);
        setPricingError(null);
      })
      .catch(() => setPricingError(t.pricing.pricingUnavailable));
    return () => authSubscription.subscription.unsubscribe();
  }, [t.pricing.configUnavailable, t.pricing.pricingUnavailable]);

  useEffect(() => {
    if (!session) {
      setAccess(null);
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    let attempts = checkoutReturn === "success" ? 5 : 1;

    const refresh = async () => {
      try {
        const nextAccess = await loadAccessStatus();
        if (stopped) return;
        setAccess(nextAccess);
        if (nextAccess.active) {
          setStatusError(false);
          setStatusMessage(t.pricing.accessActive);
          return;
        }
      } catch {
        if (!stopped) {
          setStatusError(true);
          setStatusMessage(t.pricing.checkoutFailed);
        }
        return;
      }
      attempts -= 1;
      if (attempts > 0 && !stopped) {
        timer = window.setTimeout(() => void refresh(), 2_000);
      } else if (checkoutReturn === "success" && !stopped) {
        setStatusError(false);
        setStatusMessage(t.pricing.paymentProcessing);
      }
    };
    void refresh();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [checkoutReturn, session, t.pricing.accessActive, t.pricing.checkoutFailed, t.pricing.paymentProcessing]);

  function messageForError(error: unknown): string {
    const code = error instanceof Error ? error.message : "";
    if (code === "voucher_unavailable") return t.pricing.voucherErrorInvalid;
    if (code === "authentication_required" || code === "invalid_session") return t.pricing.authRequired;
    if (code === "backend_not_configured") return t.pricing.configUnavailable;
    return t.pricing.checkoutFailed;
  }

  async function handleAuth(mode: "signin" | "signup") {
    setStatusError(false);
    if (!email.trim() || password.length < 8 || (mode === "signup" && !acceptedTerms)) {
      setStatusError(true);
      setStatusMessage(t.pricing.checkoutFailed);
      return;
    }
    setAuthBusy(true);
    try {
      const nextSession = mode === "signin"
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password);
      setPassword("");
      if (nextSession) {
        setSession(nextSession);
        setStatusMessage(null);
      } else {
        setStatusMessage(t.pricing.confirmationSent);
      }
    } catch (error) {
      setStatusError(true);
      setStatusMessage(messageForError(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    try {
      await signOut();
      setAccess(null);
      setStatusMessage(null);
    } catch (error) {
      setStatusError(true);
      setStatusMessage(messageForError(error));
    } finally {
      setAuthBusy(false);
    }
  }

  function handleApplyVoucher() {
    const code = voucherInput.trim().toUpperCase();
    if (!code) {
      setVoucherError(t.pricing.voucherErrorEmpty);
      setAppliedVoucher(null);
      return;
    }
    if (!voucherPattern.test(code)) {
      setVoucherError(t.pricing.voucherErrorInvalid);
      setAppliedVoucher(null);
      return;
    }
    setVoucherError(null);
    setAppliedVoucher(code);
  }

  async function handleSelectPlan(planId: PlanId) {
    if (!session) {
      setStatusError(true);
      setStatusMessage(t.pricing.authRequired);
      return;
    }
    setPendingPlanId(planId);
    setStatusError(false);
    setStatusMessage(null);
    try {
      const result = await startCheckout({ planId, billingCycle, voucherCode: appliedVoucher });
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.accessGranted) {
        const nextAccess = await loadAccessStatus();
        setAccess(nextAccess);
        setAppliedVoucher(null);
        setVoucherInput("");
        setStatusMessage(t.pricing.accessActive);
      }
    } catch (error) {
      setStatusError(true);
      setStatusMessage(messageForError(error));
    } finally {
      setPendingPlanId(null);
    }
  }

  const accessExpiry = access?.expiresAt
    ? new Date(access.expiresAt).toLocaleDateString(locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR")
    : null;

  return (
    <section className="qts-section" id="planos">
      <div className="qts-container">
        <span className="qts-eyebrow">{t.pricing.eyebrow}</span>
        <h2>{t.pricing.title}</h2>
        <p className="qts-section-lead">{t.pricing.lead}</p>

        <div className="qts-account-panel">
          <div>
            <h3>{t.pricing.accountTitle}</h3>
            <p>{t.pricing.accountLead}</p>
          </div>
          {session ? (
            <div className="qts-account-session">
              <span>{t.pricing.signedInAs} <strong>{session.user.email}</strong></span>
              <button type="button" className="qts-btn qts-btn-ghost" disabled={authBusy} onClick={() => void handleSignOut()}>
                {t.pricing.signOut}
              </button>
            </div>
          ) : (
            <div className="qts-account-form">
              <input
                type="email"
                autoComplete="email"
                className="qts-voucher-input"
                aria-label={t.pricing.emailLabel}
                placeholder={t.pricing.emailLabel}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <input
                type="password"
                minLength={8}
                autoComplete="current-password"
                className="qts-voucher-input"
                aria-label={t.pricing.passwordLabel}
                placeholder={t.pricing.passwordLabel}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <label className="qts-terms-check">
                <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
                <span>{t.pricing.acceptTerms} <a href={`${import.meta.env.BASE_URL}privacidade`}>{t.pricing.privacyLink}</a>.</span>
              </label>
              <div className="qts-account-actions">
                <button type="button" className="qts-btn qts-btn-ghost" disabled={authBusy} onClick={() => void handleAuth("signin")}>
                  {authBusy ? t.pricing.working : t.pricing.signIn}
                </button>
                <button type="button" className="qts-btn qts-btn-primary" disabled={authBusy || !acceptedTerms} onClick={() => void handleAuth("signup")}>
                  {authBusy ? t.pricing.working : t.pricing.signUp}
                </button>
              </div>
            </div>
          )}
        </div>

        {access?.active ? (
          <div className="qts-access-panel" role="status">
            <div>
              <strong>{t.pricing.accessActive}: {access.plan?.name}</strong>
              <span>{accessExpiry ? `${t.pricing.accessExpires} ${accessExpiry}` : t.pricing.accessPermanent}</span>
            </div>
            {access.installUrl ? (
              <a className="qts-btn qts-btn-primary" href={access.installUrl} target="_blank" rel="noreferrer">
                {t.pricing.installExtension}
              </a>
            ) : null}
          </div>
        ) : null}
        {statusMessage ? <p className={`qts-checkout-message${statusError ? " is-error" : ""}`} role="status">{statusMessage}</p> : null}
        {pricingError ? <p className="qts-checkout-message is-error" role="alert">{pricingError}</p> : null}

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
            onChange={(event) => {
              setVoucherInput(event.target.value);
              if (appliedVoucher) setAppliedVoucher(null);
            }}
          />
          <button type="button" className="qts-btn qts-btn-ghost" onClick={handleApplyVoucher}>
            {t.pricing.voucherApply}
          </button>
          {appliedVoucher ? (
            <span className="qts-voucher-applied">{appliedVoucher} {t.pricing.voucherQueued}</span>
          ) : null}
          {voucherError ? <span className="qts-voucher-error">{voucherError}</span> : null}
        </div>

        <div className="qts-pricing-grid">
          {pricingPlans.map((plan) => {
            const planText = t.pricing.plans[plan.id];
            const price = priceCatalog[plan.id]?.[billingCycle];
            const unavailable = pricingError ? "—" : t.pricing.working;
            return (
              <div key={plan.id} className={`qts-plan-card${plan.recommended ? " is-recommended" : ""}`}>
                {plan.recommended ? <span className="qts-plan-badge">{t.pricing.recommendedBadge}</span> : null}
                <h3>{planText.name}</h3>
                <p className="qts-plan-tagline">{planText.tagline}</p>
                <div className="qts-plan-price">
                  <strong>{plan.isFree ? t.pricing.free : formatPrice(price, locale, unavailable)}</strong>
                  <span>{plan.isFree ? t.pricing.freeNote : billingCycle === "yearly" ? t.pricing.perYear : t.pricing.perMonth}</span>
                </div>
                <ul className="qts-plan-features">
                  {planText.features.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
                <button
                  type="button"
                  className={`qts-btn ${plan.recommended ? "qts-btn-primary" : "qts-btn-ghost"} qts-plan-cta`}
                  onClick={() => void handleSelectPlan(plan.id)}
                  disabled={pendingPlanId !== null || (!plan.isFree && !price)}
                >
                  {pendingPlanId === plan.id ? t.pricing.working : plan.isFree ? t.pricing.ctaFree : t.pricing.ctaPaid}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
