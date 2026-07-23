import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthProvider";
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

function Gate() {
  const { status } = useAuth();

  if (status === "loading") {
    return <div className="qa-login-screen">Carregando…</div>;
  }
  if (status !== "founder") {
    return <LoginScreen />;
  }

  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/vouchers" element={<VouchersPage />} />
          <Route path="/features" element={<FeatureFlagsPage />} />
          <Route path="/acessos" element={<AccessPage />} />
          <Route path="/licencas" element={<LicensesPage />} />
          <Route path="/usuarios" element={<UsersPage />} />
          <Route path="/auditoria" element={<AuditPage />} />
          <Route path="/juridico" element={<LegalRegistrationPage />} />
          <Route path="/campanhas" element={<CampaignsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
