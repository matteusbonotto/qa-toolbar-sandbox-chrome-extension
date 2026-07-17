import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  clearAdminMfaSession,
  isSupabaseConfigured,
  readAdminMfaSession,
  storeAdminMfaSession,
  supabase,
  supabaseAnonKey,
  supabaseUrl,
} from "./supabaseClient";

type AuthStatus = "loading" | "signed-out" | "otp-pending" | "founder" | "forbidden";

interface OtpRequestResponse {
  challengeId: string;
  expiresAt: string;
}

interface OtpVerificationResponse {
  mfaToken: string;
  expiresAt: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  otpEmail: string | null;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  createFounderAccount: (password: string) => Promise<void>;
  verifyEmailOtp: (code: string) => Promise<void>;
  resendEmailOtp: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const FOUNDER_EMAIL = "matteusbonotto+admin@gmail.com";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "e-mail cadastrado";
  return `${local.slice(0, 2)}${"•".repeat(Math.max(3, Math.min(8, local.length - 2)))}@${domain}`;
}

async function invokeAdminOtp<T>(accessToken: string, body: Record<string, unknown>): Promise<T> {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error("backend_not_configured");
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-email-otp`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "admin_otp_failed");
  return payload;
}

/**
 * Founder access is password + email OTP. Postgres RLS validates the short-lived
 * proof on every administrative query, so this UI is not the security boundary.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const challengeIdRef = useRef<string | null>(null);
  const otpEmailRawRef = useRef<string | null>(null);
  const passwordFlowRef = useRef(false);
  const expiryTimerRef = useRef<number | null>(null);

  function clearExpiryTimer() {
    if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
  }

  function scheduleExpiry(expiresAt: string) {
    clearExpiryTimer();
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now());
    expiryTimerRef.current = window.setTimeout(() => void signOut(), Math.min(delay, 2_147_000_000));
  }

  async function evaluateSession(nextSession: Session | null) {
    setSession(nextSession);
    if (!nextSession?.user) {
      clearAdminMfaSession();
      clearExpiryTimer();
      setStatus("signed-out");
      return;
    }
    if (!supabase) {
      setStatus("forbidden");
      return;
    }
    if (passwordFlowRef.current && !readAdminMfaSession()) return;

    const stored = readAdminMfaSession();
    if (!stored || Date.parse(stored.expiresAt) <= Date.now()) {
      clearAdminMfaSession();
      await supabase.auth.signOut({ scope: "local" });
      setSession(null);
      setStatus("signed-out");
      return;
    }
    const { data, error } = await supabase.rpc("admin_mfa_expires_at");
    const verifiedExpiry = typeof data === "string" ? data : null;
    if (error || !verifiedExpiry || Date.parse(verifiedExpiry) <= Date.now()) {
      clearAdminMfaSession();
      await supabase.auth.signOut({ scope: "local" });
      setSession(null);
      setStatus("signed-out");
      return;
    }
    storeAdminMfaSession({ token: stored.token, expiresAt: verifiedExpiry });
    scheduleExpiry(verifiedExpiry);
    setStatus("founder");
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setStatus("forbidden");
      return;
    }
    const client = supabase;
    void client.auth.getSession().then(({ data }) => evaluateSession(data.session));
    const { data: subscription } = client.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      window.setTimeout(() => {
        if (event === "SIGNED_OUT") {
          clearAdminMfaSession();
          clearExpiryTimer();
          setStatus("signed-out");
          return;
        }
        void evaluateSession(nextSession);
      }, 0);
    });
    return () => {
      clearExpiryTimer();
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function requestOtp(passwordSession: Session): Promise<void> {
    const requested = await invokeAdminOtp<OtpRequestResponse>(passwordSession.access_token, { action: "request" });
    if (!/^[0-9a-f-]{36}$/i.test(requested.challengeId) || Date.parse(requested.expiresAt) <= Date.now()) {
      throw new Error("invalid_otp_challenge");
    }
    challengeIdRef.current = requested.challengeId;
    setStatus("otp-pending");
  }

  async function signInWithPassword(email: string, password: string) {
    if (!supabase) throw new Error("backend_not_configured");
    clearAdminMfaSession();
    clearExpiryTimer();
    challengeIdRef.current = null;
    passwordFlowRef.current = true;
    setStatus("loading");
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail !== FOUNDER_EMAIL) {
      passwordFlowRef.current = false;
      setStatus("signed-out");
      throw new Error("admin_email_required");
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error || !data.session || !data.user) throw new Error("invalid_credentials");
      setSession(data.session);
      const bootstrap = await supabase.rpc("bootstrap_founder");
      if (bootstrap.error || bootstrap.data !== true) throw new Error("admin_access_denied");
      otpEmailRawRef.current = normalizedEmail;
      setOtpEmail(maskEmail(normalizedEmail));
      await requestOtp(data.session);
    } catch (error) {
      passwordFlowRef.current = false;
      challengeIdRef.current = null;
      otpEmailRawRef.current = null;
      setOtpEmail(null);
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      setSession(null);
      setStatus("signed-out");
      throw error;
    }
  }

  async function createFounderAccount(password: string) {
    if (!supabase) throw new Error("backend_not_configured");
    if (password.length < 8) throw new Error("weak_password");
    clearAdminMfaSession();
    clearExpiryTimer();
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href;
    const { data, error } = await supabase.auth.signUp({
      email: FOUNDER_EMAIL,
      password,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw new Error("founder_signup_failed");
    if (data.session) await supabase.auth.signOut({ scope: "local" });
    setSession(null);
    setStatus("signed-out");
  }

  async function verifyEmailOtp(code: string) {
    if (!supabase || !session || !otpEmailRawRef.current || !challengeIdRef.current) {
      throw new Error("otp_challenge_missing");
    }
    if (!/^\d{8}$/.test(code)) throw new Error("invalid_otp");
    const verified = await invokeAdminOtp<OtpVerificationResponse>(session.access_token, {
      action: "verify",
      challengeId: challengeIdRef.current,
      otp: code,
    });
    if (!/^[A-Za-z0-9_-]{43}$/.test(verified.mfaToken) || Date.parse(verified.expiresAt) <= Date.now()) {
      throw new Error("invalid_admin_session");
    }
    storeAdminMfaSession({ token: verified.mfaToken, expiresAt: verified.expiresAt });
    passwordFlowRef.current = false;
    challengeIdRef.current = null;
    otpEmailRawRef.current = null;
    setOtpEmail(null);
    setStatus("loading");
    await evaluateSession(session);
  }

  async function resendEmailOtp() {
    if (!session || !passwordFlowRef.current) throw new Error("recent_password_required");
    await requestOtp(session);
  }

  async function signOut() {
    const currentSession = session;
    const mfa = readAdminMfaSession();
    if (currentSession && mfa) {
      await invokeAdminOtp(currentSession.access_token, { action: "revoke", mfaToken: mfa.token }).catch(() => undefined);
    }
    passwordFlowRef.current = false;
    challengeIdRef.current = null;
    otpEmailRawRef.current = null;
    setOtpEmail(null);
    clearAdminMfaSession();
    clearExpiryTimer();
    if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    setSession(null);
    setStatus("signed-out");
  }

  return (
    <AuthContext.Provider value={{
      status,
      user: session?.user ?? null,
      session,
      otpEmail,
      signInWithPassword,
      createFounderAccount,
      verifyEmailOtp,
      resendEmailOtp,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
