import { useState } from "react";
import {
  createVoucher,
  createVoucherCampaign,
  deleteVoucher,
  deleteVoucherCampaign,
  listPlans,
  listVouchers,
  listVoucherCampaigns,
  setVoucherCampaignEnabled,
  setVoucherStatus,
  updateVoucher,
  updateVoucherCampaign,
} from "../lib/api";
import { useAsyncData } from "../lib/useAsyncData";

export function VouchersPage() {
  const plans = useAsyncData(listPlans);
  const vouchers = useAsyncData(listVouchers);
  const campaigns = useAsyncData(listVoucherCampaigns);

  const [voucherCode, setVoucherCode] = useState("");
  const [voucherLabel, setVoucherLabel] = useState("");
  const [voucherPlanId, setVoucherPlanId] = useState("");
  const [voucherGrantDays, setVoucherGrantDays] = useState("");
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherFormError, setVoucherFormError] = useState<string | null>(null);
  const [editingVoucherId, setEditingVoucherId] = useState<string | null>(null);

  const [campaignCode, setCampaignCode] = useState("");
  const [campaignLabel, setCampaignLabel] = useState("");
  const [campaignPlanId, setCampaignPlanId] = useState("");
  const [campaignGrantDays, setCampaignGrantDays] = useState("30");
  const [campaignMaxRedemptions, setCampaignMaxRedemptions] = useState("");
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [campaignFormError, setCampaignFormError] = useState<string | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  async function handleCreateVoucher(event: React.FormEvent) {
    event.preventDefault();
    if ((!editingVoucherId && !voucherCode.trim()) || !voucherLabel.trim() || !voucherPlanId) return;
    setVoucherBusy(true);
    setVoucherFormError(null);
    try {
      const input = { label: voucherLabel, planId: voucherPlanId, grantDays: voucherGrantDays ? Number(voucherGrantDays) : null, expiresAt: null };
      if (editingVoucherId) await updateVoucher(editingVoucherId, input);
      else await createVoucher({ code: voucherCode, ...input });
      setVoucherCode("");
      setVoucherLabel("");
      setVoucherGrantDays("");
      setEditingVoucherId(null);
      vouchers.reload();
    } catch (err) {
      setVoucherFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoucherBusy(false);
    }
  }

  async function handleCreateCampaign(event: React.FormEvent) {
    event.preventDefault();
    if ((!editingCampaignId && !campaignCode.trim()) || !campaignLabel.trim() || !campaignPlanId) return;
    setCampaignBusy(true);
    setCampaignFormError(null);
    try {
      const input = { label: campaignLabel, planId: campaignPlanId, grantDays: Number(campaignGrantDays) || 30, maximumRedemptions: campaignMaxRedemptions ? Number(campaignMaxRedemptions) : null, expiresAt: null };
      if (editingCampaignId) await updateVoucherCampaign(editingCampaignId, input);
      else await createVoucherCampaign({ code: campaignCode, ...input });
      setCampaignCode("");
      setCampaignLabel("");
      setCampaignMaxRedemptions("");
      setEditingCampaignId(null);
      campaigns.reload();
    } catch (err) {
      setCampaignFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setCampaignBusy(false);
    }
  }

  return (
    <div>
      <header className="qa-page-head">
        <h1>Vouchers</h1>
        <p>
          Vouchers de uso único (código &rarr; um resgate) e campanhas de múltiplo resgate
          (desconto, dias extras, acesso vitalício — controlado por `grant_days` alto/nulo e
          `maximum_redemptions`).
        </p>
      </header>

      <div className="qa-card">
        <h2>Voucher de uso único</h2>
        {voucherFormError ? <div className="qa-error">{voucherFormError}</div> : null}
        <form className="qa-form-row" onSubmit={handleCreateVoucher}>
          <input disabled={Boolean(editingVoucherId)} placeholder={editingVoucherId ? "Código preservado (hash)" : "Código (ex.: BEMVINDO30)"} value={voucherCode} onChange={(e) => setVoucherCode(e.target.value)} />
          <input placeholder="Rótulo" value={voucherLabel} onChange={(e) => setVoucherLabel(e.target.value)} />
          <select value={voucherPlanId} onChange={(e) => setVoucherPlanId(e.target.value)}>
            <option value="">Plano…</option>
            {(plans.data ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <input placeholder="Dias concedidos (opcional)" value={voucherGrantDays} onChange={(e) => setVoucherGrantDays(e.target.value)} />
          <button type="submit" className="qa-btn primary" disabled={voucherBusy}>
            {editingVoucherId ? "Salvar edição" : "+ Criar"}
          </button>
          {editingVoucherId ? <button type="button" className="qa-btn" onClick={() => { setEditingVoucherId(null); setVoucherCode(""); setVoucherLabel(""); setVoucherPlanId(""); setVoucherGrantDays(""); }}>Cancelar</button> : null}
        </form>

        {vouchers.error ? <div className="qa-error">{vouchers.error}</div> : null}
        {!vouchers.loading && !(vouchers.data ?? []).length ? <div className="qa-empty">Nenhum voucher ainda.</div> : null}
        {(vouchers.data ?? []).length ? (
          <table className="qa-table">
            <thead>
              <tr>
                <th>Rótulo</th>
                <th>Status</th>
                <th>Dias</th>
                <th>Criado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(vouchers.data ?? []).map((voucher) => (
                <tr key={voucher.id}>
                  <td>{voucher.label}</td>
                  <td>
                    <span className={`qa-badge ${voucher.status}`}>{voucher.status}</span>
                  </td>
                  <td>{voucher.grant_days ?? "—"}</td>
                  <td>{new Date(voucher.created_at).toLocaleDateString("pt-BR")}</td>
                  <td>
                    {voucher.status !== "used" ? <button type="button" className="qa-btn" onClick={() => { setEditingVoucherId(voucher.id); setVoucherCode(""); setVoucherLabel(voucher.label); setVoucherPlanId(voucher.plan_id); setVoucherGrantDays(voucher.grant_days ? String(voucher.grant_days) : ""); }}>Editar</button> : null}{" "}
                    {voucher.status !== "used" ? (
                      <button
                        type="button"
                        className="qa-btn danger"
                        onClick={() => setVoucherStatus(voucher.id, voucher.status === "disabled" ? "available" : "disabled").then(vouchers.reload)}
                      >
                        {voucher.status === "disabled" ? "Reativar" : "Desativar"}
                      </button>
                    ) : null}
                    {voucher.status !== "used" ? <button type="button" className="qa-btn danger" style={{ marginLeft: 6 }} onClick={() => { if (window.confirm("Excluir este voucher? O código não poderá ser recuperado.")) void deleteVoucher(voucher.id).then(vouchers.reload); }}>Excluir</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <div className="qa-card">
        <h2>Campanha de múltiplo resgate (desconto / dias extras / vitalício)</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: -6 }}>
          Dica: para "vitalício", use um valor alto de dias (ex.: 36500 ≈ 100 anos) — o schema
          exige `grant_days` entre 1 e 3650 por linha em `vouchers`, mas campanhas aceitam o
          mesmo intervalo; para acesso permanente de verdade use um <code>entitlement_grants</code>{" "}
          com <code>expires_at = null</code> na aba Acessos.
        </p>
        {campaignFormError ? <div className="qa-error">{campaignFormError}</div> : null}
        <form className="qa-form-row" onSubmit={handleCreateCampaign}>
          <input disabled={Boolean(editingCampaignId)} placeholder={editingCampaignId ? "Código preservado (hash)" : "Código (ex.: LANCAMENTO20)"} value={campaignCode} onChange={(e) => setCampaignCode(e.target.value)} />
          <input placeholder="Rótulo" value={campaignLabel} onChange={(e) => setCampaignLabel(e.target.value)} />
          <select value={campaignPlanId} onChange={(e) => setCampaignPlanId(e.target.value)}>
            <option value="">Plano…</option>
            {(plans.data ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <input placeholder="Dias concedidos" value={campaignGrantDays} onChange={(e) => setCampaignGrantDays(e.target.value)} />
          <input placeholder="Limite de resgates (vazio = ilimitado)" value={campaignMaxRedemptions} onChange={(e) => setCampaignMaxRedemptions(e.target.value)} />
          <button type="submit" className="qa-btn primary" disabled={campaignBusy}>
            {editingCampaignId ? "Salvar edição" : "+ Criar"}
          </button>
          {editingCampaignId ? <button type="button" className="qa-btn" onClick={() => { setEditingCampaignId(null); setCampaignCode(""); setCampaignLabel(""); setCampaignPlanId(""); setCampaignGrantDays("30"); setCampaignMaxRedemptions(""); }}>Cancelar</button> : null}
        </form>

        {campaigns.error ? <div className="qa-error">{campaigns.error}</div> : null}
        {!campaigns.loading && !(campaigns.data ?? []).length ? <div className="qa-empty">Nenhuma campanha ainda.</div> : null}
        {(campaigns.data ?? []).length ? (
          <table className="qa-table">
            <thead>
              <tr>
                <th>Rótulo</th>
                <th>Status</th>
                <th>Dias</th>
                <th>Resgates</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(campaigns.data ?? []).map((campaign) => (
                <tr key={campaign.id}>
                  <td>{campaign.label}</td>
                  <td>
                    <span className={`qa-badge ${campaign.enabled ? "available" : "disabled"}`}>{campaign.enabled ? "ativa" : "desativada"}</span>
                  </td>
                  <td>{campaign.grant_days}</td>
                  <td>
                    {campaign.redemption_count}
                    {campaign.maximum_redemptions ? ` / ${campaign.maximum_redemptions}` : ""}
                  </td>
                  <td>
                    <button type="button" className="qa-btn" onClick={() => { setEditingCampaignId(campaign.id); setCampaignCode(""); setCampaignLabel(campaign.label); setCampaignPlanId(campaign.plan_id); setCampaignGrantDays(String(campaign.grant_days)); setCampaignMaxRedemptions(campaign.maximum_redemptions ? String(campaign.maximum_redemptions) : ""); }}>Editar</button>{" "}
                    <button
                      type="button"
                      className="qa-btn danger"
                      onClick={() => setVoucherCampaignEnabled(campaign.id, !campaign.enabled).then(campaigns.reload)}
                    >
                      {campaign.enabled ? "Desativar" : "Reativar"}
                    </button>
                    {campaign.redemption_count === 0 ? <button type="button" className="qa-btn danger" style={{ marginLeft: 6 }} onClick={() => { if (window.confirm("Excluir esta campanha sem resgates?")) void deleteVoucherCampaign(campaign.id).then(campaigns.reload); }}>Excluir</button> : null}
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
