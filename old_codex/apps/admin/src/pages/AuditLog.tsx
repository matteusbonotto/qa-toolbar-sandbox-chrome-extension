import { useEffect, useState } from "react";
import { adminApi, type AuditLogEntry } from "../services/adminApi";
import { describeApiError } from "../App";

const targetTypes = ["", "plan", "plan_feature", "plan_price", "feature_flag", "system_notice", "app_version", "voucher", "voucher_campaign", "user"];

export function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi.auditLog(filter || undefined)
      .then((response) => { if (!cancelled) setEntries(response.entries); })
      .catch((thrown) => { if (!cancelled) setError(describeApiError(thrown)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <section className="adminSection">
      <header className="adminSectionHead">
        <h2>Log de auditoria</h2>
        <p>Toda mutação administrativa é registrada com ator, ação, alvo e motivo.</p>
      </header>
      <div className="adminToolbar">
        <label>
          <span>Filtrar por tipo de alvo</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            {targetTypes.map((type) => <option key={type || "all"} value={type}>{type || "Todos"}</option>)}
          </select>
        </label>
      </div>
      {error ? <p className="adminError">{error}</p> : null}
      <div className="adminTableWrap">
        <table className="adminTable">
          <thead>
            <tr><th>Ação</th><th>Alvo</th><th>Ator</th><th>Motivo</th><th>Metadados</th><th>Quando</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.action}</td>
                <td>{entry.target_type}{entry.target_id ? ` · ${entry.target_id}` : ""}</td>
                <td className="adminMonoCell">{entry.actor_id ?? "—"}</td>
                <td>{entry.reason ?? "—"}</td>
                <td className="adminMonoCell">{Object.keys(entry.metadata ?? {}).length ? JSON.stringify(entry.metadata) : "—"}</td>
                <td>{new Date(entry.created_at).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
            {!entries.length && !loading ? (
              <tr><td colSpan={6} className="adminEmptyCell">Nenhum registro encontrado para este filtro.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
