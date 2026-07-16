import { useEffect, useState } from "react";
import { adminApi, type CatalogSnapshot } from "../services/adminApi";
import { describeApiError } from "../App";

const emptyCatalog: CatalogSnapshot = { plans: [], features: [], planFeatures: [], prices: [], flags: [], notices: [], versions: [] };

export function Catalog({ isFounder }: { isFounder: boolean }) {
  const [catalog, setCatalog] = useState<CatalogSnapshot>(emptyCatalog);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const [planKey, setPlanKey] = useState("");
  const [planName, setPlanName] = useState("");
  const [planActive, setPlanActive] = useState(true);
  const [planReason, setPlanReason] = useState("");

  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedFeatureId, setSelectedFeatureId] = useState("");
  const [featureValue, setFeatureValue] = useState("true");
  const [featureReason, setFeatureReason] = useState("");

  const [priceInterval, setPriceInterval] = useState<"monthly" | "yearly">("monthly");
  const [priceId, setPriceId] = useState("");
  const [priceReason, setPriceReason] = useState("");

  const [flagKey, setFlagKey] = useState("");
  const [flagEnabled, setFlagEnabled] = useState(true);
  const [flagDescription, setFlagDescription] = useState("");
  const [flagReason, setFlagReason] = useState("");

  const [noticeSeverity, setNoticeSeverity] = useState<"info" | "warning" | "critical">("info");
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [noticeReason, setNoticeReason] = useState("");

  const [version, setVersion] = useState("");
  const [minimumVersion, setMinimumVersion] = useState("");
  const [versionBlocked, setVersionBlocked] = useState(false);
  const [versionReason, setVersionReason] = useState("");

  const load = () => {
    setLoading(true);
    adminApi.catalog()
      .then((data) => {
        setCatalog(data);
        if (!selectedPlanId && data.plans[0]) setSelectedPlanId(data.plans[0].id);
        if (!selectedFeatureId && data.features[0]) setSelectedFeatureId(data.features[0].id);
      })
      .catch((thrown) => setError(describeApiError(thrown)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setError(""); setNotice("");
    try {
      await action();
      setNotice(successMessage);
      load();
    } catch (thrown) {
      setError(describeApiError(thrown));
    }
  };

  return (
    <section className="adminSection">
      <header className="adminSectionHead">
        <h2>Planos, features e preços</h2>
        <p>Fonte única de verdade consumida pela extensão, pela landing page e pelo checkout.</p>
      </header>
      {error ? <p className="adminError">{error}</p> : null}
      {notice ? <p className="adminNotice">{notice}</p> : null}

      <div className="adminGrid2">
        <div className="adminPanel">
          <h3>Planos</h3>
          <table className="adminTable">
            <thead><tr><th>Key</th><th>Nome</th><th>Ativo</th></tr></thead>
            <tbody>
              {catalog.plans.map((plan) => (
                <tr key={plan.id}>
                  <td className="adminMonoCell">{plan.key}</td>
                  <td>{plan.name}</td>
                  <td>{plan.is_active ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="adminInlineForm"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => adminApi.upsertPlan({ key: planKey, name: planName, isActive: planActive, reason: planReason }), "Plano salvo.");
            }}
          >
            <input placeholder="key (ex.: scale)" value={planKey} onChange={(event) => setPlanKey(event.target.value)} required />
            <input placeholder="Nome de exibição" value={planName} onChange={(event) => setPlanName(event.target.value)} required />
            <label className="adminCheckboxLabel"><input type="checkbox" checked={planActive} onChange={(event) => setPlanActive(event.target.checked)} /> Ativo</label>
            <input placeholder="Motivo (auditoria)" value={planReason} onChange={(event) => setPlanReason(event.target.value)} required minLength={3} />
            <button type="submit" className="adminButton adminButton-primary">Criar / atualizar plano</button>
          </form>
        </div>

        <div className="adminPanel">
          <h3>Valor de feature por plano</h3>
          <table className="adminTable">
            <thead><tr><th>Plano</th><th>Feature</th><th>Valor</th></tr></thead>
            <tbody>
              {catalog.planFeatures.map((entry) => {
                const plan = catalog.plans.find((item) => item.id === entry.plan_id);
                const feature = catalog.features.find((item) => item.id === entry.feature_id);
                return (
                  <tr key={`${entry.plan_id}:${entry.feature_id}`}>
                    <td>{plan?.key ?? entry.plan_id}</td>
                    <td className="adminMonoCell">{feature?.key ?? entry.feature_id}</td>
                    <td className="adminMonoCell">{JSON.stringify(entry.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <form
            className="adminInlineForm"
            onSubmit={(event) => {
              event.preventDefault();
              let parsedValue: unknown = featureValue;
              try { parsedValue = JSON.parse(featureValue); } catch { /* keep as raw string */ }
              void run(() => adminApi.upsertFeatureValue({ planId: selectedPlanId, featureId: selectedFeatureId, value: parsedValue, reason: featureReason }), "Valor de feature atualizado.");
            }}
          >
            <select value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>
              {catalog.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.key}</option>)}
            </select>
            <select value={selectedFeatureId} onChange={(event) => setSelectedFeatureId(event.target.value)}>
              {catalog.features.map((feature) => <option key={feature.id} value={feature.id}>{feature.key}</option>)}
            </select>
            <input placeholder="Valor (true, 10, &quot;texto&quot;)" value={featureValue} onChange={(event) => setFeatureValue(event.target.value)} required />
            <input placeholder="Motivo" value={featureReason} onChange={(event) => setFeatureReason(event.target.value)} required minLength={3} />
            <button type="submit" className="adminButton adminButton-primary">Salvar valor</button>
          </form>
        </div>

        <div className="adminPanel">
          <h3>Preços Stripe {isFounder ? "" : "(somente founder)"}</h3>
          <table className="adminTable">
            <thead><tr><th>Plano</th><th>Intervalo</th><th>Price ID</th></tr></thead>
            <tbody>
              {catalog.prices.map((price) => {
                const plan = catalog.plans.find((item) => item.id === price.plan_id);
                return (
                  <tr key={price.id}>
                    <td>{plan?.key ?? price.plan_id}</td>
                    <td>{price.billing_interval}</td>
                    <td className="adminMonoCell">{price.stripe_price_id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {isFounder ? (
            <form
              className="adminInlineForm"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => adminApi.upsertPrice({ planId: selectedPlanId, billingInterval: priceInterval, stripePriceId: priceId, reason: priceReason }), "Preço atualizado.");
              }}
            >
              <select value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>
                {catalog.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.key}</option>)}
              </select>
              <select value={priceInterval} onChange={(event) => setPriceInterval(event.target.value as "monthly" | "yearly")}>
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
              <input placeholder="price_XXXX (criado no Stripe Dashboard)" value={priceId} onChange={(event) => setPriceId(event.target.value)} required />
              <input placeholder="Motivo" value={priceReason} onChange={(event) => setPriceReason(event.target.value)} required minLength={3} />
              <button type="submit" className="adminButton adminButton-primary">Salvar preço</button>
            </form>
          ) : (
            <p className="adminMuted">Crie o Price no Stripe Dashboard primeiro; só o founder pode vincular o ID aqui.</p>
          )}
        </div>

        <div className="adminPanel">
          <h3>Feature flags globais</h3>
          <table className="adminTable">
            <thead><tr><th>Chave</th><th>Ativa</th><th>Descrição</th></tr></thead>
            <tbody>
              {catalog.flags.map((flag) => (
                <tr key={flag.key}>
                  <td className="adminMonoCell">{flag.key}</td>
                  <td>{flag.enabled ? "Sim" : "Não"}</td>
                  <td>{flag.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="adminInlineForm"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => adminApi.upsertFeatureFlag({ key: flagKey, enabled: flagEnabled, description: flagDescription, reason: flagReason }), "Feature flag atualizada.");
            }}
          >
            <input placeholder="chave (ex.: recording.enabled)" value={flagKey} onChange={(event) => setFlagKey(event.target.value)} required />
            <label className="adminCheckboxLabel"><input type="checkbox" checked={flagEnabled} onChange={(event) => setFlagEnabled(event.target.checked)} /> Ativa</label>
            <input placeholder="Descrição" value={flagDescription} onChange={(event) => setFlagDescription(event.target.value)} />
            <input placeholder="Motivo" value={flagReason} onChange={(event) => setFlagReason(event.target.value)} required minLength={3} />
            <button type="submit" className="adminButton adminButton-primary">Salvar flag</button>
          </form>
        </div>

        <div className="adminPanel">
          <h3>Avisos do sistema</h3>
          <table className="adminTable">
            <thead><tr><th>Severidade</th><th>Título</th><th>Ativo</th></tr></thead>
            <tbody>
              {catalog.notices.map((item) => (
                <tr key={item.id}><td>{item.severity}</td><td>{item.title}</td><td>{item.is_active ? "Sim" : "Não"}</td></tr>
              ))}
            </tbody>
          </table>
          <form
            className="adminInlineForm"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => adminApi.upsertNotice({ severity: noticeSeverity, title: noticeTitle, message: noticeMessage, isActive: true, reason: noticeReason }), "Aviso publicado.");
            }}
          >
            <select value={noticeSeverity} onChange={(event) => setNoticeSeverity(event.target.value as typeof noticeSeverity)}>
              <option value="info">Info</option>
              <option value="warning">Aviso</option>
              <option value="critical">Crítico</option>
            </select>
            <input placeholder="Título" value={noticeTitle} onChange={(event) => setNoticeTitle(event.target.value)} required />
            <input placeholder="Mensagem" value={noticeMessage} onChange={(event) => setNoticeMessage(event.target.value)} required />
            <input placeholder="Motivo" value={noticeReason} onChange={(event) => setNoticeReason(event.target.value)} required minLength={3} />
            <button type="submit" className="adminButton adminButton-primary">Publicar aviso</button>
          </form>
        </div>

        <div className="adminPanel">
          <h3>Versões do app</h3>
          <table className="adminTable">
            <thead><tr><th>Versão</th><th>Mínima suportada</th><th>Bloqueada</th></tr></thead>
            <tbody>
              {catalog.versions.map((item) => (
                <tr key={item.id}><td>{item.version}</td><td>{item.minimum_supported_version}</td><td>{item.is_blocked ? "Sim" : "Não"}</td></tr>
              ))}
            </tbody>
          </table>
          <form
            className="adminInlineForm"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => adminApi.upsertVersion({ version, minimumSupportedVersion: minimumVersion, isBlocked: versionBlocked, reason: versionReason }), "Versão registrada.");
            }}
          >
            <input placeholder="0.1.16" value={version} onChange={(event) => setVersion(event.target.value)} required />
            <input placeholder="Versão mínima suportada" value={minimumVersion} onChange={(event) => setMinimumVersion(event.target.value)} required />
            <label className="adminCheckboxLabel"><input type="checkbox" checked={versionBlocked} onChange={(event) => setVersionBlocked(event.target.checked)} /> Bloqueada</label>
            <input placeholder="Motivo" value={versionReason} onChange={(event) => setVersionReason(event.target.value)} required minLength={3} />
            <button type="submit" className="adminButton adminButton-primary">Registrar versão</button>
          </form>
        </div>
      </div>
      {loading ? <p className="adminMuted">Carregando catálogo…</p> : null}
    </section>
  );
}
