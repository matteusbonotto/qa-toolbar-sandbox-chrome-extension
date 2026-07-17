import { listAuditLogs } from "../lib/api";
import { useAsyncData } from "../lib/useAsyncData";

export function AuditPage() {
  const logs = useAsyncData(() => listAuditLogs(200));
  return (
    <div>
      <header className="qa-page-head">
        <h1>Auditoria</h1>
        <p>Últimas ações administrativas e eventos sensíveis, sem expor códigos, tokens ou senhas.</p>
      </header>
      <div className="qa-card">
        {logs.error ? <div className="qa-error">{logs.error}</div> : null}
        {logs.loading ? <div className="qa-empty">Carregando auditoria…</div> : null}
        {(logs.data ?? []).length ? (
          <table className="qa-table">
            <thead><tr><th>Quando</th><th>Ação</th><th>Alvo</th><th>Ator</th><th>Correlation ID</th></tr></thead>
            <tbody>{(logs.data ?? []).map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString("pt-BR")}</td>
                <td><code>{log.action}</code></td>
                <td>{log.target_type}{log.target_id ? ` · ${log.target_id.slice(0, 18)}` : ""}</td>
                <td title={log.actor_id ?? "Sistema"}>{log.actor_id ? `${log.actor_id.slice(0, 8)}…` : "Sistema"}</td>
                <td title={log.correlation_id}>{log.correlation_id.slice(0, 8)}…</td>
              </tr>
            ))}</tbody>
          </table>
        ) : !logs.loading ? <div className="qa-empty">Nenhum evento registrado.</div> : null}
      </div>
    </div>
  );
}
