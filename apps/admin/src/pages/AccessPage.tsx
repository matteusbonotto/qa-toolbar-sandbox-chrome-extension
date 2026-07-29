import { useState } from "react";
import { createEntitlementGrant, listEntitlementGrants, listPlans, listProfiles, revokeEntitlementGrant } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useAsyncData } from "../lib/useAsyncData";
import type { EntitlementSource } from "../lib/types";

type AdministrativeSource = Extract<EntitlementSource, "manual" | "founder" | "trial">;
const SOURCES: { value: AdministrativeSource; label: string }[] = [
  { value: "manual", label: "Cortesia manual" },
  { value: "founder", label: "Fundador" },
  { value: "trial", label: "Trial estendido" },
];

export function AccessPage() {
  const plans = useAsyncData(listPlans);
  const grants = useAsyncData(listEntitlementGrants);
  const profiles = useAsyncData(listProfiles);
  const emailByUserId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.email]));
  const planById = new Map((plans.data ?? []).map((plan) => [plan.id, plan.name]));
  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState("");
  const [source, setSource] = useState<AdministrativeSource>("manual");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!userId || !planId) {
      setFormError("Selecione o usuário e o plano.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await createEntitlementGrant({
        userId,
        planId,
        source,
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.999Z`).toISOString() : null,
      });
      setUserId("");
      setPlanId("");
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
          Conceda um plano diretamente a um usuário. Voucher, licença e assinatura são gerenciados
          em seus próprios fluxos. Deixe "Expira em" vazio para acesso permanente.
        </p>
      </header>

      <div className="qa-card">
        <h2>Conceder acesso</h2>
        {formError ? <div className="qa-error">{formError}</div> : null}
        <form className="qa-form-row" onSubmit={handleCreate}>
          <select aria-label="Usuário" value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">Selecione o usuário</option>
            {(profiles.data ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.email || profile.display_name || profile.id}
              </option>
            ))}
          </select>
          <select aria-label="Plano" value={planId} onChange={(event) => setPlanId(event.target.value)}>
            <option value="">Selecione o plano</option>
            {(plans.data ?? []).filter((plan) => plan.is_active).map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name}</option>
            ))}
          </select>
          <select aria-label="Origem" value={source} onChange={(event) => setSource(event.target.value as AdministrativeSource)}>
            {SOURCES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <input aria-label="Expira em" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          <button type="submit" className="qa-btn primary" disabled={busy}>+ Conceder</button>
        </form>

        {grants.error ? <div className="qa-error">{grants.error}</div> : null}
        {!grants.loading && !(grants.data ?? []).length ? <div className="qa-empty">Nenhum acesso manual concedido ainda.</div> : null}
        {(grants.data ?? []).length ? (
          <table className="qa-table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Origem</th>
                <th>Plano</th>
                <th>Expira em</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(grants.data ?? []).map((grant) => (
                <tr key={grant.id}>
                  <td title={grant.user_id}>{emailByUserId.get(grant.user_id) || `${grant.user_id.slice(0, 8)}...`}</td>
                  <td>{grant.source}</td>
                  <td>{grant.plan_id ? planById.get(grant.plan_id) || "Plano removido" : "Sem plano"}</td>
                  <td>{grant.expires_at ? new Date(grant.expires_at).toLocaleDateString("pt-BR") : "Permanente"}</td>
                  <td>
                    <span className={`qa-badge ${grant.revoked_at ? "revoked" : "active"}`}>
                      {grant.revoked_at ? "revogado" : "ativo"}
                    </span>
                  </td>
                  <td>
                    {!grant.revoked_at ? (
                      <button
                        type="button"
                        className="qa-btn danger"
                        onClick={() => revokeEntitlementGrant(grant.id).then(grants.reload).catch((err) => setFormError(errorMessage(err)))}
                      >
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
