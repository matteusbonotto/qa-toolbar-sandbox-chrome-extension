import { createClient } from "@supabase/supabase-js";

const ADMIN_AUTH_STORAGE_KEY = "qts.admin.auth.v1";

export interface StoredAdminMfaSession {
  token: string;
  expiresAt: string;
}

// MFA proof is intentionally memory-only. Persisting it in web storage would
// give injected page code a reusable second-factor token. A reload therefore
// fails closed and requires the administrator to authenticate again.
let activeAdminMfaSession: StoredAdminMfaSession | null = null;

// Public/anon key only — this app never sees a service-role key. Founder-only access is
// enforced server-side (RLS + the roles/user_roles tables), never trusted from the client;
// this client can only do what RLS explicitly allows a "founder" role to do.
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export function readAdminMfaSession(): StoredAdminMfaSession | null {
  const session = activeAdminMfaSession;
  if (!session || !/^[A-Za-z0-9_-]{43}$/.test(session.token)
    || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
    activeAdminMfaSession = null;
    return null;
  }
  return { ...session };
}

export function storeAdminMfaSession(session: StoredAdminMfaSession): void {
  activeAdminMfaSession = { ...session };
}

export function clearAdminMfaSession(): void {
  activeAdminMfaSession = null;
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
