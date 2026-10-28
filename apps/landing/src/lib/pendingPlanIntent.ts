import type { PlanId } from "../data/pricingData";
import { pricingPlans } from "../data/pricingData";

// Why this exists: a brand-new visitor applies a voucher, clicks a plan and signs up. Supabase
// requires e-mail confirmation, so signUp returns no session and the visitor finishes the flow
// from the link in the e-mail, which is a NEW page load. Everything kept only in React state
// (the previewed voucher, the plan they clicked) is gone by then, so the voucher was never
// redeemed and the install button never appeared (founder report, live presentation 2026-10-28;
// production showed 0 redemptions for a campaign people had "applied").
//
// The intent is kept in localStorage (not sessionStorage) because the confirmation link opens in
// a new tab, which never shares sessionStorage with the tab that saved it. It only lives in this
// browser: confirming on another device finds nothing, and the UI tells the visitor to re-enter
// the voucher there.

export type PendingBillingCycle = "monthly" | "yearly";

export interface PendingPlanIntent {
  planId: PlanId;
  billingCycle: PendingBillingCycle;
  voucherCode: string | null;
  // E-mail typed in the sign-up / magic-link form, so a different account signing in later on the
  // same browser does not silently redeem someone else's pending voucher.
  email: string | null;
  savedAt: number;
}

export interface ClaimResult {
  intent: PendingPlanIntent | null;
  // The stored intent existed but was older than the TTL. Returned (instead of silently dropped)
  // so the UI can prefill the code and ask the visitor to confirm the plan again.
  expired: PendingPlanIntent | null;
}

export const PENDING_INTENT_STORAGE_KEY = "qts:pending-plan-intent:v1";
// 24h: long enough for someone who confirms the e-mail the next morning, short enough that a
// voucher typed on a shared computer does not get redeemed by whoever signs in days later.
export const PENDING_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
export const ACCESS_CHANGED_STORAGE_KEY = "qts:access-changed";
const PENDING_INTENT_LOCK = "qts-pending-plan-intent";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const knownPlanIds = new Set<string>(pricingPlans.map((plan) => plan.id));

function defaultStorage(): StorageLike | null {
  // Reading window.localStorage itself can throw (Safari private mode, storage disabled by policy,
  // sandboxed iframe), not only the calls on it.
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function parseIntent(raw: string | null): PendingPlanIntent | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.planId !== "string" || !knownPlanIds.has(candidate.planId)) return null;
  if (candidate.billingCycle !== "monthly" && candidate.billingCycle !== "yearly") return null;
  if (typeof candidate.savedAt !== "number" || !Number.isFinite(candidate.savedAt)) return null;
  const voucherCode = typeof candidate.voucherCode === "string" && /^[A-Z0-9-]{6,64}$/.test(candidate.voucherCode)
    ? candidate.voucherCode
    : null;
  const email = typeof candidate.email === "string" && candidate.email.includes("@")
    ? candidate.email.trim().toLowerCase()
    : null;
  return {
    planId: candidate.planId as PlanId,
    billingCycle: candidate.billingCycle,
    voucherCode,
    email,
    savedAt: candidate.savedAt,
  };
}

export function savePendingIntent(
  intent: Omit<PendingPlanIntent, "savedAt" | "email"> & { email?: string | null },
  storage: StorageLike | null = defaultStorage(),
  now: number = Date.now(),
): boolean {
  if (!storage) return false;
  const record: PendingPlanIntent = {
    planId: intent.planId,
    billingCycle: intent.billingCycle,
    voucherCode: intent.voucherCode,
    email: intent.email ? intent.email.trim().toLowerCase() : null,
    savedAt: now,
  };
  try {
    storage.setItem(PENDING_INTENT_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Records which e-mail the visitor used to sign up / ask for a link, keeping the original timestamp. */
export function attachEmailToPendingIntent(email: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const current = parseIntent(storage.getItem(PENDING_INTENT_STORAGE_KEY));
    if (!current) return;
    storage.setItem(PENDING_INTENT_STORAGE_KEY, JSON.stringify({ ...current, email: email.trim().toLowerCase() }));
  } catch {
    // Storage unavailable: the intent simply will not carry an e-mail check.
  }
}

/** Reads without consuming. Expired or corrupt records are reported as null. */
export function loadPendingIntent(
  storage: StorageLike | null = defaultStorage(),
  now: number = Date.now(),
): PendingPlanIntent | null {
  if (!storage) return null;
  try {
    const intent = parseIntent(storage.getItem(PENDING_INTENT_STORAGE_KEY));
    if (!intent) return null;
    if (now - intent.savedAt > PENDING_INTENT_TTL_MS || intent.savedAt > now + 60_000) return null;
    return intent;
  } catch {
    return null;
  }
}

export function clearPendingIntent(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(PENDING_INTENT_STORAGE_KEY);
  } catch {
    // Nothing else to do: an unreadable storage also cannot resume anything later.
  }
}

/**
 * Removes the stored intent only if it is the exact record this tab saved (same savedAt). Another
 * tab or an earlier page load may own the stored one, typically a visitor already told to "check
 * your e-mail": opening and closing an unrelated modal here must never delete it (code review
 * 2026-10-28, it reproduced the founder's lost-voucher bug).
 */
export function clearPendingIntentIfOwned(savedAt: number, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const current = parseIntent(storage.getItem(PENDING_INTENT_STORAGE_KEY));
    if (current && current.savedAt === savedAt) storage.removeItem(PENDING_INTENT_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was persisted by this tab either.
  }
}

/**
 * Reads AND removes the intent, so it is resumed at most once. Corrupt records are dropped
 * silently; expired ones are dropped but returned in `expired` for the UI.
 */
export function claimPendingIntent(
  storage: StorageLike | null = defaultStorage(),
  now: number = Date.now(),
): ClaimResult {
  if (!storage) return { intent: null, expired: null };
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_INTENT_STORAGE_KEY);
  } catch {
    return { intent: null, expired: null };
  }
  if (raw === null) return { intent: null, expired: null };
  clearPendingIntent(storage);
  const intent = parseIntent(raw);
  if (!intent) return { intent: null, expired: null };
  // A savedAt far in the future means a skewed or tampered clock: treat it as expired instead of
  // trusting it forever. 60s tolerates ordinary clock adjustments between tabs.
  if (now - intent.savedAt > PENDING_INTENT_TTL_MS || intent.savedAt > now + 60_000) {
    return { intent: null, expired: intent };
  }
  return { intent, expired: null };
}

/**
 * Runs `task` holding a cross-tab lock when the browser supports the Web Locks API. The e-mail
 * link opens a second tab while the original one is still open, and Supabase propagates the new
 * session to both, so both may try to resume. claimPendingIntent already removes the record, but
 * read-then-remove on localStorage is not atomic across tabs; the lock closes that gap. Without
 * Web Locks support the claim is still best effort, and the backend rejects a second redemption
 * of the same voucher (voucher_already_redeemed).
 */
export async function withPendingIntentLock<T>(task: () => Promise<T>): Promise<T | null> {
  const locks = typeof navigator !== "undefined"
    ? (navigator as Navigator & { locks?: LockManager }).locks
    : undefined;
  if (!locks?.request) return task();
  return locks.request(PENDING_INTENT_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return null;
    return task();
  });
}

/** Tells other open tabs of the site that access changed, so they refresh their install button. */
export function notifyAccessChanged(storage: StorageLike | null = defaultStorage(), now: number = Date.now()): void {
  if (!storage) return;
  try {
    storage.setItem(ACCESS_CHANGED_STORAGE_KEY, String(now));
  } catch {
    // Other tabs will pick the new access up on their next load.
  }
}

// "signup": the sign-up confirmation link (the only case where "e-mail confirmed" is true).
// "signed-in": any other e-mail link that signs in (magic link, PKCE code without a type).
export type AuthRedirectKind = "none" | "signup" | "signed-in" | "error";

export function isAuthLinkArrival(kind: AuthRedirectKind): boolean {
  return kind === "signup" || kind === "signed-in";
}

/**
 * Detects whether this page load came from a Supabase e-mail link (sign-up confirmation or magic
 * link). Must run before the Supabase client consumes and strips the URL tokens, which is why
 * supabaseClient.ts calls it before createClient. Password recovery links are excluded: they land
 * on /redefinir-senha and have their own page.
 */
export function detectAuthRedirect(hash: string, search: string): AuthRedirectKind {
  const params = new URLSearchParams(`${search.replace(/^\?/, "")}&${hash.replace(/^#/, "")}`);
  if (params.get("type") === "recovery") return "none";
  if (params.has("error_code") || params.has("error_description")) return "error";
  if (params.has("access_token") || params.has("code") || params.has("token_hash")) {
    return params.get("type") === "signup" ? "signup" : "signed-in";
  }
  return "none";
}
