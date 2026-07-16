import { useEffect, useState } from "react";
import { adminApi, type AuditLogEntry, type DashboardOverview } from "../services/adminApi";
import { describeApiError } from "../App";

export function Dashboard() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [recentActivity, setRecentActivity] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([adminApi.dashboard(), adminApi.auditLog()])
      .then(([dashboard, audit]) => {
        if (cancelled) return;
        setOverview(dashboard.overview);
        setRecentActivity(audit.entries.slice(0, 12));
      })
      .catch((thrown) => { if (!cancelled) setError(describeApiError(thrown)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const metrics: { label: string; value: number | undefined }[] = overview ? [
    { label: "Usuários totais", value: overview.total_users },
    { label: "Assinaturas pagas ativas", value: overview.active_paid_subscriptions },
    { label: "Acessos manuais ativos", value: overview.active_manual_grants },
    { label: "Acessos founder ativos", value: overview.active_founder_grants },
    { label: "Acessos por voucher ativos", value: overview.active_voucher_grants },
    { label: "Vouchers disponíveis", value: overview.vouchers_available },
    { label: "Vouchers resgatados", value: overview.vouchers_redeemed },
    { label: "Campanhas ativas", value: overview.campaigns_active },
  ] : [];

  return (
    <section className="adminSection">
      <header className="adminSectionHead">
        <h2>Dashboard</h2>
        <p>Visão geral de acesso, assinaturas e vouchers em tempo real.</p>
      </header>
      {error ? <p className="adminError">{error}</p> : null}
      {loading ? <p className="adminMuted">Carregando métricas…</p> : (
        <div className="adminMetricGrid">
          {metrics.map((metric) => (
            <div key={metric.label} className="adminMetricCard">
              <strong>{metric.value ?? "—"}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>
      )}
      <h3 className="adminSubheading">Atividade recente</h3>
      <div className="adminTableWrap">
        <table className="adminTable">
          <thead>
            <tr><th>Ação</th><th>Alvo</th><th>Motivo</th><th>Quando</th></tr>
          </thead>
          <tbody>
            {recentActivity.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.action}</td>
                <td>{entry.target_type}{entry.target_id ? ` · ${entry.target_id}` : ""}</td>
                <td>{entry.reason ?? "—"}</td>
                <td>{new Date(entry.created_at).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
            {!recentActivity.length && !loading ? (
              <tr><td colSpan={4} className="adminEmptyCell">Nenhuma atividade registrada ainda.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
