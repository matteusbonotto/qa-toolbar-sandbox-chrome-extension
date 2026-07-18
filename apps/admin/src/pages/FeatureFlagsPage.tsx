import { useState } from "react";
import { listFeatures, listPlanFeatures, listPlans, setPlanFeatureValue } from "../lib/api";
import { useAsyncData } from "../lib/useAsyncData";

export function FeatureFlagsPage() {
  const plans = useAsyncData(listPlans);
  const features = useAsyncData(listFeatures);
  const planFeatures = useAsyncData(listPlanFeatures);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valueByCell = new Map(
    (planFeatures.data ?? []).map((row) => [`${row.plan_id}:${row.feature_id}`, row.value]),
  );

  async function handleChange(planId: string, featureId: string, value: boolean | number | string) {
    const cellKey = `${planId}:${featureId}`;
    setSavingKey(cellKey);
    setError(null);
    try {
      await setPlanFeatureValue(planId, featureId, value);
      planFeatures.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(null);
    }
  }

  const loading = plans.loading || features.loading || planFeatures.loading;
  const loadError = plans.error || features.error || planFeatures.error;

  return (
    <div>
      <header className="qa-page-head">
        <h1>Feature flags por plano</h1>
        <p>
          Controla o que cada plano libera de verdade — a extensão e a landing page leem esses
          valores em tempo real via <code>access-status</code>. Alterar aqui muda o acesso do
          usuário na próxima verificação (cache local de até 30s na extensão).
        </p>
      </header>

      {error ? <div className="qa-error">{error}</div> : null}
      {loadError ? <div className="qa-error">{loadError}</div> : null}
      {!loading && !(features.data ?? []).length ? <div className="qa-empty">Nenhuma feature cadastrada.</div> : null}

      {(features.data ?? []).length && (plans.data ?? []).length ? (
        <div className="qa-card" style={{ overflowX: "auto" }}>
          <table className="qa-table">
            <thead>
              <tr>
                <th>Feature</th>
                {(plans.data ?? []).map((plan) => (
                  <th key={plan.id}>{plan.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(features.data ?? []).map((feature) => (
                <tr key={feature.id}>
                  <td>
                    <code>{feature.key}</code>
                    <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{feature.description}</div>
                  </td>
                  {(plans.data ?? []).map((plan) => {
                    const cellKey = `${plan.id}:${feature.id}`;
                    const rawValue = valueByCell.get(cellKey);
                    const busy = savingKey === cellKey;
                    if (feature.value_type === "boolean") {
                      const checked = rawValue === true;
                      return (
                        <td key={plan.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={(event) => void handleChange(plan.id, feature.id, event.target.checked)}
                          />
                        </td>
                      );
                    }
                    if (feature.value_type === "integer") {
                      return (
                        <td key={plan.id}>
                          <input
                            type="number"
                            className="qa-cell-input"
                            defaultValue={typeof rawValue === "number" ? rawValue : ""}
                            disabled={busy}
                            onBlur={(event) => {
                              const raw = event.target.value.trim();
                              if (raw === "") return;
                              const next = Number(raw);
                              if (Number.isFinite(next)) void handleChange(plan.id, feature.id, next);
                            }}
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={plan.id}>
                        <input
                          type="text"
                          className="qa-cell-input"
                          defaultValue={typeof rawValue === "string" ? rawValue : ""}
                          disabled={busy}
                          onBlur={(event) => void handleChange(plan.id, feature.id, event.target.value)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
