import { AuthProvider, useAuth } from "./lib/AuthProvider";
import { useHashPath } from "./lib/hashRoute";
import { LoginScreen } from "./components/LoginScreen";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { VouchersPage } from "./pages/VouchersPage";
import { FeatureFlagsPage } from "./pages/FeatureFlagsPage";
import { AccessPage } from "./pages/AccessPage";
import { LicensesPage } from "./pages/LicensesPage";
import { UsersPage } from "./pages/UsersPage";
import { AuditPage } from "./pages/AuditPage";
import { LegalRegistrationPage } from "./pages/LegalRegistrationPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

function Gate() {
  const { status } = useAuth();
  const path = useHashPath();

  if (status === "loading") {
    return <div className="qa-login-screen">Carregando…</div>;
  }
  if (status !== "founder") {
    return <LoginScreen />;
  }

  const routes: Record<string, ReactNode> = {
    "/": <DashboardPage />,
    "/vouchers": <VouchersPage />,
    "/features": <FeatureFlagsPage />,
    "/acessos": <AccessPage />,
    "/licencas": <LicensesPage />,
    "/usuarios": <UsersPage />,
    "/auditoria": <AuditPage />,
    "/juridico": <LegalRegistrationPage />,
    "/campanhas": <CampaignsPage />,
  };
  return <Layout currentPath={path}>{routes[path] || <NotFoundPage />}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
import type { ReactNode } from "react";
