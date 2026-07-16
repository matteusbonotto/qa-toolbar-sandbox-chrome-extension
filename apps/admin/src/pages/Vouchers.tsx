import { useEffect, useState } from "react";
import { adminApi, type Plan, type VouchersSnapshot } from "../services/adminApi";
import { describeApiError } from "../App";

export function Vouchers() {
  const [snapshot, setSnapshot] = useState<VouchersSnapshot>({ vouchers: [], campaigns: [] });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [planId, setPlanId] = useState("");
  const [grantDays, setGrantDays] = useState("");
  const [reason, setReason] = useState("");

  const [campaignCode, setCampaignCode] = useState("");
  const [campaignLabel, setCampaignLabel] = useState("");
  const [campaignPlanId, setCampaignPlanId] = useState("");
  const [campaignGrantDays, setCampaignGrantDays] = useState("30");
  const [campaignMax, setCampaignMax] = useState("");
  const [campaignReason, setCampaignReason] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([adminApi.vouchers(), adminApi.catalog()])
      .then(([voucherData, catalog]) => {
        setSnapshot(voucherData);
        setPlans(catalog.plans);
        if (!planId && catalog.plans[0]) setPlanId(catalog.plans[0].id);
        if (!campaignPlanId && catalog.plans[0]) setCampaignPlanId(catalog.plans[0].id);
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
        <h2>Vouchers e campanhas</h2>
        <p>Vouchers de uso único e campanhas compartilhadas (multi-resgate) são distintos de promotion codes do Stripe.</p>
      </header>
      {error ? <p className="adminError">{error}</p> : null}
      {notice ? <p className="adminNotice">{notice}</p> : null}

      <div className="adminGrid2">
        <div className="adminPanel">
          <h3>Vouchers de uso único</h3>
          <table className="adminTable">
            <thead><tr><th>Label</th><th>Status</th><th>Validade (dias)</th><th>Ação</th></tr></thead>
            <tbody>
              {snapshot.vouchers.map((voucher) => (
                <tr key={voucher.id}>
                  <td>{voucher.label}</td>
                  <td>{voucher.status}</td>
                  <td>{voucher.grant_days ?? "Vitalício"}</td>
                  <td>
                    {voucher.status !== "used" ? (
                      <button
                        type="button"
                        className="adminButton adminButton-small"
                        onClick={() => void run(() => adminApi.setVoucherStatus({ voucherId: voucher.id, status: voucher.status === "disabled" ? "available" : "disabled", reason: "Alternado pelo painel admin" }), "Voucher atualizado.")}
                      >
                        {voucher.status === "disabled" ? "Reativar" : "Desativar"}
                      </button>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {!snapshot.vouchers.length && !loading ? <tr><td colSpan={4} className="adminEmptyCell">Nenhum voucher criado.</td></tr> : null}
            </tbody>
          </table>
          <form
            className="adminInlineForm"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => adminApi.createVoucher({ code, label, planId, grantDays: grantDays ? Number(grantDays) : null, reason }), "Voucher criado.");
              setCode(""); setLabel(""); setGrantDays(""); setReason("");
            }}
          >
            <input placeholder="Código (ex.: PARCEIRO2026)" value={code} onChange={(event) => setCode(event.target.value)} required minLength={4} />
            <input placeholder="Rótulo" value={label} onChange={(event) => setLabel(event.target.value)} required minLength={3} />
            <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.key}</option>)}
            </select>
            <input placeholder="Dias de acesso (vazio = vitalício)" value={grantDays} onChange={(event) => setGrantDays(event.target.value)} inputMode="numeric" />
            <input placeholder="Motivo" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} />
            <button type="submit" className="adminButton adminButton-primary">Criar voucher</button>
          </form>
        </div>

        <div className="adminPanel">
          <h3>Campanhas compartilhadas (multi-resgate)</h3>
          <table className="adminTable">
            <thead><tr><th>Label</th><th>Resgates</th><th>Ativa</th><th>Ação</th></tr></thead>
            <tbody>
              {snapshot.campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>{campaign.label}</td>
                  <td>{campaign.redemption_count}{campaign.maximum_redemptions ? ` / ${campaign.maximum_redemptions}` : " / ∞"}</td>
                  <td>{campaign.enabled ? "Sim" : "Não"}</td>
                  <td>
                    <button
                      type="button"
                      className="adminButton adminButton-small"
                      onClick={() => void run(() => adminApi.setCampaignEnabled({ campaignId: campaign.id, enabled: !campaign.enabled, reason: "Alternado pelo painel admin" }), "Campanha atualizada.")}
                    >
                      {campaign.enabled ? "Desativar" : "Ativar"}
                    </button>
                  </td>
                </tr>
              ))}
              {!snapshot.campaigns.length && !loading ? <tr><td colSpan={4} className="adminEmptyCell">Nenhuma campanha criada.</td></tr> : null}
            </tbody>
          </table>
          <form
            className="adminInlineForm"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => adminApi.createCampaign({
                code: campaignCode, label: campaignLabel, planId: campaignPlanId,
                grantDays: Number(campaignGrantDays), maximumRedemptions: campaignMax ? Number(campaignMax) : null,
                reason: campaignReason,
              }), "Campanha criada.");
              setCampaignCode(""); setCampaignLabel(""); setCampaignMax(""); setCampaignReason("");
            }}
          >
            <input placeholder="Código (ex.: 30DIAS)" value={campaignCode} onChange={(event) => setCampaignCode(event.target.value)} required minLength={4} />
            <input placeholder="Rótulo" value={campaignLabel} onChange={(event) => setCampaignLabel(event.target.value)} required minLength={3} />
            <select value={campaignPlanId} onChange={(event) => setCampaignPlanId(event.target.value)}>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.key}</option>)}
            </select>
            <input placeholder="Dias de acesso por resgate" value={campaignGrantDays} onChange={(event) => setCampaignGrantDays(event.target.value)} inputMode="numeric" required />
            <input placeholder="Máx. resgates (vazio = ilimitado)" value={campaignMax} onChange={(event) => setCampaignMax(event.target.value)} inputMode="numeric" />
            <input placeholder="Motivo" value={campaignReason} onChange={(event) => setCampaignReason(event.target.value)} required minLength={3} />
            <button type="submit" className="adminButton adminButton-primary">Criar campanha</button>
          </form>
        </div>
      </div>
    </section>
  );
}
