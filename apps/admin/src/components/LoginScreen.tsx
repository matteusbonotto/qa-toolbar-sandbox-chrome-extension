import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/AuthProvider";
import { isSupabaseConfigured } from "../lib/supabaseClient";

export function LoginScreen() {
  const { status, otpEmail, signInWithPassword, verifyEmailOtp, resendEmailOtp, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(60);

  useEffect(() => {
    if (status !== "otp-pending" || resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [status, resendIn]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email.trim(), password);
      setPassword("");
      setResendIn(60);
    } catch {
      setError("Não foi possível entrar ou enviar o código. Confira e-mail, senha e confirmação da conta.");
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
      setError("Não foi possível reenviar. Aguarde um minuto ou autentique novamente com a senha.");
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
      <h1>{otpPending ? "Confirme o código" : status === "forbidden" ? "Acesso restrito" : "Entre para continuar"}</h1>
      <p>
        {otpPending
          ? `Enviamos um código de 8 dígitos para ${otpEmail ?? "o Gmail cadastrado"}. Ele expira em 10 minutos.`
          : status === "forbidden"
            ? "A sessão atual não possui autorização founder com segundo fator válido."
            : "Primeiro confirme e-mail e senha. Depois será obrigatório informar o código recebido no Gmail."}
      </p>
      {!isSupabaseConfigured ? (
        <div className="qa-config-warning">
          Configuração pública do Supabase ausente. O build exige VITE_SUPABASE_URL e
          VITE_SUPABASE_PUBLISHABLE_KEY; nenhuma chave privilegiada pertence ao navegador.
        </div>
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
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
            />
          </label>
          {error ? <div className="qa-error" role="alert">{error}</div> : null}
          <button type="submit" className="qa-google-btn" disabled={busy || otp.length !== 8}>
            {busy ? "Validando…" : "Validar código"}
          </button>
          <button
            type="button"
            className="qa-login-secondary"
            disabled={busy || resendIn > 0}
            onClick={() => void handleResend()}
          >
            {resendIn > 0 ? `Reenviar em ${resendIn}s` : "Reenviar código"}
          </button>
          <button type="button" className="qa-login-secondary" disabled={busy} onClick={() => void signOut()}>
            Voltar e informar a senha novamente
          </button>
          <small>Após a validação, o acesso administrativo dura no máximo 60 minutos.</small>
        </form>
      ) : (
        <form className="qa-login-form" onSubmit={(event) => void handlePasswordSubmit(event)}>
          <label>
            E-mail
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <div className="qa-error" role="alert">{error}</div> : null}
          <button type="submit" className="qa-google-btn" disabled={busy}>
            {busy ? "Entrando…" : "Continuar com senha"}
          </button>
          {status === "forbidden" ? (
            <button type="button" className="qa-login-secondary" disabled={busy} onClick={() => void signOut()}>
              Encerrar sessão
            </button>
          ) : null}
          <small>Conta ainda não criada? Cadastre e confirme o e-mail primeiro pela landing page.</small>
        </form>
      )}
    </div>
  );
}
