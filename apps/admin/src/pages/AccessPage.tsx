import { useState } from "react";
import { createEntitlementGrant, listEntitlementGrants, listPlans, listProfiles, revokeEntitlementGrant } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useAsyncData } from "../lib/useAsyncData";
import type { EntitlementSource } from "../lib/types";

const SOURCES: EntitlementSource[] = ["manual", "founder", "trial", "voucher", "license", "subscription"];

export function AccessPage() {
  const plans = useAsyncData(listPlans);
  const grants = useAsyncData(listEntitlementGrants);
  const profiles = useAsyncData(listProfiles);
  const emailByUserId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.email]));

  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState("");
  const [source, setSource] = useState<EntitlementSource>("manual");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!userId.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await createEntitlementGrant({
        userId: userId.trim(),
        planId: planId || null,
        source,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setUserId("");
      setExpiresAt("");
      grants.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="qa-page-head">
        <h1>Acessos manuais</h1>
        <p>
          Conceda ou revogue acesso a um plano sem passar pelo Stripe (founder, trial estendido,
          cortesia). Deixe "Expira em" vazio para acesso permanente (<code>expires_at = null</code>).
        </p>
      </header>

      <div className="qa-card">
        <h2>Conceder acesso</h2>
        {formError ? <div className="qa-error">{formError}</div> : null}
        <form className="qa-form-row" onSubmit={handleCreate}>
          <input placeholder="User ID (UUID do Supabase Auth)" value={userId} onChange={(e) => setUserId(e.target.value)} />
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Plano…</option>
            {(plans.data ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value as EntitlementSource)}>
            {SOURCES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input type="date" placeholder="Expira em (opcional)" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          <button type="submit" className="qa-btn primary" disabled={busy}>
            + Conceder
          </button>
        </form>

        {grants.error ? <div className="qa-error">{grants.error}</div> : null}
        {!grants.loading && !(grants.data ?? []).length ? <div className="qa-empty">Nenhum acesso manual concedido ainda.</div> : null}
        {(grants.data ?? []).length ? (
          <table className="qa-table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Origem</th>
                <th>Expira em</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(grants.data ?? []).map((grant) => (
                <tr key={grant.id}>
                  <td title={grant.user_id}>{emailByUserId.get(grant.user_id) || `${grant.user_id.slice(0, 8)}…`}</td>
                  <td>{grant.source}</td>
                  <td>{grant.expires_at ? new Date(grant.expires_at).toLocaleDateString("pt-BR") : "Permanente"}</td>
                  <td>
                    <span className={`qa-badge ${grant.revoked_at ? "revoked" : "active"}`}>{grant.revoked_at ? "revogado" : "ativo"}</span>
                  </td>
                  <td>
                    {!grant.revoked_at ? (
                      <button type="button" className="qa-btn danger" onClick={() => revokeEntitlementGrant(grant.id).then(grants.reload).catch((err) => setFormError(errorMessage(err)))}>
                        Revogar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
