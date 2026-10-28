import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "../components/Icon";
import { Reveal } from "../components/Reveal";
import { Toast } from "../components/Toast";
import type { Session } from "@supabase/supabase-js";
import { pricingPlans, type PlanId } from "../data/pricingData";
import {
  cancelAccess,
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
import { authRedirectOnLoad, isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import {
  ACCESS_CHANGED_STORAGE_KEY,
  attachEmailToPendingIntent,
  claimPendingIntent,
  clearPendingIntentIfOwned,
  isAuthLinkArrival,
  notifyAccessChanged,
  savePendingIntent,
  withPendingIntentLock,
  type PendingPlanIntent,
} from "../lib/pendingPlanIntent";
import { emailDomainAllowed, formatAllowedDomains } from "../lib/voucherDomains";
import { useI18n } from "../i18n/I18nProvider";
import { SegmentedControl } from "../components/SegmentedControl";
import { OPEN_ACCOUNT_MODAL_EVENT } from "../lib/accountModal";

const voucherPattern = /^[A-Z0-9-]{6,64}$/;
const voucherErrorCodes = new Set([
  "voucher_unavailable",
  "voucher_already_redeemed",
  "voucher_plan_mismatch",
  "voucher_domain_not_allowed",
]);

function scrollToPricing() {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // One frame later so the notice/panel that triggered the scroll is already laid out.
  requestAnimationFrame(() => {
    document.getElementById("planos")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const partsB = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

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
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [priceCatalog, setPriceCatalog] = useState<PriceCatalog>({});
  const [pricingLoading, setPricingLoading] = useState(true);
  const [pricingError, setPricingError] = useState<string | null>(null);
  // Derived from the real catalog (not a fixed marketing number) so this badge can never
  // diverge from the monthly/yearly prices actually charged - see docs/CHECKLIST_BUGFIX_PASS2.md
  // note about hardcoded discount claims.
  const yearlySavingsPercent = useMemo(() => {
    let max = 0;
    for (const plan of pricingPlans) {
      const monthly = priceCatalog[plan.id]?.monthly;
      const yearly = priceCatalog[plan.id]?.yearly;
      if (!monthly || !yearly || monthly.amountMinor <= 0) continue;
      const percent = Math.round((1 - yearly.amountMinor / (monthly.amountMinor * 12)) * 100);
      if (percent > max) max = percent;
    }
    return max;
  }, [priceCatalog]);
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
  const authTriggerRef = useRef<HTMLElement | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; terms?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [queuedPlanId, setQueuedPlanId] = useState<PlanId | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(() => {
    // An expired/used confirmation or magic link lands here with the error in the URL; the visitor
    // is at the top of the page, so the (top-centered, non-dismissing) toast is where they look.
    if (authRedirectOnLoad === "error") return t.pricing.authLinkError;
    const state = new URLSearchParams(window.location.search).get("checkout");
    if (state === "success") return t.pricing.paymentProcessing;
    if (state === "cancelled") return t.pricing.paymentCanceled;
    return null;
  });
  const [statusError, setStatusError] = useState(() => authRedirectOnLoad === "error");
  // Inline, persistent feedback (founder report 2026-10-28: a toast that vanished after a few
  // seconds, far from where the visitor was looking, left them with "no feedback at all").
  const [planFeedback, setPlanFeedback] = useState<{ planId: PlanId; message: string } | null>(null);
  const [resumeNotice, setResumeNotice] = useState<{
    tone: "info" | "error";
    message: string;
    hideWhenActive?: boolean;
    // In progress: spinner instead of icon and no close button until it settles.
    busy?: boolean;
    action?: { label: string; onClick: () => void };
  } | null>(null);
  const [redeemedVoucher, setRedeemedVoucher] = useState<{ code: string; label: string | null } | null>(null);
  // Mirrors the localStorage intent so a browser with storage disabled still resumes after an
  // in-page sign in (it just cannot survive the e-mail round trip, which needs a new page load).
  const memoryIntentRef = useRef<PendingPlanIntent | null>(null);
  // Only when saving to localStorage failed may the in-memory copy be resumed: otherwise another
  // tab may already have claimed (and redeemed) the stored one, and this copy would redeem twice.
  const intentOnlyInMemoryRef = useRef(false);
  // True once the visitor was told to finish in their e-mail: closing the modal then must keep the
  // saved intent, because the link they are about to open depends on it.
  const awaitingEmailRef = useRef(false);
  const resumeAttemptedRef = useRef(false);
  // Supabase shares a new session with every open tab of the site. Only the tab that came from the
  // e-mail link, or the tab whose own form created the session, may resume a pending intent: a tab
  // that merely received the session by cross-tab sync must never redeem or redirect to Stripe in
  // a window the visitor is not looking at (code review 2026-10-28, M1).
  const signedInHereRef = useRef(false);
  // Escape is handled inside an effect bound once per modal opening; going through this ref keeps
  // it on the same rules as the close button instead of a stale copy of closeAuthModal.
  const closeAuthModalRef = useRef<() => void>(() => undefined);
  const awaitingTitleRef = useRef<HTMLHeadingElement>(null);
  // Text of the "check your e-mail" panel that replaces the form once a plan waits for the link.
  const [awaitingPanel, setAwaitingPanel] = useState<string | null>(null);
  const [redirectingToStripe, setRedirectingToStripe] = useState(false);
  // Bumped whenever access is written by a redemption or another tab, so an older in-flight
  // background refresh (started before the redemption) cannot overwrite it with "inactive".
  const accessWriteRef = useRef(0);
  const accessTitleRef = useRef<HTMLHeadingElement>(null);
  const [focusAccessPanel, setFocusAccessPanel] = useState(false);

  useEffect(() => {
    // Errors stay until the visitor closes them; only neutral/success messages auto-dismiss.
    if (!statusMessage || statusError) return;
    // 6s: about two readings of a one-line message at an average pace, short enough to get out of
    // the way. Errors are never auto-dismissed (see the guard above).
    const timer = window.setTimeout(() => setStatusMessage(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [statusMessage, statusError]);

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
      .then(({ data, error }) => {
        if (!error && data) setStoreListingStatus(data);
      });
  }, []);
  // The Store lags the package when the founder hasn't marked it "live" yet, or when its recorded
  // version is numerically behind what's actually shipping - a plain !== would also flag a store
  // version that's merely formatted differently (or, after a rollback, actually ahead) as "behind",
  // showing a confusing pending-review notice for a package that's already caught up.
  const storeIsBehind = storeListingStatus
    ? storeListingStatus.status !== "live"
      || !storeListingStatus.chrome_web_store_version
      || compareVersions(__EXTENSION_PACKAGE_VERSION__, storeListingStatus.chrome_web_store_version) > 0
    : true;

  useEffect(() => {
    const openFromNavigation = () => {
      authTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQueuedPlanId(null);
      setAuthMessage(null);
      setAuthError(null);
      setAwaitingPanel(null);
      setAuthModalOpen(true);
    };
    window.addEventListener(OPEN_ACCOUNT_MODAL_EVENT, openFromNavigation);
    return () => window.removeEventListener(OPEN_ACCOUNT_MODAL_EVENT, openFromNavigation);
  }, []);

  useEffect(() => {
    if (!authModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = authTriggerRef.current;
    const appRoot = document.getElementById("root");
    const focusableSelector = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
    const handleModalKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAuthModalRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const modal = document.querySelector<HTMLElement>(".qts-auth-modal");
      const focusable = [...(modal?.querySelectorAll<HTMLElement>(focusableSelector) || [])].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    appRoot?.setAttribute("inert", "");
    appRoot?.setAttribute("aria-hidden", "true");
    document.addEventListener("keydown", handleModalKeys);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".qts-auth-modal input,.qts-auth-modal button")?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      appRoot?.removeAttribute("inert");
      appRoot?.removeAttribute("aria-hidden");
      document.removeEventListener("keydown", handleModalKeys);
      previouslyFocused?.focus();
      authTriggerRef.current = null;
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
    setPricingLoading(true);
    void loadPriceCatalog()
      .then((catalog) => {
        setPriceCatalog(catalog);
        setPricingError(null);
      })
      .catch(() => setPricingError(t.pricing.pricingUnavailable))
      .finally(() => setPricingLoading(false));
    return () => authSubscription.subscription.unsubscribe();
  }, [t.pricing.configUnavailable, t.pricing.pricingUnavailable]);

  useEffect(() => {
    if (!session) {
      setAccess(null);
      return;
    }
    // Keep the extension session aligned with the website as soon as Supabase restores or creates
    // it. Retry briefly because a user can download/install the extension while this page is
    // already open; installing it does not cause React or Supabase to emit another session event.
    let handoffAttempts = 0;
    let handoffTimer: number | undefined;
    const syncExtensionSession = async () => {
      handoffAttempts += 1;
      const accepted = await handoffSessionToExtension(session);
      if (accepted && handoffTimer !== undefined) {
        window.clearInterval(handoffTimer);
        handoffTimer = undefined;
      }
    };
    void syncExtensionSession();
    handoffTimer = window.setInterval(() => {
      if (handoffAttempts >= 60) window.clearInterval(handoffTimer);
      else void syncExtensionSession();
    }, 5_000);
    let stopped = false;
    let timer: number | undefined;
    // Only a genuine Stripe-redirect-back (`?checkout=success`) is a "step" the visitor is
    // actively waiting on - this same effect also fires for any already-logged-in visitor who
    // just opens the pricing page normally, to keep `access` fresh in the background. That
    // routine refresh was wrongly surfacing the checkout-failure banner on a transient/backend
    // hiccup even though the visitor never started a checkout, which is what made the page look
    // broken in prod. Only the actual checkout-return flow gets to touch the status banner now.
    const isCheckoutReturn = checkoutReturn === "success";
    let attempts = isCheckoutReturn ? 5 : 1;
    // This effect re-runs on every `session` reference change, not just on a real sign-in - a
    // same-session Supabase auth event (e.g. TOKEN_REFRESHED, fired automatically soon after
    // sign-in) swaps in a new session object and restarts this whole effect from scratch. Once
    // we've confirmed access is active during this effect's lifetime, a single subsequent
    // "inactive" read is more likely a transient backend/race blip than a real revocation -
    // demoting the panel on that alone is what made a working download card flash and vanish.
    let confirmedActive = false;
    let demoteRetries = 0;

    const refresh = async () => {
      const writeAtStart = accessWriteRef.current;
      try {
        const nextAccess = await loadAccessStatus();
        if (stopped) return;
        // A redemption (or another tab) wrote fresher access while this read was in flight.
        if (accessWriteRef.current !== writeAtStart) return;
        if (nextAccess.active) {
          confirmedActive = true;
          setAccess(nextAccess);
          if (isCheckoutReturn) {
            setStatusError(false);
            setStatusMessage(t.pricing.accessActive);
          }
          return;
        }
        if (confirmedActive && demoteRetries < 2) {
          demoteRetries += 1;
          timer = window.setTimeout(() => void refresh(), 2_000);
          return;
        }
        setAccess(nextAccess);
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
      if (handoffTimer !== undefined) window.clearInterval(handoffTimer);
    };
  }, [checkoutReturn, session, t.pricing.accessActive, t.pricing.checkoutFailed, t.pricing.paymentProcessing]);

  function planName(planId: PlanId): string {
    return t.pricing.plans[planId]?.name ?? planId;
  }

  function domainNotAllowedMessage(domains: string[] | null | undefined): string {
    return domains?.length
      ? t.pricing.voucherDomainNotAllowed.replace("{domains}", formatAllowedDomains(domains))
      : t.pricing.voucherDomainNotAllowedGeneric;
  }

  function messageForError(error: unknown, voucherDomains?: string[] | null): string {
    const code = error instanceof Error ? error.message : "";
    if (code === "voucher_unavailable") return t.pricing.voucherErrorInvalid;
    if (code === "voucher_already_redeemed") return t.pricing.voucherAlreadyRedeemed;
    if (code === "voucher_plan_mismatch") return t.pricing.voucherPlanMismatch;
    if (code === "voucher_domain_not_allowed") return domainNotAllowedMessage(voucherDomains);
    if (code === "authentication_required" || code === "invalid_session") return t.pricing.authRequired;
    if (code === "backend_not_configured") return t.pricing.configUnavailable;
    if (code === "subscription_already_exists") return t.pricing.alreadySubscribed;
    if (code === "rate_limit_exceeded") return t.pricing.rateLimited;
    return t.pricing.checkoutFailed;
  }

  // voucher-preview answers 200 {valid:false, reason} for a bad code and an HTTP error (mapped to
  // `reason` by previewVoucher) for rate limits/outages: "invalid code" and "could not check"
  // are different situations and get different messages.
  function messageForPreviewFailure(reason: string | undefined): string {
    if (!reason || reason === "voucher_unavailable") return t.pricing.voucherErrorInvalid;
    if (reason === "voucher_already_redeemed") return t.pricing.voucherAlreadyRedeemed;
    if (reason === "voucher_domain_not_allowed") return t.pricing.voucherDomainNotAllowedGeneric;
    if (reason === "rate_limit_exceeded") return t.pricing.rateLimited;
    if (reason === "backend_not_configured") return t.pricing.configUnavailable;
    return t.pricing.voucherCheckFailed;
  }

  function messageForAuthError(error: unknown): string {
    const code = error instanceof Error ? error.message : "";
    if (code === "invalid_credentials") return t.pricing.invalidCredentials;
    if (code === "signup_failed") return t.pricing.signupFailed;
    if (code === "magic_link_failed") return t.pricing.checkoutFailed;
    if (code === "backend_not_configured") return t.pricing.configUnavailable;
    return t.pricing.checkoutFailed;
  }

  function discardPendingIntent() {
    const owned = memoryIntentRef.current;
    memoryIntentRef.current = null;
    intentOnlyInMemoryRef.current = false;
    awaitingEmailRef.current = false;
    // Only the record this tab saved: a visitor already told to "check your e-mail" in an earlier
    // page load or another tab keeps theirs even if this tab opens and closes the modal (M2).
    if (owned) clearPendingIntentIfOwned(owned.savedAt);
  }

  // Context line of the auth modal while a plan (and maybe a voucher) waits for the account. Kept
  // when switching between the sign-in and sign-up tabs, which is exactly when a new visitor needs
  // to still see which voucher they are about to redeem.
  function queuedPlanMessage(planId: PlanId | null, voucherCode: string | null): string | null {
    if (!planId) return null;
    return voucherCode
      ? t.pricing.authRequiredWithVoucher.replace("{code}", voucherCode).replace("{plan}", planName(planId))
      : t.pricing.authRequired;
  }

  function openAuthModal(planId: PlanId | null = null, voucherCode: string | null = null) {
    authTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQueuedPlanId(planId);
    setAuthMessage(null);
    setAuthError(null);
    setAwaitingPanel(null);
    // Someone arriving with a voucher is a new visitor most of the time: start on "Criar conta".
    if (planId && voucherCode) setAuthMode("signup");
    setAuthModalOpen(true);
  }

  function closeAuthModal() {
    if (authBusy) return;
    const waiting = awaitingEmailRef.current ? memoryIntentRef.current : null;
    if (waiting?.email) {
      // Closing the modal must not make the page forget the visitor still has one step left.
      setResumeNotice({
        tone: "info",
        hideWhenActive: true,
        message: (waiting.voucherCode ? t.pricing.awaitingEmailReminder : t.pricing.awaitingEmailReminderPlan)
          .replace("{email}", waiting.email)
          .replace("{code}", waiting.voucherCode ?? "")
          .replace("{plan}", planName(waiting.planId)),
      });
      scrollToPricing();
    } else if (!awaitingEmailRef.current) {
      discardPendingIntent();
    }
    setAuthModalOpen(false);
    setQueuedPlanId(null);
    setAuthMessage(null);
    setAuthError(null);
    setAwaitingPanel(null);
  }
  closeAuthModalRef.current = closeAuthModal;

  function validateAuthFields(mode: "signin" | "signup") {
    const normalizedEmail = email.trim();
    const nextErrors: { email?: string; password?: string; terms?: string } = {};
    if (!normalizedEmail) nextErrors.email = t.pricing.emailRequired;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) nextErrors.email = t.pricing.emailInvalid;
    if (password.length < 8) nextErrors.password = t.pricing.passwordTooShort;
    if (mode === "signup" && !acceptedTerms) nextErrors.terms = t.pricing.termsRequired;
    setFieldErrors(nextErrors);
    if (nextErrors.email) emailRef.current?.focus();
    else if (nextErrors.password) passwordRef.current?.focus();
    else if (nextErrors.terms) document.getElementById("qts-auth-terms")?.focus();
    return Object.keys(nextErrors).length === 0;
  }
  function clearFieldError(field: "email" | "password" | "terms") {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  // Message shown once the visitor has to finish in their inbox. When a plan (and maybe a voucher)
  // is waiting, it says so explicitly: that is what was missing in the live presentation.
  function awaitingEmailMessage(kind: "confirmation" | "link", typedEmail: string): string {
    const intent = memoryIntentRef.current;
    if (!intent || !queuedPlanId) return kind === "confirmation" ? t.pricing.confirmationSent : t.pricing.emailLinkSent;
    awaitingEmailRef.current = true;
    attachEmailToPendingIntent(typedEmail);
    memoryIntentRef.current = { ...intent, email: typedEmail.toLowerCase() };
    const template = kind === "confirmation"
      ? intent.voucherCode ? t.pricing.confirmationSentWithVoucher : t.pricing.confirmationSentWithPlan
      : intent.voucherCode ? t.pricing.emailLinkSentWithVoucher : t.pricing.emailLinkSentWithPlan;
    return template
      .replace("{email}", typedEmail)
      .replace("{code}", intent.voucherCode ?? "")
      .replace("{plan}", planName(intent.planId));
  }

  // With a plan waiting, the form is replaced by a dedicated "check your e-mail" panel (focus moves
  // to its title); without one, the short message under the form is enough.
  function showAwaitingEmail(message: string) {
    if (awaitingEmailRef.current) setAwaitingPanel(message);
    else setAuthMessage(message);
  }

  async function handleAuth(mode: "signin" | "signup") {
    setAuthError(null);
    setAuthMessage(null);
    if (!validateAuthFields(mode)) return;
    setAuthBusy(true);
    const typedEmail = email.trim();
    // Set before the call: Supabase may emit the new session (onAuthStateChange) before the
    // promise below resolves, and the resume effect must already know it was born here.
    signedInHereRef.current = true;
    try {
      const nextSession = mode === "signin"
        ? await signIn(typedEmail, password)
        : await signUp(typedEmail, password);
      setPassword("");
      if (nextSession) {
        // The queued plan/voucher is resumed by the session effect below (resumePendingIntent),
        // the same path an e-mail confirmation link takes, so both flows behave identically.
        awaitingEmailRef.current = false;
        setSession(nextSession);
        setQueuedPlanId(null);
        setAuthModalOpen(false);
      } else {
        signedInHereRef.current = false;
        showAwaitingEmail(awaitingEmailMessage("confirmation", typedEmail));
      }
    } catch (error) {
      signedInHereRef.current = false;
      setAuthError(messageForAuthError(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSendSignInLink() {
    setAuthError(null);
    setAuthMessage(null);
    const typedEmail = email.trim();
    if (!typedEmail) {
      setFieldErrors({ email: t.pricing.emailRequired });
      emailRef.current?.focus();
      return;
    }
    setAuthBusy(true);
    try {
      await sendSignInLink(typedEmail);
      showAwaitingEmail(awaitingEmailMessage("link", typedEmail));
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
      signedInHereRef.current = false;
      setAccess(null);
      setStatusMessage(null);
      setAuthMessage(null);
      setAuthError(null);
      setPlanFeedback(null);
      setResumeNotice(null);
      setRedeemedVoucher(null);
    } catch (error) {
      setStatusError(true);
      setStatusMessage(messageForError(error));
    } finally {
      setAuthBusy(false);
    }
  }

  function resetVoucher() {
    setAppliedVoucher(null);
    setVoucherPreview(null);
    setVoucherError(null);
  }

  /** Previews `code` and updates the inline voucher feedback. Returns the valid preview or null. */
  async function applyVoucherCode(rawCode: string): Promise<VoucherPreview | null> {
    const code = rawCode.trim().toUpperCase();
    setPlanFeedback(null);
    setRedeemedVoucher(null);
    if (!code) {
      resetVoucher();
      setVoucherError(t.pricing.voucherErrorEmpty);
      return null;
    }
    if (!voucherPattern.test(code)) {
      resetVoucher();
      setVoucherError(t.pricing.voucherErrorInvalid);
      return null;
    }
    resetVoucher();
    setVoucherChecking(true);
    try {
      const preview = await previewVoucher(code);
      if (!preview.valid) {
        setVoucherError(messageForPreviewFailure(preview.reason));
        return null;
      }
      setAppliedVoucher(code);
      setVoucherPreview(preview);
      return preview;
    } catch (error) {
      setVoucherError(messageForPreviewFailure(error instanceof Error ? error.message : undefined));
      return null;
    } finally {
      setVoucherChecking(false);
    }
  }

  async function handleApplyVoucher() {
    await applyVoucherCode(voucherInput);
  }

  // access-status reads the grant checkout-create-session has already committed, so this is not
  // waiting on a race: the extra attempts only absorb a transient network failure right after the
  // redemption, which would otherwise leave the install button hidden until a reload.
  async function loadAccessAfterGrant(): Promise<AccessStatus | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await loadAccessStatus();
      } catch {
        // 1.5s between attempts: long enough for a flaky mobile connection to recover, short
        // enough that the visitor is not left staring at a spinner after a successful redemption.
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
    }
    return null;
  }

  async function completePlanSelection(
    planId: PlanId,
    options: {
      billingCycle?: BillingCycle;
      voucherCode?: string | null;
      voucherDomains?: string[] | null;
      // Resume after the e-mail link: the error goes only to the top notice, not to three places.
      silent?: boolean;
    } = {},
  ): Promise<{ ok: true; keepNotice: boolean } | { ok: false; message: string; code: string }> {
    const cycle = options.billingCycle ?? billingCycle;
    const voucherCode = options.voucherCode !== undefined ? options.voucherCode : appliedVoucher;
    const voucherDomains = options.voucherDomains !== undefined
      ? options.voucherDomains
      : voucherPreview?.allowedEmailDomains ?? null;
    setPendingPlanId(planId);
    setPlanFeedback(null);
    setStatusError(false);
    setStatusMessage(null);
    // Leaving for Stripe: the button keeps saying so until the navigation happens.
    let leavingForCheckout = false;
    try {
      const result = await startCheckout({ planId, billingCycle: cycle, voucherCode });
      if (result.checkoutUrl) {
        leavingForCheckout = true;
        setRedirectingToStripe(true);
        window.location.assign(result.checkoutUrl);
        return { ok: true, keepNotice: true };
      }
      if (result.accessGranted) {
        const nextAccess = await loadAccessAfterGrant();
        accessWriteRef.current += 1;
        notifyAccessChanged();
        setRedeemedVoucher(voucherCode ? { code: voucherCode, label: result.label ?? null } : null);
        setAppliedVoucher(null);
        setVoucherPreview(null);
        setVoucherError(null);
        setVoucherInput("");
        if (nextAccess) {
          setAccess(nextAccess);
          setFocusAccessPanel(true);
          return { ok: true, keepNotice: false };
        }
        // The grant exists but access-status kept failing: never end in silence (founder report,
        // UX review 2026-10-28). Persistent notice with a way out instead of an empty page.
        setResumeNotice({
          tone: "info",
          message: t.pricing.accessLoadFailedAfterGrant,
          action: { label: t.pricing.reloadPage, onClick: () => window.location.reload() },
        });
        scrollToPricing();
        return { ok: true, keepNotice: true };
      }
      return { ok: false, message: t.pricing.checkoutFailed, code: "invalid_checkout_response" };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const message = messageForError(error, voucherDomains);
      if (code === "voucher_already_redeemed") {
        // Already redeemed on this account: the access probably exists, so show it (and the
        // install step) instead of only an error.
        const refreshed = await loadAccessStatus().catch(() => null);
        if (refreshed?.active) {
          accessWriteRef.current += 1;
          setAccess(refreshed);
        }
      }
      if (!options.silent) {
        setPlanFeedback({ planId, message });
        // A voucher problem is also shown next to the voucher field, where the visitor typed it.
        if (voucherErrorCodes.has(code) && code !== "voucher_plan_mismatch") {
          setVoucherError(message);
          setAppliedVoucher(null);
          setVoucherPreview(null);
        }
      }
      return { ok: false, message, code };
    } finally {
      if (!leavingForCheckout) setPendingPlanId(null);
    }
  }

  // Saved BEFORE the auth modal opens: if sign-up needs e-mail confirmation, the visitor finishes
  // in a new page load and this record is the only thing that survives it. The same savedAt goes to
  // memory and storage so this tab can later recognise (and only then remove) its own record.
  function queuePlanForAuth(planId: PlanId, voucherCode: string | null) {
    const savedAt = Date.now();
    const intent = { planId, billingCycle, voucherCode };
    memoryIntentRef.current = { ...intent, email: null, savedAt };
    awaitingEmailRef.current = false;
    intentOnlyInMemoryRef.current = !savePendingIntent(intent, undefined, savedAt);
    openAuthModal(planId, voucherCode);
  }

  async function handleSelectPlan(planId: PlanId) {
    if (!session) {
      queuePlanForAuth(planId, appliedVoucher);
      return;
    }
    await completePlanSelection(planId);
  }

  // Signed in with an e-mail outside the voucher's domain: sign out and reopen the modal with the
  // plan and voucher already queued, so the right account picks it up.
  async function handleSwitchAccount() {
    const planId = voucherPreview?.plan?.key ?? null;
    const code = appliedVoucher;
    await handleSignOut();
    if (planId) queuePlanForAuth(planId, code);
    else openAuthModal(null);
  }

  // Picks up a plan/voucher chosen before signing in, exactly once, whether the session came from
  // the password form in this tab, a confirmation link, or a magic link (new page load).
  async function resumePendingIntent(currentSession: Session) {
    const claimed = await withPendingIntentLock(async () => claimPendingIntent());
    // Another tab holds the lock and is resuming it already.
    if (!claimed) return;
    const memoryIntent = memoryIntentRef.current;
    memoryIntentRef.current = null;
    awaitingEmailRef.current = false;
    // A stored intent is only trusted when this tab created it (in-page sign in) or the visitor got
    // as far as "check your e-mail" (the e-mail is attached then). One without e-mail from an
    // earlier visit means the modal was abandoned, and a later unrelated sign in must not start a
    // checkout from it.
    const storedIntent = claimed.intent && (claimed.intent.email || memoryIntent) ? claimed.intent : null;
    const intent = storedIntent ?? (intentOnlyInMemoryRef.current ? memoryIntent : null);
    intentOnlyInMemoryRef.current = false;
    const sessionEmail = currentSession.user.email?.toLowerCase() ?? null;

    if (!intent) {
      if (claimed.expired?.email) {
        setBillingCycle(claimed.expired.billingCycle);
        if (claimed.expired.voucherCode) {
          setVoucherInput(claimed.expired.voucherCode);
          void applyVoucherCode(claimed.expired.voucherCode);
          setResumeNotice({ tone: "info", message: t.pricing.resumeExpired.replace("{code}", claimed.expired.voucherCode), hideWhenActive: true });
          scrollToPricing();
        }
        return;
      }
      if (isAuthLinkArrival(authRedirectOnLoad)) {
        // Confirmed on a different device/browser (nothing was saved here) or no plan was picked:
        // say how to continue instead of leaving the visitor on a page that looks unchanged. Only a
        // sign-up confirmation may claim "e-mail confirmed"; a magic link gets neutral copy.
        setResumeNotice({
          tone: "info",
          message: authRedirectOnLoad === "signup" ? t.pricing.accountConfirmedNoIntent : t.pricing.accountLinkedNoIntent,
          hideWhenActive: true,
        });
        scrollToPricing();
      }
      return;
    }

    setBillingCycle(intent.billingCycle);
    scrollToPricing();
    if (intent.email && sessionEmail && intent.email !== sessionEmail) {
      // Someone else signed in on this browser: never redeem the saved voucher for them silently.
      if (intent.voucherCode) {
        setVoucherInput(intent.voucherCode);
        void applyVoucherCode(intent.voucherCode);
        setResumeNotice({ tone: "info", message: t.pricing.resumeOtherAccount.replace("{code}", intent.voucherCode), hideWhenActive: true });
      }
      return;
    }

    setResumeNotice({
      tone: "info",
      busy: true,
      message: intent.voucherCode
        ? t.pricing.resumeWorking.replace("{code}", intent.voucherCode).replace("{plan}", planName(intent.planId))
        : t.pricing.resumeWorkingNoVoucher.replace("{plan}", planName(intent.planId)),
    });

    let voucherDomains: string[] | null = null;
    if (intent.voucherCode) {
      setVoucherInput(intent.voucherCode);
      setVoucherChecking(true);
      let preview: VoucherPreview | null = null;
      try {
        preview = await previewVoucher(intent.voucherCode);
      } catch {
        preview = null;
      } finally {
        setVoucherChecking(false);
      }
      if (preview && !preview.valid && preview.reason === "voucher_unavailable") {
        // Expired, sold out or already used since it was applied: redeeming would fail the same way.
        const message = messageForPreviewFailure(preview.reason);
        setResumeNotice({ tone: "error", message: `${t.pricing.resumeFailed} ${message}` });
        return;
      }
      if (preview?.valid) {
        setAppliedVoucher(intent.voucherCode);
        setVoucherPreview(preview);
        voucherDomains = preview.allowedEmailDomains ?? null;
        if (voucherDomains && !emailDomainAllowed(sessionEmail, voucherDomains)) {
          const message = domainNotAllowedMessage(voucherDomains);
          setResumeNotice({ tone: "error", message: `${t.pricing.resumeFailed} ${message}` });
          return;
        }
      }
      // A preview that could not be checked (network, rate limit) does not block: the backend
      // validates the voucher again on redemption and its error is shown below.
    }

    const outcome = await completePlanSelection(intent.planId, {
      billingCycle: intent.billingCycle,
      voucherCode: intent.voucherCode,
      voucherDomains,
      silent: true,
    });
    if (outcome.ok) {
      if (!outcome.keepNotice) setResumeNotice(null);
    } else if (outcome.code === "voucher_already_redeemed") {
      setResumeNotice({ tone: "info", message: t.pricing.voucherAlreadyRedeemed });
    } else {
      setResumeNotice({ tone: "error", message: `${t.pricing.resumeFailed} ${outcome.message}` });
    }
  }

  useEffect(() => {
    if (!session) {
      // Signed out: a later sign in during this same page load may carry a new intent.
      resumeAttemptedRef.current = false;
      return;
    }
    if (resumeAttemptedRef.current) return;
    // M1: a session received only by cross-tab sync does not resume here (see signedInHereRef).
    if (!isAuthLinkArrival(authRedirectOnLoad) && !signedInHereRef.current) return;
    const start = () => {
      if (resumeAttemptedRef.current) return;
      resumeAttemptedRef.current = true;
      void resumePendingIntent(session);
    };
    // Supabase shares a new session with every open tab of the site. Only the tab the visitor is
    // looking at resumes, so a discount voucher never redirects a background tab to Stripe; a
    // hidden tab waits until it is shown (and by then the visible one has usually claimed it).
    if (document.visibilityState === "visible") {
      start();
      return;
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // resumePendingIntent is intentionally read from the render that saw the new session.
  }, [session]);

  // Another tab redeemed a voucher or activated a plan: refresh here too, so this tab also shows
  // the install button instead of a stale "no access" state.
  useEffect(() => {
    if (!session) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACCESS_CHANGED_STORAGE_KEY) return;
      void loadAccessStatus().then((nextAccess) => {
        accessWriteRef.current += 1;
        setAccess(nextAccess);
      }).catch(() => undefined);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [session]);

  useEffect(() => {
    if (!awaitingPanel) return;
    // The form (and the focused submit button) just unmounted: move focus to the panel title so it
    // never falls back to <body>.
    requestAnimationFrame(() => awaitingTitleRef.current?.focus());
  }, [awaitingPanel]);

  useEffect(() => {
    if (!focusAccessPanel || !access?.active) return;
    setFocusAccessPanel(false);
    // Moves the visitor (and screen readers) to the next step right after a redemption.
    accessTitleRef.current?.focus({ preventScroll: true });
    accessTitleRef.current?.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [focusAccessPanel, access?.active]);

  async function retryPricing() {
    setPricingLoading(true);
    setPricingError(null);
    try { setPriceCatalog(await loadPriceCatalog()); }
    catch { setPricingError(t.pricing.pricingUnavailable); }
    finally { setPricingLoading(false); }
  }

  // Points the visitor at the floating install button right after they actually get access (free
  // plan claimed, or a paid checkout completing) instead of before - a pulse triggered on mount
  // for someone who was already a customer days ago would just be visual noise.
  const [justUnlockedAccess, setJustUnlockedAccess] = useState(false);
  const wasAccessActiveRef = useRef(false);
  useEffect(() => {
    const isActiveNow = Boolean(access?.active);
    if (isActiveNow && !wasAccessActiveRef.current) {
      setJustUnlockedAccess(true);
      // 6s: covers the three 1.6s pulses of .qts-install-fab-tour (app.css) plus a short pause,
      // then drops the class so the animation can run again on a later unlock.
      const timer = window.setTimeout(() => setJustUnlockedAccess(false), 6_000);
      wasAccessActiveRef.current = true;
      return () => window.clearTimeout(timer);
    }
    wasAccessActiveRef.current = isActiveNow;
  }, [access?.active]);

  // Reappears every time the install button is clicked (not just once) so it stays a reliable
  // fallback each visit, not something a visitor has to remember they already dismissed once.
  const [showOutdatedToast, setShowOutdatedToast] = useState(false);

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  function formatAccessDate(iso: string): string {
    return new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR");
  }

  async function handleCancelAccess() {
    setCancelBusy(true);
    try {
      const result = await cancelAccess();
      const refreshed = await loadAccessStatus();
      accessWriteRef.current += 1;
      setAccess(refreshed);
      setStatusError(false);
      setStatusMessage(
        result.mode === "at_period_end" && result.accessUntil
          ? t.pricing.cancelScheduled.replace("{date}", formatAccessDate(result.accessUntil))
          : t.pricing.cancelImmediate,
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setStatusError(true);
      setStatusMessage(
        code === "nothing_to_cancel" || code === "stripe_subscription_unavailable"
          ? t.pricing.cancelUnavailable
          : messageForError(error),
      );
    } finally {
      setCancelBusy(false);
      setCancelConfirmOpen(false);
    }
  }

  const voucherDomains = voucherPreview?.valid ? voucherPreview.allowedEmailDomains ?? null : null;
  const sessionEmail = session?.user.email ?? null;
  const voucherDomainMismatch = Boolean(session && voucherDomains && !emailDomainAllowed(sessionEmail, voucherDomains));
  // Shown in the sign-in/sign-up modal while a domain-restricted voucher is queued for a plan.
  const modalVoucherDomains = queuedPlanId && appliedVoucher ? voucherDomains : null;
  const typedEmailLooksComplete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const modalDomainMismatch = Boolean(modalVoucherDomains && typedEmailLooksComplete && !emailDomainAllowed(email.trim(), modalVoucherDomains));
  const voucherPlanId = voucherPreview?.valid ? voucherPreview.plan?.key ?? null : null;
  // Hidden while a selection is in flight (resume included) and when the logged-in e-mail cannot
  // redeem it anyway: a "next step" that cannot work is worse than none.
  const voucherNextStep = voucherPreview?.valid && !voucherDomainMismatch && pendingPlanId === null
    ? !voucherPlanId && voucherPreview.kind === "discount"
      ? t.pricing.voucherNextStepAnyPlan
      : session ? t.pricing.voucherNextStepSignedIn : t.pricing.voucherNextStepGuest
    : null;
  const modalQueuedContext = !session ? queuedPlanMessage(queuedPlanId, appliedVoucher) : null;

  function planCtaState(planId: PlanId) {
    const plan = pricingPlans.find((item) => item.id === planId)!;
    const price = priceCatalog[planId]?.[billingCycle];
    // `billing` is only present for a real Stripe subscription row - that's what blocks
    // buying a *different* plan (contacting support to switch). A founder/trial/voucher
    // grant with no Stripe subscription must never block a purchase, per the product rule
    // that a free/courtesy user can always become a paying customer. Whether a plan is the
    // visitor's *current* one, though, is a broader question than billing alone - any
    // active grant (trial, voucher, founder courtesy, or a real subscription) matching
    // this plan means it shouldn't be offered for purchase again.
    const hasBlockingSubscription = access?.billing != null;
    const isCurrentPlan = Boolean(access?.active) && access?.plan?.key === planId;
    const isBlockedByOtherPlan = hasBlockingSubscription && access?.plan?.key !== planId;
    const voucherTargetsPlan = Boolean(voucherPreview?.valid)
      && (voucherPreview?.plan == null || voucherPreview.plan.key === planId);
    // A days/lifetime voucher grants access without Stripe, so a price that failed to load must
    // not disable its button.
    const grantsWithoutPrice = voucherTargetsPlan && voucherPreview?.kind !== "discount";
    const disabled = pendingPlanId !== null
      || (!plan.isFree && !price && !grantsWithoutPrice)
      || isCurrentPlan
      || isBlockedByOtherPlan
      || (voucherTargetsPlan && voucherDomainMismatch);
    const label = pendingPlanId === planId
      ? redirectingToStripe ? t.pricing.redirectingToCheckout : t.pricing.working
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
                : !session
                  ? t.nav.installGuest
                  : plan.isFree ? t.pricing.ctaFree : t.pricing.ctaPaid;
    return { plan, price, isCurrentPlan, isBlockedByOtherPlan, voucherTargetsPlan, disabled, label };
  }
  const voucherCta = voucherPlanId ? planCtaState(voucherPlanId) : null;
  const showZipFallback = storeIsBehind || !access?.installUrl;

  return (
    <section className="qts-section" id="planos">
      <div className="qts-container">
        <Reveal className="qts-section-head">
          <div className="qts-section-head-main">
            <span className="qts-eyebrow">{t.pricing.eyebrow}</span>
            <h2>{t.pricing.title}</h2>
          </div>
          <p className="qts-section-head-lead">{t.pricing.lead}</p>
        </Reveal>

        {createPortal(
          // Portaled straight to <body>: .qts-page-content (an ancestor here) sets its own
          // position+z-index to sit above the particle canvas, which makes it a stacking
          // context - so the modal's z-index:100 was only ever winning against siblings
          // *inside* that context, never against the sticky nav bar (z-index:50) outside it.
          // Tall modal content pushed the close button up into the nav's band and the nav won
          // the hit-test despite the "higher" z-index. Escaping to body sidesteps that entirely.
          //
          // AnimatePresence has to live INSIDE the portaled subtree, not wrapped around the
          // `createPortal(...)` call - wrapping it outside (gating the whole portal call on
          // authModalOpen) silently produced zero DOM nodes on open, no error, nothing: verified
          // by bisecting against a build with AnimatePresence removed, which rendered correctly.
          // Portaling unconditionally (this component always exists, just empty when closed) and
          // keeping only the *motion.div* conditional is the combination that actually works.
          <AnimatePresence>
            {authModalOpen ? (
            <motion.div
              className="qts-auth-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeAuthModal();
              }}
            >
              <motion.div
                className="qts-auth-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="qts-auth-title"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <header className="qts-auth-modal-header">
                  <div className="qts-auth-modal-brand">
                    <img className="qts-auth-modal-logo qts-logo-light" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo.svg`} alt="" aria-hidden="true" width={22} height={22} />
                    <img className="qts-auth-modal-logo qts-logo-dark" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo-dark.svg`} alt="" aria-hidden="true" width={22} height={22} />
                    <span>QA Toolbar Sandbox</span>
                  </div>
                  <button type="button" className="qts-auth-close" aria-label={t.pricing.closeModal} onClick={closeAuthModal}><Icon name="xLg" /></button>
                </header>
                <div className="qts-auth-modal-body">
                  <h3 id="qts-auth-title">{t.pricing.accountTitle}</h3>
                  {modalQueuedContext && !awaitingPanel
                    ? <p className="qts-auth-context"><Icon name="ticketPerforated" /><span>{modalQueuedContext}</span></p>
                    : <p>{t.pricing.accountLead}</p>}
                  {session ? (
                    <div className="qts-auth-session">
                      <span>{t.pricing.signedInAs} <strong>{session.user.email}</strong></span>
                      <button type="button" className="qts-btn qts-btn-ghost" disabled={authBusy} onClick={() => void handleSignOut()}>
                        {t.pricing.signOut}
                      </button>
                    </div>
                  ) : awaitingPanel ? (
                    <div className="qts-auth-awaiting">
                      <span className="qts-auth-awaiting-icon" aria-hidden="true"><Icon name="envelope" /></span>
                      <h4 ref={awaitingTitleRef} tabIndex={-1}>{t.pricing.checkEmailTitle}</h4>
                      <p role="status">{awaitingPanel}</p>
                      <button type="button" className="qts-btn qts-btn-primary qts-auth-submit" onClick={closeAuthModal}>
                        {t.pricing.closeModal}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="qts-auth-tabs" role="tablist" aria-label={t.pricing.accountTitle} onKeyDown={(event) => {
                        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                        event.preventDefault();
                        const next = authMode === "signin" ? "signup" : "signin";
                        setAuthMode(next);
                        document.getElementById(`qts-auth-tab-${next}`)?.focus();
                      }}>
                        <button id="qts-auth-tab-signin" type="button" role="tab" aria-selected={authMode === "signin"} aria-controls="qts-auth-panel" tabIndex={authMode === "signin" ? 0 : -1} className={authMode === "signin" ? "is-active" : ""} onClick={() => {
                          setAuthMode("signin"); setAuthError(null); setAuthMessage(null);
                        }}>
                          {authMode === "signin" ? <motion.span layoutId="qts-auth-tab-pill" className="qts-auth-tab-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
                          <span className="qts-auth-tab-label">{t.pricing.signIn}</span>
                        </button>
                        <button id="qts-auth-tab-signup" type="button" role="tab" aria-selected={authMode === "signup"} aria-controls="qts-auth-panel" tabIndex={authMode === "signup" ? 0 : -1} className={authMode === "signup" ? "is-active" : ""} onClick={() => {
                          setAuthMode("signup"); setAuthError(null); setAuthMessage(null);
                        }}>
                          {authMode === "signup" ? <motion.span layoutId="qts-auth-tab-pill" className="qts-auth-tab-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
                          <span className="qts-auth-tab-label">{t.pricing.signUp}</span>
                        </button>
                      </div>
                      <form id="qts-auth-panel" role="tabpanel" aria-labelledby={`qts-auth-tab-${authMode}`} className="qts-auth-form" noValidate onSubmit={(event) => {
                        event.preventDefault(); void handleAuth(authMode);
                      }}>
                        <label>
                          <span>{t.pricing.emailLabel}</span>
                          <div className="qts-auth-input-wrap">
                            <Icon name="envelope" className="qts-auth-input-icon" />
                            <input ref={emailRef} type="email" autoComplete="email" required autoFocus value={email} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={[fieldErrors.email ? "qts-email-error" : "", modalVoucherDomains ? "qts-auth-domain-hint" : ""].filter(Boolean).join(" ") || undefined} onChange={(event) => { setEmail(event.target.value); clearFieldError("email"); }} />
                          </div>
                          {fieldErrors.email ? <small id="qts-email-error" className="qts-field-error">{fieldErrors.email}</small> : null}
                          {modalVoucherDomains && appliedVoucher ? (
                            <small id="qts-auth-domain-hint" className={`qts-auth-domain-hint${modalDomainMismatch ? " is-warning" : ""}`}>
                              {modalDomainMismatch ? <Icon name="exclamationTriangle" /> : <Icon name="shieldCheck" />}
                              <span>
                                {(modalDomainMismatch ? t.pricing.voucherDomainSignupMismatch : t.pricing.voucherDomainSignupHint)
                                  .replace("{code}", appliedVoucher)
                                  .replace("{domains}", formatAllowedDomains(modalVoucherDomains))}
                              </span>
                            </small>
                          ) : null}
                        </label>
                        <label>
                          <span>{t.pricing.passwordLabel}</span>
                          <div className="qts-auth-input-wrap">
                            <Icon name="lockFill" className="qts-auth-input-icon" />
                            <input ref={passwordRef} type="password" minLength={8} autoComplete={authMode === "signup" ? "new-password" : "current-password"} required value={password} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? "qts-password-error" : undefined} onChange={(event) => { setPassword(event.target.value); clearFieldError("password"); }} />
                          </div>
                          {fieldErrors.password ? <small id="qts-password-error" className="qts-field-error">{fieldErrors.password}</small> : null}
                        </label>
                        {authMode === "signup" ? (
                          <label className="qts-terms-check">
                            <input id="qts-auth-terms" type="checkbox" checked={acceptedTerms} aria-invalid={Boolean(fieldErrors.terms)} aria-describedby={fieldErrors.terms ? "qts-terms-error" : undefined} onChange={(event) => { setAcceptedTerms(event.target.checked); clearFieldError("terms"); }} />
                            <span>{t.pricing.acceptTerms} <a href={`${import.meta.env.BASE_URL}privacidade`}>{t.pricing.privacyLink}</a>.</span>
                          </label>
                        ) : null}
                        {fieldErrors.terms ? <small id="qts-terms-error" className="qts-field-error">{fieldErrors.terms}</small> : null}
                        {authMessage ? <div className="qts-auth-feedback" role="status">{authMessage}</div> : null}
                        {authError ? <div className="qts-auth-feedback is-error" role="alert">{authError}</div> : null}
                        <button type="submit" className="qts-btn qts-btn-primary qts-auth-submit" disabled={authBusy}>
                          {authBusy ? t.pricing.working : authMode === "signin" ? t.pricing.signIn : t.pricing.signUp}
                        </button>
                        {authMode === "signin" ? (
                          <div className="qts-auth-links">
                            <button type="button" className="qts-auth-link" disabled={authBusy} onClick={() => void handleSendSignInLink()}>
                              {t.pricing.emailLink}
                            </button>
                            <button type="button" className="qts-auth-link" disabled={authBusy} onClick={() => void handleForgotPassword()}>
                              {t.pricing.forgotPassword}
                            </button>
                          </div>
                        ) : null}
                      </form>
                    </>
                  )}
                </div>
              </motion.div>
            </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body,
        )}

        {access?.active && access.installUrl ? (
          createPortal(
            <div className="qts-install-fab-stack">
              {showOutdatedToast ? (
                <div className="qts-outdated-toast" role="status">
                  <button type="button" className="qts-outdated-toast-close" aria-label={t.pricing.closeModal} onClick={() => setShowOutdatedToast(false)}>
                    <Icon name="xLg" />
                  </button>
                  <strong>{t.pricing.storeOutdatedToastTitle}</strong>
                  <p>{t.pricing.downloadExtensionHint}</p>
                  <a
                    className="qts-btn qts-btn-primary"
                    href={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-extension.zip`}
                    download
                  >
                    <Icon name="download" /> {t.pricing.downloadExtensionZip}
                  </a>
                </div>
              ) : null}
              <a
                className={`qts-install-fab${justUnlockedAccess ? " qts-install-fab-tour" : ""}`}
                href={access.installUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  setJustUnlockedAccess(false);
                  if (storeIsBehind) setShowOutdatedToast(true);
                }}
              >
                <Icon name="browserChrome" />
                <span className="qts-install-fab-text">
                  <strong>{t.pricing.installFabLabel}</strong>
                  <small>v{__EXTENSION_PACKAGE_VERSION__}</small>
                </span>
              </a>
            </div>,
            document.body,
          )
        ) : null}
        {statusMessage ? (
          <Toast
            message={statusMessage}
            tone={statusError ? "error" : "success"}
            closeLabel={t.pricing.closeModal}
            onClose={() => setStatusMessage(null)}
          />
        ) : null}
        {pricingLoading ? <div className="qts-pricing-loading" role="status" aria-live="polite"><span className="qts-loading-dot" />{t.pricing.loadingPrices}</div> : null}
        {pricingError ? (
          <Toast
            message={pricingError}
            tone="error"
            closeLabel={t.pricing.closeModal}
            onClose={() => setPricingError(null)}
            action={{ label: t.pricing.retryPricing, onClick: () => void retryPricing() }}
          />
        ) : null}

        <div className="qts-resume-notice-slot" aria-live="polite">
          {resumeNotice && !(resumeNotice.hideWhenActive && access?.active) ? (
            <div className={`qts-resume-notice is-${resumeNotice.tone}`} role={resumeNotice.tone === "error" ? "alert" : undefined} aria-busy={resumeNotice.busy || undefined}>
              {resumeNotice.busy
                ? <span className="qts-loading-dot qts-resume-notice-spinner" aria-hidden="true" />
                : <Icon name={resumeNotice.tone === "error" ? "exclamationTriangle" : "envelope"} className="qts-resume-notice-icon" />}
              <div className="qts-resume-notice-body">
                <p>{resumeNotice.message}</p>
                {resumeNotice.action ? (
                  <button type="button" className="qts-btn qts-btn-primary qts-resume-notice-action" onClick={resumeNotice.action.onClick}>
                    {resumeNotice.action.label}
                  </button>
                ) : null}
              </div>
              {resumeNotice.busy ? null : (
                <button type="button" className="qts-resume-notice-close" aria-label={t.pricing.closeModal} onClick={() => setResumeNotice(null)}>
                  <Icon name="xLg" />
                </button>
              )}
            </div>
          ) : null}
        </div>

        {access?.active ? (
          <section className="qts-access-ready" aria-labelledby="qts-access-ready-title">
            <span className="qts-access-ready-icon" aria-hidden="true"><Icon name="checkLg" /></span>
            <div className="qts-access-ready-body">
              <h3 id="qts-access-ready-title" ref={accessTitleRef} tabIndex={-1}>
                {redeemedVoucher ? t.pricing.voucherRedeemedTitle : t.pricing.accessReadyTitle}
              </h3>
              <p className="qts-access-ready-meta">
                {[
                  access.plan ? t.pricing.accessReadyPlan.replace("{plan}", t.pricing.plans[access.plan.key]?.name ?? access.plan.name) : null,
                  access.expiresAt ? `${t.pricing.accessExpires} ${formatAccessDate(access.expiresAt)}` : t.pricing.accessPermanent,
                  redeemedVoucher ? `voucher ${redeemedVoucher.code}` : null,
                ].filter(Boolean).join(" · ")}
              </p>
              <p>{t.pricing.accessReadyNextStep}</p>
              <div className="qts-access-ready-actions">
                {access.installUrl ? (
                  <a className="qts-btn qts-btn-install" href={access.installUrl} target="_blank" rel="noreferrer">
                    <Icon name="browserChrome" /> {t.pricing.installFromStore}
                  </a>
                ) : null}
                {showZipFallback ? (
                  <a className="qts-btn qts-btn-ghost" href={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-extension.zip`} download>
                    <Icon name="download" /> {t.pricing.downloadExtensionZip}
                  </a>
                ) : null}
              </div>
              {showZipFallback ? <p className="qts-access-ready-hint">{t.pricing.downloadExtensionHint}</p> : null}
            </div>
          </section>
        ) : null}

        <div className="qts-billing-toggle-row">
          <SegmentedControl
            label=""
            value={billingCycle}
            onChange={(value) => setBillingCycle(value as BillingCycle)}
            options={[
              { id: "monthly", label: t.pricing.billingMonthly },
              {
                id: "yearly",
                label: yearlySavingsPercent > 0
                  ? `${t.pricing.billingYearly} · ${t.pricing.billingYearlySavings.replace("{percent}", String(yearlySavingsPercent))}`
                  : t.pricing.billingYearly,
              },
            ]}
          />
        </div>

        <div className="qts-voucher-panel">
          <label className="qts-voucher-label" htmlFor="qts-voucher-code">{t.pricing.voucherPlaceholder}</label>
          <form
            className="qts-voucher-row"
            noValidate
            onSubmit={(event) => { event.preventDefault(); void handleApplyVoucher(); }}
          >
            <div className="qts-voucher-input-wrap">
              <Icon name="ticketPerforated" className="qts-voucher-input-icon" />
              <input
                id="qts-voucher-code"
                type="text"
                className="qts-voucher-input"
                placeholder={t.pricing.voucherPlaceholder}
                value={voucherInput}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(voucherError)}
                aria-describedby={voucherError ? "qts-voucher-error" : voucherPreview?.valid ? "qts-voucher-preview" : undefined}
                onChange={(event) => {
                  setVoucherInput(event.target.value);
                  if (appliedVoucher || voucherError) resetVoucher();
                  setPlanFeedback(null);
                }}
              />
            </div>
            <button type="submit" className="qts-btn qts-btn-primary" disabled={voucherChecking} aria-busy={voucherChecking || undefined}>
              {t.pricing.voucherApply}
            </button>
          </form>
          <div className="qts-voucher-live" role="status">
            {voucherChecking ? (
              <p className="qts-voucher-feedback is-checking"><span className="qts-loading-dot" aria-hidden="true" />{t.pricing.voucherChecking}</p>
            ) : redeemedVoucher && access?.active ? (
              // Announced to screen readers only: the access panel above already shows it visually.
              <p className="qts-sr-only">{t.pricing.voucherRedeemedTitle} ({redeemedVoucher.code})</p>
            ) : null}
          </div>
          {voucherError ? (
            <p id="qts-voucher-error" className="qts-voucher-feedback is-error" role="alert">
              <Icon name="exclamationTriangle" />
              <span>{voucherError}</span>
            </p>
          ) : null}
        </div>

        <div className="qts-voucher-preview-slot" aria-live="polite">
          {voucherPreview?.valid && appliedVoucher ? (
            <div id="qts-voucher-preview" className="qts-voucher-preview">
              <div className="qts-voucher-preview-head">
                <span className="qts-voucher-preview-badge"><Icon name="checkLg" /> {t.pricing.voucherPreviewBadge}</span>
                <span className="qts-voucher-preview-code">{appliedVoucher}</span>
              </div>
              <strong>{voucherPreview.label}</strong>
              <p>
                {voucherPreview.kind === "lifetime"
                  ? t.pricing.voucherPreviewLifetime.replace("{plan}", voucherPreview.plan?.name ?? "")
                  : voucherPreview.kind === "days"
                    ? t.pricing.voucherPreviewDays
                        .replace("{days}", String(voucherPreview.grantDays ?? ""))
                        .replace("{plan}", voucherPreview.plan?.name ?? "")
                    : (voucherPreview.plan ? t.pricing.voucherPreviewDiscount : t.pricing.voucherPreviewDiscountAnyPlan)
                        .replace("{value}", voucherPreview.discountPercentOff
                          ? `${voucherPreview.discountPercentOff}%`
                          : formatPrice({ amountMinor: voucherPreview.discountAmountOffMinor ?? 0, currency: "brl" }, locale, ""))
                        .replace("{plan}", voucherPreview.plan?.name ?? "")}
              </p>
              {voucherDomains ? (
                <p className="qts-voucher-preview-domain">
                  <Icon name="shieldCheck" />
                  <span>{t.pricing.voucherDomainOnly.replace("{domains}", formatAllowedDomains(voucherDomains))}</span>
                </p>
              ) : null}
              {voucherDomainMismatch && voucherDomains ? (
                <div className="qts-voucher-feedback is-error qts-voucher-mismatch" role="alert">
                  <Icon name="exclamationTriangle" />
                  <div>
                    <span>{t.pricing.voucherDomainMismatch.replace("{email}", sessionEmail ?? "").replace("{domains}", formatAllowedDomains(voucherDomains))}</span>
                    <button type="button" className="qts-btn qts-btn-ghost qts-voucher-switch" disabled={authBusy} onClick={() => void handleSwitchAccount()}>
                      {t.pricing.switchAccount}
                    </button>
                  </div>
                </div>
              ) : null}
              {voucherNextStep ? <p className="qts-voucher-next-step"><Icon name="bullseye" /><span>{voucherNextStep}</span></p> : null}
              {voucherCta && voucherPlanId && !voucherDomainMismatch ? (
                // The action sits right under the explanation: on mobile the plan card is far below.
                <button
                  type="button"
                  className="qts-btn qts-btn-primary qts-voucher-cta"
                  disabled={voucherCta.disabled}
                  onClick={() => void handleSelectPlan(voucherPlanId)}
                >
                  {voucherCta.label}
                </button>
              ) : null}
              <button
                type="button"
                className="qts-voucher-clear"
                onClick={() => {
                  resetVoucher();
                  setVoucherInput("");
                  setPlanFeedback(null);
                  document.getElementById("qts-voucher-code")?.focus();
                }}
              >
                {t.pricing.voucherClear}
              </button>
            </div>
          ) : null}
        </div>

        <div className={`qts-pricing-grid${pricingLoading ? " is-loading" : ""}`} aria-busy={pricingLoading}>
          {pricingPlans.map((plan) => {
            const planText = t.pricing.plans[plan.id];
            const unavailable = pricingError ? "-" : t.pricing.working;
            const { price, isCurrentPlan, isBlockedByOtherPlan, voucherTargetsPlan, disabled: ctaDisabled, label: ctaLabel } = planCtaState(plan.id);
            const showCancelPanel = isCurrentPlan && !plan.isFree;
            const isSubscriptionRenewal = access?.source === "subscription";
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
                  {planText.features.map((feature) => <li key={feature}><Icon name="checkLg" />{feature}</li>)}
                </ul>
                <button
                  type="button"
                  className={`qts-btn ${plan.recommended ? "qts-btn-primary" : "qts-btn-ghost"} qts-plan-cta`}
                  onClick={() => void handleSelectPlan(plan.id)}
                  disabled={ctaDisabled}
                  title={isBlockedByOtherPlan ? t.pricing.alreadySubscribed : undefined}
                >
                  {ctaLabel}
                </button>
                {planFeedback?.planId === plan.id ? (
                  <p className="qts-plan-feedback is-error" role="alert">
                    <Icon name="exclamationTriangle" />
                    <span>{planFeedback.message}</span>
                  </p>
                ) : null}
                {showCancelPanel ? (
                  <div className="qts-plan-cancel-panel">
                    <p className="qts-plan-renewal">
                      {isSubscriptionRenewal && access?.expiresAt
                        ? t.pricing.nextRenewalOn.replace("{date}", formatAccessDate(access.expiresAt))
                        : access?.expiresAt
                          ? `${t.pricing.accessExpires} ${formatAccessDate(access.expiresAt)}`
                          : t.pricing.accessPermanent}
                    </p>
                    {!cancelConfirmOpen ? (
                      <button type="button" className="qts-plan-cancel-link" onClick={() => setCancelConfirmOpen(true)}>
                        {t.pricing.cancelAccessCta}
                      </button>
                    ) : (
                      <div className="qts-plan-cancel-confirm">
                        <strong>{t.pricing.cancelConfirmTitle}</strong>
                        <p>
                          {isSubscriptionRenewal && access?.expiresAt
                            ? t.pricing.cancelConfirmBodySubscription.replace("{date}", formatAccessDate(access.expiresAt))
                            : t.pricing.cancelConfirmBodyImmediate}
                        </p>
                        <div className="qts-plan-cancel-confirm-actions">
                          <button type="button" className="qts-btn qts-btn-ghost" disabled={cancelBusy} onClick={() => setCancelConfirmOpen(false)}>
                            {t.pricing.cancelConfirmBack}
                          </button>
                          <button type="button" className="qts-btn qts-btn-primary" disabled={cancelBusy} onClick={() => void handleCancelAccess()}>
                            {cancelBusy ? t.pricing.working : t.pricing.cancelConfirmYes}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {access?.billing != null ? <p className="qts-plan-change-hint">{t.pricing.alreadySubscribed}</p> : null}
      </div>
    </section>
  );
}
