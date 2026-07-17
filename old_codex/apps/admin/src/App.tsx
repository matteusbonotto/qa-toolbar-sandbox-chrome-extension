import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabaseClient";
import { adminApi, AdminApiError, type WhoAmI } from "./services/adminApi";
import { Dashboard } from "./pages/Dashboard";
import { Catalog } from "./pages/Catalog";
import { Vouchers } from "./pages/Vouchers";
import { Users } from "./pages/Users";
import { AuditLog } from "./pages/AuditLog";

type Tab = "dashboard" | "catalog" | "vouchers" | "users" | "audit";

const tabs: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "catalog", label: "Planos e Preços" },
  { id: "vouchers", label: "Vouchers" },
  { id: "users", label: "Usuários e Acesso" },
  { id: "audit", label: "Auditoria" },
];

type AuthState = "loading" | "signedOut" | "checkingRole" | "unauthorized" | "authorized" | "configError";

export function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [configErrorMessage, setConfigErrorMessage] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [whoAmI, setWhoAmI] = useState<WhoAmI | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [signInError, setSignInError] = useState("");

  const checkRole = useCallback(async (nextSession: Session) => {
    setAuthState("checkingRole");
    try {
      const identity = await adminApi.whoAmI();
      setWhoAmI(identity);
      setSession(nextSession);
      setAuthState(identity.isAdmin ? "authorized" : "unauthorized");
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : "Não foi possível verificar sua permissão.");
      setAuthState("unauthorized");
    }
  }, []);

  useEffect(() => {
    let client: ReturnType<typeof getSupabaseClient>;
    try {
      client = getSupabaseClient();
    } catch (error) {
      setConfigErrorMessage(error instanceof Error ? error.message : "Configuração ausente.");
      setAuthState("configError");
      return;
    }

    client.auth.getSession().then(({ data }) => {
      if (data.session) void checkRole(data.session);
      else setAuthState("signedOut");
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession) void checkRole(nextSession);
      else {
        setSession(null);
        setWhoAmI(null);
        setAuthState("signedOut");
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, [checkRole]);

  const signInWithGoogle = async () => {
    setSignInError("");
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href.split("#")[0] ?? window.location.origin },
    });
    if (error) setSignInError(error.message);
  };

  const signOut = async () => {
    await getSupabaseClient().auth.signOut();
  };

  if (authState === "configError") {
    return (
      <div className="adminShell adminShell-center">
        <div className="adminCard">
          <h1>Configuração ausente</h1>
          <p>{configErrorMessage}</p>
        </div>
      </div>
    );
  }

  if (authState === "loading" || authState === "checkingRole") {
    return (
      <div className="adminShell adminShell-center">
        <div className="adminCard"><p>Verificando sessão…</p></div>
      </div>
    );
  }

  if (authState === "signedOut") {
    return (
      <div className="adminShell adminShell-center">
        <div className="adminCard adminLoginCard">
          <span className="adminEyebrow">QA Toolbar Sandbox</span>
          <h1>Painel Administrativo</h1>
          <p>Acesso restrito à conta autorizada pelo founder. Entre com o Google associado a essa conta.</p>
          <button type="button" className="adminButton adminButton-primary" onClick={() => void signInWithGoogle()}>
            Entrar com Google
          </button>
          {signInError ? <p className="adminError">{signInError}</p> : null}
        </div>
      </div>
    );
  }

  if (authState === "unauthorized") {
    return (
      <div className="adminShell adminShell-center">
        <div className="adminCard">
          <h1>Acesso não autorizado</h1>
          <p>
            A conta {session?.user.email ?? ""} entrou com sucesso, mas não possui a role administrativa nesta
            plataforma. Apenas a conta founder configurada no backend pode acessar este painel.
          </p>
          {signInError ? <p className="adminError">{signInError}</p> : null}
          <button type="button" className="adminButton" onClick={() => void signOut()}>Sair</button>
        </div>
      </div>
    );
  }

  return (
    <div className="adminShell">
      <aside className="adminNav">
        <div className="adminBrand">
          <span>QA Toolbar Sandbox</span>
          <strong>Admin</strong>
        </div>
        <nav>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`adminNavItem${activeTab === tab.id ? " isActive" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="adminNavFooter">
          <span className="adminRoleBadge">{whoAmI?.isFounder ? "Founder" : "Admin"}</span>
          <small>{whoAmI?.email}</small>
          <button type="button" className="adminButton adminButton-ghost" onClick={() => void signOut()}>Sair</button>
        </div>
      </aside>
      <main className="adminContent">
        {activeTab === "dashboard" ? <Dashboard /> : null}
        {activeTab === "catalog" ? <Catalog isFounder={Boolean(whoAmI?.isFounder)} /> : null}
        {activeTab === "vouchers" ? <Vouchers /> : null}
        {activeTab === "users" ? <Users /> : null}
        {activeTab === "audit" ? <AuditLog /> : null}
      </main>
    </div>
  );
}

export function describeApiError(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Ocorreu um erro inesperado.";
}
