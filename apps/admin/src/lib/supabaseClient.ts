import { createClient } from "@supabase/supabase-js";

const ADMIN_AUTH_STORAGE_KEY = "qts.admin.auth.v1";

export interface StoredAdminMfaSession {
  token: string;
  expiresAt: string;
}

// MFA proof lives in sessionStorage (tab-scoped, gone once the tab/browser closes) rather than
// memory-only or localStorage — a deliberate middle ground picked by the founder: a page reload
// no longer forces a fresh password+OTP round trip, but the token still never outlives the
// browser tab and still expires with the normal 60-minute window either way. This is strictly
// weaker against an injected/XSS script than memory-only (any script running in the tab can read
// it), though the primary Supabase session token was already persisted in localStorage regardless
// — sessionStorage is at least scoped to "this tab, this browser session," which localStorage is not.
const ADMIN_MFA_STORAGE_KEY = "qts.admin.mfa.v1";

function readRawAdminMfaSession(): StoredAdminMfaSession | null {
  try {
    const raw = window.sessionStorage.getItem(ADMIN_MFA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAdminMfaSession>;
    if (typeof parsed?.token !== "string" || typeof parsed?.expiresAt !== "string") return null;
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

// Public/anon key only — this app never sees a service-role key. Founder-only access is
// enforced server-side (RLS + the roles/user_roles tables), never trusted from the client;
// this client can only do what RLS explicitly allows a "founder" role to do.
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export function readAdminMfaSession(): StoredAdminMfaSession | null {
  const session = readRawAdminMfaSession();
  if (!session || !/^[A-Za-z0-9_-]{43}$/.test(session.token)
    || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
    clearAdminMfaSession();
    return null;
  }
  return session;
}

export function storeAdminMfaSession(session: StoredAdminMfaSession): void {
  window.sessionStorage.setItem(ADMIN_MFA_STORAGE_KEY, JSON.stringify(session));
}

export function clearAdminMfaSession(): void {
  window.sessionStorage.removeItem(ADMIN_MFA_STORAGE_KEY);
}

async function fetchWithAdminMfa(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  if (!supabaseUrl || !url.startsWith(`${supabaseUrl}/rest/v1/`)) return fetch(input, init);
  const mfa = readAdminMfaSession();
  if (!mfa || Date.parse(mfa.expiresAt) <= Date.now()) {
    clearAdminMfaSession();
    return fetch(input, init);
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("x-admin-mfa-token", mfa.token);
  return fetch(input, { ...init, headers });
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        storageKey: ADMIN_AUTH_STORAGE_KEY,
        detectSessionInUrl: false,
      },
      global: { fetch: fetchWithAdminMfa },
    })
  : null;
