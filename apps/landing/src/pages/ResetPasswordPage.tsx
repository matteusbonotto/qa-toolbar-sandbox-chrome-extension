import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { updatePassword } from "../services/checkout";

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [linkValid, setLinkValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setReady(true);
      setLinkValid(false);
      return;
    }
    const client = supabase;
    let settled = false;
    const { data: subscription } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        settled = true;
        setLinkValid(true);
        setReady(true);
      }
    });
    // Deliberately does NOT fall back to "any existing session is fine" — a leftover session
    // from something unrelated (e.g. still signed in from an earlier admin login attempt in
    // the same browser) must never be accepted as a password-recovery grant, or updatePassword
    // would run against a stale session and fail with a confusing 422 instead of a clear
    // "this link is invalid" message. Only the PASSWORD_RECOVERY event — fired specifically when
    // Supabase's client parses a real recovery code/token out of the URL — counts.
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setLinkValid(false);
      setReady(true);
    }, 2_000);
    return () => {
      subscription.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t.resetPassword.tooShort);
      return;
    }
    if (password !== confirmPassword) {
      setError(t.resetPassword.mismatch);
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setSuccess(true);
    } catch {
      setError(t.resetPassword.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="qts-privacy-page qts-reset-page">
      <div className="qts-container qts-privacy-inner">
        <a className="qts-back-link" href={import.meta.env.BASE_URL}>
          {t.resetPassword.backLink}
        </a>
        <span className="qts-eyebrow">{t.resetPassword.eyebrow}</span>
        <h1>{t.resetPassword.title}</h1>
        <p className="qts-section-lead">{t.resetPassword.lead}</p>

        {!ready ? null : success ? (
          <div className="qts-auth-feedback" role="status">
            <p>{t.resetPassword.success}</p>
            <a className="qts-btn qts-btn-primary" href={import.meta.env.BASE_URL}>
              {t.resetPassword.successCta}
            </a>
          </div>
        ) : !linkValid ? (
          <p className="qts-auth-feedback is-error" role="alert">{t.resetPassword.invalidLink}</p>
        ) : (
          <form className="qts-auth-form" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              <span>{t.resetPassword.newPasswordLabel}</span>
              <input
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              <span>{t.resetPassword.confirmPasswordLabel}</span>
              <input
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {error ? <div className="qts-auth-feedback is-error" role="alert">{error}</div> : null}
            <button type="submit" className="qts-btn qts-btn-primary qts-auth-submit" disabled={busy}>
              {busy ? t.resetPassword.working : t.resetPassword.submit}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
