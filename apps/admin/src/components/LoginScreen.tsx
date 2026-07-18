import { useEffect, useState, type FormEvent } from "react";
import { FOUNDER_EMAIL, useAuth } from "../lib/AuthProvider";
import { isSupabaseConfigured } from "../lib/supabaseClient";

export function LoginScreen() {
  const {
    status,
    otpEmail,
    signInWithPassword,
    sendPasswordReset,
    verifyEmailOtp,
    resendEmailOtp,
    signOut,
  } = useAuth();
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(60);

  useEffect(() => {
    if (status !== "otp-pending" || resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [status, resendIn]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signInWithPassword(FOUNDER_EMAIL, password);
      setPassword("");
      setResendIn(60);
    } catch {
      setError("Senha incorreta. Se você esqueceu a senha, use o link abaixo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendPasswordReset();
      setNotice("Se essa conta existir, enviamos um link de redefinição de senha para o e-mail cadastrado.");
    } catch {
      setError("Não foi possível enviar o link agora. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{8}$/.test(otp)) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmailOtp(otp);
      setOtp("");
    } catch {
      setError("Código inválido ou expirado. Use o código mais recente recebido no Gmail.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setBusy(true);
    setError(null);
    try {
      await resendEmailOtp();
      setOtp("");
      setResendIn(60);
    } catch {
      setError("Não foi possível reenviar agora. Aguarde um minuto ou autentique novamente com a senha.");
    } finally {
      setBusy(false);
    }
  }

  const otpPending = status === "otp-pending";

  return (
    <div className="qa-login-screen">
      <div className="qa-brand" style={{ paddingBottom: 0 }}>
        <span className="qa-brand-dot" />
        <span>QA Toolbar Sandbox — Admin</span>
      </div>
      <h1>{otpPending ? "Digite o código recebido" : "Entre para continuar"}</h1>
      <p>
        {otpPending
          ? `Enviamos um código de 8 dígitos para ${otpEmail ?? "o Gmail cadastrado"}. Ele expira em 10 minutos.`
          : "Use sua senha e, na etapa seguinte, confirme o código enviado ao seu e-mail."}
      </p>

      <div className="qa-login-steps" aria-label="Etapas de autenticação">
        <div className={!otpPending ? "is-active" : "is-complete"}><strong>1</strong><span>Senha</span></div>
        <span className="qa-login-step-line" />
        <div className={otpPending ? "is-active" : ""}><strong>2</strong><span>Código por e-mail</span></div>
      </div>

      {!isSupabaseConfigured ? (
        <div className="qa-config-warning">O serviço de autenticação está indisponível nesta publicação.</div>
      ) : otpPending ? (
        <form className="qa-login-form" onSubmit={(event) => void handleOtpSubmit(event)}>
          <label>
            Código de segurança
            <input
              className="qa-otp-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{8}"
              maxLength={8}
              required
              autoFocus
              placeholder="00000000"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
            />
          </label>
          {error ? <div className="qa-error" role="alert">{error}</div> : null}
          <button type="submit" className="qa-google-btn" disabled={busy || otp.length !== 8}>
            {busy ? "Validando…" : "Validar código"}
          </button>
          <button type="button" className="qa-login-secondary" disabled={busy || resendIn > 0} onClick={() => void handleResend()}>
            {resendIn > 0 ? `Reenviar em ${resendIn}s` : "Reenviar código"}
          </button>
          <button type="button" className="qa-login-secondary" disabled={busy} onClick={() => void signOut()}>
            Voltar para a senha
          </button>
          <small>Após a validação, o acesso administrativo dura no máximo 60 minutos.</small>
        </form>
      ) : (
        <form className="qa-login-form" onSubmit={(event) => void handlePasswordSubmit(event)}>
          <div className="qa-admin-identity">
            <span>Conta autorizada</span>
            <strong>{FOUNDER_EMAIL}</strong>
          </div>
          <label>
            Senha
            <input
              type="password"
              minLength={8}
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {notice ? <div className="qa-notice" role="status">{notice}</div> : null}
          {error ? <div className="qa-error" role="alert">{error}</div> : null}
          <button type="submit" className="qa-google-btn" disabled={busy}>
            {busy ? "Aguarde…" : "Continuar com senha"}
          </button>
          <button type="button" className="qa-login-secondary" disabled={busy} onClick={() => void handleForgotPassword()}>
            Esqueci minha senha
          </button>
        </form>
      )}
    </div>
  );
}
