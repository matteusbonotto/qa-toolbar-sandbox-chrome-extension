import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
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
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <div className="qa-shell">
      <aside className="qa-sidebar">
        <div className="qa-brand">
          <img src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo.png`} alt="" width={28} height={28} />
          <div>
            <strong>QA Toolbar Sandbox</strong>
            <span>Admin</span>
          </div>
        </div>
        <nav className="qa-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `qa-nav-item${isActive ? " isActive" : ""}`}
            >
              {item.label}
            </NavLink>
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
