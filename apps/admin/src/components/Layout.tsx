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
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <div className="qa-shell">
      <aside className="qa-sidebar">
        <div className="qa-brand">
          <span className="qa-brand-dot" />
          <span>QTS Admin</span>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
