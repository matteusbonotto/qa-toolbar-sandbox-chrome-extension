import type { ReactNode } from "react";
import { useAuth } from "../lib/AuthProvider";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/vouchers", label: "Vouchers", end: false },
  { to: "/features", label: "Feature flags", end: false },
  { to: "/acessos", label: "Acessos", end: false },
  { to: "/licencas", label: "Licenças", end: false },
  { to: "/usuarios", label: "Usuários", end: false },
  { to: "/auditoria", label: "Auditoria", end: false },
  { to: "/juridico", label: "Jurídico", end: false },
  { to: "/campanhas", label: "Campanhas", end: false },
];

export function Layout({ children, currentPath }: { children: ReactNode; currentPath: string }) {
  const { user, signOut } = useAuth();

  return (
    <div className="qa-shell">
      <aside className="qa-sidebar">
        <div className="qa-brand">
          <img className="qts-logo-light" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo.svg`} alt="" width={28} height={28} />
          <img className="qts-logo-dark" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo-dark.svg`} alt="" width={28} height={28} />
          <div>
            <strong>QA Toolbar Sandbox</strong>
            <span>Admin</span>
          </div>
        </div>
        <nav className="qa-nav">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.to}
              href={`#${item.to}`}
              className={`qa-nav-item${currentPath === item.to ? " isActive" : ""}`}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="qa-sidebar-footer">
          <div>{user?.email}</div>
          <button type="button" onClick={() => void signOut()}>
            Sair
          </button>
        </div>
      </aside>
      <main className="qa-content">{children}</main>
    </div>
  );
}
