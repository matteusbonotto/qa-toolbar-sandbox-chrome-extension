import { useState } from "react";
import { createLicenseKey, deleteLicenseKey, listLicenseActivations, listLicenseKeys, listPlans, revokeLicenseKey, unrevokeLicenseKey } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useAsyncData } from "../lib/useAsyncData";
import { useAuth } from "../lib/AuthProvider";

export function LicensesPage() {
  const { user } = useAuth();
  const plans = useAsyncData(listPlans);
  const licenses = useAsyncData(listLicenseKeys);
  const activations = useAsyncData(listLicenseActivations);

  const [suffix, setSuffix] = useState("");
  const [planId, setPlanId] = useState("");
  const [maxActivations, setMaxActivations] = useState("1");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!suffix.trim() || !planId || !user) return;
    setBusy(true);
    setFormError(null);
    try {
      await createLicenseKey({
        keySuffix: suffix,
        planId,
        maximumActivations: Number(maxActivations) || 1,
        expiresAt: null,
        createdBy: user.id,
      });
      setSuffix("");
      licenses.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const activationCountByLicense = (activations.data ?? []).reduce<Record<string, number>>((acc, activation) => {
    if (!activation.revoked_at) acc[activation.license_key_id] = (acc[activation.license_key_id] ?? 0) + 1;
    return acc;
  }, {});
  // Deleting a key cascades onto every activation row it ever had (see deleteLicenseKey), so the
  // delete guard below needs the total including revoked ones, not just the still-active count.
  const totalActivationCountByLicense = (activations.data ?? []).reduce<Record<string, number>>((acc, activation) => {
    acc[activation.license_key_id] = (acc[activation.license_key_id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <header className="qa-page-head">
        <h1>Licenças</h1>
        <p>Chaves de licença (ex.: para revenda ou distribuição corporativa) e suas ativações por instalação.</p>
      </header>

      <div className="qa-card">
        <h2>Nova chave</h2>
        {formError ? <div className="qa-error">{formError}</div> : null}
        <form className="qa-form-row" onSubmit={handleCreate}>
          <input placeholder="Sufixo (ex.: EMPRESA-2026)" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Plano…</option>
            {(plans.data ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <input placeholder="Máx. ativações" value={maxActivations} onChange={(e) => setMaxActivations(e.target.value)} />
          <button type="submit" className="qa-btn primary" disabled={busy}>
            + Criar
          </button>
        </form>

        {licenses.error ? <div className="qa-error">{licenses.error}</div> : null}
        {!licenses.loading && !(licenses.data ?? []).length ? <div className="qa-empty">Nenhuma licença criada ainda.</div> : null}
        {(licenses.data ?? []).length ? (
          <table className="qa-table">
            <thead>
              <tr>
                <th>Prefixo</th>
                <th>Ativações</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(licenses.data ?? []).map((license) => (
                <tr key={license.id}>
                  <td>{license.key_prefix}</td>
                  <td>
                    {activationCountByLicense[license.id] ?? 0} / {license.maximum_activations}
                  </td>
                  <td>
                    <span className={`qa-badge ${license.revoked_at ? "revoked" : "active"}`}>{license.revoked_at ? "revogada" : "ativa"}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="qa-btn danger"
                      onClick={() => (license.revoked_at ? unrevokeLicenseKey(license.id) : revokeLicenseKey(license.id)).then(licenses.reload)}
                    >
                      {license.revoked_at ? "Reativar" : "Revogar"}
                    </button>{" "}
                    {!(totalActivationCountByLicense[license.id] ?? 0) ? (
                      <button
                        type="button"
                        className="qa-btn danger"
                        style={{ marginLeft: 6 }}
                        onClick={() => { if (window.confirm("Excluir esta chave de licença?")) void deleteLicenseKey(license.id).then(licenses.reload); }}
                      >
                        Excluir
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
