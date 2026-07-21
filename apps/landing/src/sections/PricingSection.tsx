import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import { pricingPlans, type PlanId } from "../data/pricingData";
import {
  loadAccessStatus,
  handoffSessionToExtension,
  loadPriceCatalog,
  previewVoucher,
  sendPasswordReset,
  sendSignInLink,
  signIn,
  signOut,
  signUp,
  startCheckout,
  type AccessStatus,
  type BillingCycle,
  type DisplayPrice,
  type PriceCatalog,
  type VoucherPreview,
} from "../services/checkout";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { useI18n } from "../i18n/I18nProvider";
import { SegmentedControl } from "../components/SegmentedControl";
import { OPEN_ACCOUNT_MODAL_EVENT } from "../lib/accountModal";

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
  const [voucherPreview, setVoucherPreview] = useState<VoucherPreview | null>(null);
  const [voucherChecking, setVoucherChecking] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<PlanId | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [queuedPlanId, setQueuedPlanId] = useState<PlanId | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(() => {
    const state = new URLSearchParams(window.location.search).get("checkout");
    if (state === "success") return t.pricing.paymentProcessing;
    if (state === "cancelled") return t.pricing.paymentCanceled;
    return null;
  });
  const [statusError, setStatusError] = useState(false);
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [storeListingStatus, setStoreListingStatus] = useState<{ chrome_web_store_version: string | null; status: string } | null>(null);
  const checkoutReturn = new URLSearchParams(window.location.search).get("checkout");

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from("store_listing_status")
      .select("chrome_web_store_version,status")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => { if (data) setStoreListingStatus(data); }, () => {});
  }, []);
  // The Store lags the package the moment its recorded version differs from what's actually
  // shipping, OR the founder hasn't marked it "live" yet — comparing status alone isn't enough,
  // since a stale "live" row from a previous version would otherwise read as caught up.
  const storeIsBehind = storeListingStatus
    ? storeListingStatus.status !== "live" || storeListingStatus.chrome_web_store_version !== __EXTENSION_PACKAGE_VERSION__
    : true;

  useEffect(() => {
    const openFromNavigation = () => {
      setQueuedPlanId(null);
      setAuthMessage(null);
      setAuthError(null);
      setAuthModalOpen(true);
    };
    window.addEventListener(OPEN_ACCOUNT_MODAL_EVENT, openFromNavigation);
    return () => window.removeEventListener(OPEN_ACCOUNT_MODAL_EVENT, openFromNavigation);
  }, []);

  useEffect(() => {
    if (!authModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAuthModalOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [authModalOpen]);

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
    // Only a genuine Stripe-redirect-back (`?checkout=success`) is a "step" the visitor is
    // actively waiting on — this same effect also fires for any already-logged-in visitor who
    // just opens the pricing page normally, to keep `access` fresh in the background. That
    // routine refresh was wrongly surfacing the checkout-failure banner on a transient/backend
    // hiccup even though the visitor never started a checkout, which is what made the page look
    // broken in prod. Only the actual checkout-return flow gets to touch the status banner now.
    const isCheckoutReturn = checkoutReturn === "success";
    let attempts = isCheckoutReturn ? 5 : 1;

    const refresh = async () => {
      try {
        const nextAccess = await loadAccessStatus();
        if (stopped) return;
        setAccess(nextAccess);
        if (nextAccess.active) {
          void handoffSessionToExtension(session);
          if (isCheckoutReturn) {
            setStatusError(false);
            setStatusMessage(t.pricing.accessActive);
          }
          return;
        }
      } catch {
        if (!stopped && isCheckoutReturn) {
          setStatusError(true);
          setStatusMessage(t.pricing.checkoutFailed);
        }
        return;
      }
      attempts -= 1;
      if (attempts > 0 && !stopped) {
        timer = window.setTimeout(() => void refresh(), 2_000);
      } else if (isCheckoutReturn && !stopped) {
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
    if (code === "voucher_already_redeemed") return t.pricing.voucherAlreadyRedeemed;
    if (code === "voucher_plan_mismatch") return t.pricing.voucherPlanMismatch;
    if (code === "authentication_required" || code === "invalid_session") return t.pricing.authRequired;
    if (code === "backend_not_configured") return t.pricing.configUnavailable;
    if (code === "subscription_already_exists") return t.pricing.alreadySubscribed;
    return t.pricing.checkoutFailed;
  }

  function messageForAuthError(error: unknown): string {
    const code = error instanceof Error ? error.message : "";
    if (code === "invalid_credentials") return t.pricing.invalidCredentials;
    if (code === "signup_failed") return t.pricing.signupFailed;
    if (code === "magic_link_failed") return t.pricing.checkoutFailed;
    if (code === "backend_not_configured") return t.pricing.configUnavailable;
    return t.pricing.checkoutFailed;
  }

  function openAuthModal(planId: PlanId | null = null) {
    setQueuedPlanId(planId);
    setAuthMessage(planId ? t.pricing.authRequired : null);
    setAuthError(null);
    setAuthModalOpen(true);
  }

  function closeAuthModal() {
    if (authBusy) return;
    setAuthModalOpen(false);
    setQueuedPlanId(null);
    setAuthMessage(null);
    setAuthError(null);
  }

  async function handleAuth(mode: "signin" | "signup") {
    setAuthError(null);
    setAuthMessage(null);
    if (!email.trim() || password.length < 8) {
      setAuthError(t.pricing.checkoutFailed);
      return;
    }
    if (mode === "signup" && !acceptedTerms) {
      setAuthError(t.pricing.termsRequired);
      return;
    }
    setAuthBusy(true);
    let planToStart: PlanId | null = null;
    try {
      const nextSession = mode === "signin"
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password);
      setPassword("");
      if (nextSession) {
        setSession(nextSession);
        planToStart = queuedPlanId;
        setQueuedPlanId(null);
        setAuthModalOpen(false);
      } else {
        setAuthMessage(t.pricing.confirmationSent);
      }
    } catch (error) {
      setAuthError(messageForAuthError(error));
    } finally {
      setAuthBusy(false);
    }
    if (planToStart) await completePlanSelection(planToStart);
  }

  async function handleSendSignInLink() {
    setAuthError(null);
    setAuthMessage(null);
    if (!email.trim()) {
      setAuthError(t.pricing.checkoutFailed);
      return;
    }
    setAuthBusy(true);
    try {
      await sendSignInLink(email.trim());
      setAuthMessage(t.pricing.emailLinkSent);
    } catch (error) {
      setAuthError(messageForAuthError(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleForgotPassword() {
    setAuthError(null);
    setAuthMessage(null);
    if (!email.trim()) {
      setAuthError(t.pricing.forgotPasswordEmailRequired);
      return;
    }
    setAuthBusy(true);
    try {
      await sendPasswordReset(email.trim());
      setAuthMessage(t.pricing.forgotPasswordSent);
    } catch {
      setAuthError(t.pricing.forgotPasswordFailed);
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
      setAuthMessage(null);
      setAuthError(null);
    } catch (error) {
      setStatusError(true);
      setStatusMessage(messageForError(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleApplyVoucher() {
    const code = voucherInput.trim().toUpperCase();
    if (!code) {
      setVoucherError(t.pricing.voucherErrorEmpty);
      setAppliedVoucher(null);
      setVoucherPreview(null);
      return;
    }
    if (!voucherPattern.test(code)) {
      setVoucherError(t.pricing.voucherErrorInvalid);
      setAppliedVoucher(null);
      setVoucherPreview(null);
      return;
    }
    setVoucherError(null);
    setVoucherChecking(true);
    try {
      const preview = await previewVoucher(code);
      if (!preview.valid) {
        setVoucherError(t.pricing.voucherErrorInvalid);
        setAppliedVoucher(null);
        setVoucherPreview(null);
        return;
      }
      setAppliedVoucher(code);
      setVoucherPreview(preview);
    } catch {
      setVoucherError(t.pricing.voucherErrorInvalid);
      setAppliedVoucher(null);
      setVoucherPreview(null);
    } finally {
      setVoucherChecking(false);
    }
  }

  async function completePlanSelection(planId: PlanId) {
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
        setVoucherPreview(null);
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

  async function handleSelectPlan(planId: PlanId) {
    if (!session) {
      openAuthModal(planId);
      return;
    }
    await completePlanSelection(planId);
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

        {authModalOpen ? createPortal(
          // Portaled straight to <body>: .qts-page-content (an ancestor here) sets its own
          // position+z-index to sit above the particle canvas, which makes it a stacking
          // context — so the modal's z-index:100 was only ever winning against siblings
          // *inside* that context, never against the sticky nav bar (z-index:50) outside it.
          // Tall modal content pushed the close button up into the nav's band and the nav won
          // the hit-test despite the "higher" z-index. Escaping to body sidesteps that entirely.
          <div className="qts-auth-overlay" onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAuthModal();
          }}>
            <div className="qts-auth-modal" role="dialog" aria-modal="true" aria-labelledby="qts-auth-title">
              <button type="button" className="qts-auth-close" aria-label={t.pricing.closeModal} onClick={closeAuthModal}>×</button>
              <span className="qts-eyebrow">QA Toolbar Sandbox</span>
              <h3 id="qts-auth-title">{t.pricing.accountTitle}</h3>
              <p>{t.pricing.accountLead}</p>
              {session ? (
                <div className="qts-auth-session">
                  <span>{t.pricing.signedInAs} <strong>{session.user.email}</strong></span>
                  <button type="button" className="qts-btn qts-btn-ghost" disabled={authBusy} onClick={() => void handleSignOut()}>
                    {t.pricing.signOut}
                  </button>
                </div>
              ) : (
                <>
                  <div className="qts-auth-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected={authMode === "signin"} className={authMode === "signin" ? "is-active" : ""} onClick={() => {
                      setAuthMode("signin"); setAuthError(null); setAuthMessage(null);
                    }}>{t.pricing.signIn}</button>
                    <button type="button" role="tab" aria-selected={authMode === "signup"} className={authMode === "signup" ? "is-active" : ""} onClick={() => {
                      setAuthMode("signup"); setAuthError(null); setAuthMessage(null);
                    }}>{t.pricing.signUp}</button>
                  </div>
                  <form className="qts-auth-form" onSubmit={(event) => {
                    event.preventDefault(); void handleAuth(authMode);
                  }}>
                    <label>
                      <span>{t.pricing.emailLabel}</span>
                      <input type="email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
                    </label>
                    <label>
                      <span>{t.pricing.passwordLabel}</span>
                      <input type="password" minLength={8} autoComplete={authMode === "signup" ? "new-password" : "current-password"} required value={password} onChange={(event) => setPassword(event.target.value)} />
                    </label>
                    {authMode === "signup" ? (
                      <label className="qts-terms-check">
                        <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
                        <span>{t.pricing.acceptTerms} <a href={`${import.meta.env.BASE_URL}privacidade`}>{t.pricing.privacyLink}</a>.</span>
                      </label>
                    ) : null}
                    {authMessage ? <div className="qts-auth-feedback" role="status">{authMessage}</div> : null}
                    {authError ? <div className="qts-auth-feedback is-error" role="alert">{authError}</div> : null}
                    <button type="submit" className="qts-btn qts-btn-primary qts-auth-submit" disabled={authBusy || (authMode === "signup" && !acceptedTerms)}>
                      {authBusy ? t.pricing.working : authMode === "signin" ? t.pricing.signIn : t.pricing.signUp}
                    </button>
                    {authMode === "signin" ? (
                      <>
                        <button type="button" className="qts-auth-link" disabled={authBusy} onClick={() => void handleSendSignInLink()}>
                          {t.pricing.emailLink}
                        </button>
                        <button type="button" className="qts-auth-link" disabled={authBusy} onClick={() => void handleForgotPassword()}>
                          {t.pricing.forgotPassword}
                        </button>
                      </>
                    ) : null}
                  </form>
                </>
              )}
            </div>
          </div>,
          document.body,
        ) : null}

        {access?.active ? (
          <div className="qts-access-panel" role="status">
            <div>
              <strong>{t.pricing.accessActive}: {access.plan?.name}</strong>
              <span>{accessExpiry ? `${t.pricing.accessExpires} ${accessExpiry}` : t.pricing.accessPermanent}</span>
            </div>
            <div className="qts-access-panel-actions">
              {access.installUrl ? (
                <a className="qts-btn qts-btn-primary" href={access.installUrl} target="_blank" rel="noreferrer">
                  {t.pricing.installExtension}
                </a>
              ) : null}
              <a
                className="qts-btn qts-btn-ghost"
                href={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-extension.zip`}
                download
              >
                {t.pricing.downloadExtensionZip}
              </a>
            </div>
          </div>
        ) : null}
        {access?.active ? <p className="qts-manual-install-hint">{t.pricing.downloadExtensionHint}</p> : null}
        {access?.active ? (
          <p className="qts-version-line">
            {t.pricing.packageVersionLine.replace("{version}", __EXTENSION_PACKAGE_VERSION__)}
            {storeIsBehind ? <span className="qts-version-pending"> · {t.pricing.storeReviewPendingNotice}</span> : null}
          </p>
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
              if (appliedVoucher) { setAppliedVoucher(null); setVoucherPreview(null); }
            }}
          />
          <button type="button" className="qts-btn qts-btn-ghost" onClick={() => void handleApplyVoucher()} disabled={voucherChecking}>
            {voucherChecking ? t.pricing.working : t.pricing.voucherApply}
          </button>
          {appliedVoucher && !voucherPreview ? (
            <span className="qts-voucher-applied">{appliedVoucher} {t.pricing.voucherQueued}</span>
          ) : null}
          {voucherError ? <span className="qts-voucher-error">{voucherError}</span> : null}
        </div>

        {voucherPreview?.valid ? (
          <div className="qts-voucher-preview" role="status">
            <span className="qts-voucher-preview-badge">{t.pricing.voucherPreviewBadge}</span>
            <strong>{voucherPreview.label}</strong>
            <p>
              {voucherPreview.kind === "lifetime"
                ? t.pricing.voucherPreviewLifetime.replace("{plan}", voucherPreview.plan?.name ?? "")
                : voucherPreview.kind === "days"
                  ? t.pricing.voucherPreviewDays
                      .replace("{days}", String(voucherPreview.grantDays ?? ""))
                      .replace("{plan}", voucherPreview.plan?.name ?? "")
                  : t.pricing.voucherPreviewDiscount
                      .replace("{value}", voucherPreview.discountPercentOff
                        ? `${voucherPreview.discountPercentOff}%`
                        : formatPrice({ amountMinor: voucherPreview.discountAmountOffMinor ?? 0, currency: "brl" }, locale, ""))
                      .replace("{plan}", voucherPreview.plan?.name ?? t.pricing.voucherPreviewAnyPlan)}
            </p>
          </div>
        ) : null}

        <div className="qts-pricing-grid">
          {pricingPlans.map((plan) => {
            const planText = t.pricing.plans[plan.id];
            const price = priceCatalog[plan.id]?.[billingCycle];
            const unavailable = pricingError ? "—" : t.pricing.working;
            // Gate on `billing` (present only when a real Stripe subscription row backs the
            // access), not on `access.active` in general — a founder/courtesy grant with no
            // Stripe subscription (apps/admin's AccessPage supports granting access without a
            // plan) is "active" but never blocks checkout-create-session server-side, so it
            // must not block a purchase here either.
            const hasBlockingSubscription = access?.billing != null;
            const isCurrentPlan = hasBlockingSubscription && access?.plan?.key === plan.id;
            const isBlockedByOtherPlan = hasBlockingSubscription && access?.plan?.key !== plan.id;
            const voucherTargetsPlan = Boolean(voucherPreview?.valid)
              && (voucherPreview?.plan == null || voucherPreview.plan.key === plan.id);
            return (
              <div key={plan.id} className={`qts-plan-card${plan.recommended ? " is-recommended" : ""}${isCurrentPlan ? " is-current-plan" : ""}${voucherTargetsPlan ? " is-voucher-highlight" : ""}`}>
                {plan.recommended ? <span className="qts-plan-badge">{t.pricing.recommendedBadge}</span> : null}
                {isCurrentPlan ? <span className="qts-plan-badge qts-plan-badge-current">{t.pricing.currentPlanBadge}</span> : null}
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
                  disabled={pendingPlanId !== null || (!plan.isFree && !price) || isCurrentPlan || isBlockedByOtherPlan}
                  title={isBlockedByOtherPlan ? t.pricing.alreadySubscribed : undefined}
                >
                  {pendingPlanId === plan.id
                    ? t.pricing.working
                    : isCurrentPlan
                      ? t.pricing.currentPlanCta
                      : isBlockedByOtherPlan
                        ? t.pricing.unavailableWhileSubscribed
                        : voucherTargetsPlan && voucherPreview?.kind === "lifetime"
                          ? t.pricing.ctaLifetime
                          : voucherTargetsPlan && voucherPreview?.kind === "days"
                            ? t.pricing.ctaDaysVoucher.replace("{days}", String(voucherPreview.grantDays ?? ""))
                            : voucherTargetsPlan && voucherPreview?.kind === "discount"
                              ? t.pricing.ctaDiscount
                              : plan.isFree ? t.pricing.ctaFree : t.pricing.ctaPaid}
                </button>
              </div>
            );
          })}
        </div>
        {access?.billing != null ? <p className="qts-plan-change-hint">{t.pricing.alreadySubscribed}</p> : null}
      </div>
    </section>
  );
}
