import { createClient } from "@supabase/supabase-js";

const ADMIN_MFA_STORAGE_KEY = "qts.admin.mfa.v1";
const ADMIN_AUTH_STORAGE_KEY = "qts.admin.auth.v1";

export interface StoredAdminMfaSession {
  token: string;
  expiresAt: string;
}

// Public/anon key only — this app never sees a service-role key. Founder-only access is
// enforced server-side (RLS + the roles/user_roles tables), never trusted from the client;
// this client can only do what RLS explicitly allows a "founder" role to do.
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export function readAdminMfaSession(): StoredAdminMfaSession | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ADMIN_MFA_STORAGE_KEY) ?? "null") as Partial<StoredAdminMfaSession> | null;
    if (!parsed || typeof parsed.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(parsed.token)
      || typeof parsed.expiresAt !== "string" || !Number.isFinite(Date.parse(parsed.expiresAt))) {
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function storeAdminMfaSession(session: StoredAdminMfaSession): void {
  sessionStorage.setItem(ADMIN_MFA_STORAGE_KEY, JSON.stringify(session));
}

export function clearAdminMfaSession(): void {
  try {
    sessionStorage.removeItem(ADMIN_MFA_STORAGE_KEY);
  } catch {
    // Storage denial is treated as signed out by the caller.
  }
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
