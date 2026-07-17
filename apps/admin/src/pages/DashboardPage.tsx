import { getDashboardMetrics } from "../lib/api";
import { useAsyncData } from "../lib/useAsyncData";

const METRIC_LABELS: Record<string, string> = {
  activeSubscriptions: "Assinaturas ativas",
  trialingSubscriptions: "Em trial",
  vouchersRedeemed: "Vouchers resgatados",
  vouchersAvailable: "Vouchers disponíveis",
  activeLicenses: "Licenças ativas",
  qualifiedReferrals: "Indicações qualificadas",
  totalUsers: "Usuários cadastrados",
};

export function DashboardPage() {
  const { data, error, loading } = useAsyncData(getDashboardMetrics);

  return (
    <div>
      <header className="qa-page-head">
        <h1>Dashboard</h1>
        <p>Visão geral de assinaturas, vouchers, licenças e indicações.</p>
      </header>

      {error ? <div className="qa-error">{error}</div> : null}
      {loading ? <div className="qa-empty">Carregando métricas…</div> : null}

      {data ? (
        <div className="qa-metrics-grid">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="qa-metric-card">
              <div className="value">{value}</div>
              <div className="label">{METRIC_LABELS[key] ?? key}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
