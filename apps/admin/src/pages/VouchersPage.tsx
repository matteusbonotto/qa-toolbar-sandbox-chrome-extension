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
import type { Voucher, VoucherCampaign, VoucherKind } from "../lib/types";
import { useAsyncData } from "../lib/useAsyncData";

const KIND_LABEL: Record<VoucherKind, string> = {
  discount: "Desconto (Stripe)",
  days: "Dias extras",
  lifetime: "Acesso vitalício",
};

const VOUCHER_STATUS_LABEL: Record<Voucher["status"], string> = {
  available: "Disponível",
  used: "Usado",
  disabled: "Desativado",
};

type DiscountMode = "percent" | "amount";

function discountValueFrom(kind: VoucherKind, mode: DiscountMode, raw: string): { percentOff: number | null; amountOffMinor: number | null } {
  if (kind !== "discount" || !raw.trim()) return { percentOff: null, amountOffMinor: null };
  const numeric = Number(raw.replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return { percentOff: null, amountOffMinor: null };
  return mode === "percent"
    ? { percentOff: Math.round(numeric), amountOffMinor: null }
    : { percentOff: null, amountOffMinor: Math.round(numeric * 100) };
}

function valueColumn(row: { kind: VoucherKind; grant_days: number | null; discount_percent_off: number | null; discount_amount_off_minor: number | null }): string {
  if (row.kind === "lifetime") return "Vitalício";
  if (row.kind === "discount") {
    if (row.discount_percent_off) return `Desconto ${row.discount_percent_off}%`;
    if (row.discount_amount_off_minor) return `R$ ${(row.discount_amount_off_minor / 100).toFixed(2).replace(".", ",")} off`;
    return "Desconto";
  }
  return row.grant_days != null ? `${row.grant_days} dias` : "—";
}

function campaignStatusBadge(campaign: VoucherCampaign): { label: string; className: string } {
  if (!campaign.enabled) return { label: "desativada", className: "disabled" };
  if (campaign.expires_at && new Date(campaign.expires_at).getTime() < Date.now()) return { label: "expirada", className: "disabled" };
  if (campaign.maximum_redemptions != null && campaign.redemption_count >= campaign.maximum_redemptions) {
    return { label: "esgotada", className: "used" };
  }
  return { label: "disponível", className: "available" };
}

export function VouchersPage() {
  const plans = useAsyncData(listPlans);
  const vouchers = useAsyncData(listVouchers);
  const campaigns = useAsyncData(listVoucherCampaigns);

  const [voucherCode, setVoucherCode] = useState("");
  const [voucherLabel, setVoucherLabel] = useState("");
  const [voucherKind, setVoucherKind] = useState<VoucherKind>("days");
  const [voucherPlanId, setVoucherPlanId] = useState("");
  const [voucherGrantDays, setVoucherGrantDays] = useState("");
  const [voucherDiscountMode, setVoucherDiscountMode] = useState<DiscountMode>("percent");
  const [voucherDiscountValue, setVoucherDiscountValue] = useState("");
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherFormError, setVoucherFormError] = useState<string | null>(null);
  const [editingVoucherId, setEditingVoucherId] = useState<string | null>(null);

  const [campaignCode, setCampaignCode] = useState("");
  const [campaignLabel, setCampaignLabel] = useState("");
  const [campaignKind, setCampaignKind] = useState<VoucherKind>("days");
  const [campaignPlanId, setCampaignPlanId] = useState("");
  const [campaignGrantDays, setCampaignGrantDays] = useState("30");
  const [campaignDiscountMode, setCampaignDiscountMode] = useState<DiscountMode>("percent");
  const [campaignDiscountValue, setCampaignDiscountValue] = useState("");
  const [campaignMaxRedemptions, setCampaignMaxRedemptions] = useState("");
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [campaignFormError, setCampaignFormError] = useState<string | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  function resetVoucherForm() {
    setEditingVoucherId(null);
    setVoucherCode("");
    setVoucherLabel("");
    setVoucherKind("days");
    setVoucherPlanId("");
    setVoucherGrantDays("");
    setVoucherDiscountMode("percent");
    setVoucherDiscountValue("");
  }

  function resetCampaignForm() {
    setEditingCampaignId(null);
    setCampaignCode("");
    setCampaignLabel("");
    setCampaignKind("days");
    setCampaignPlanId("");
    setCampaignGrantDays("30");
    setCampaignDiscountMode("percent");
    setCampaignDiscountValue("");
    setCampaignMaxRedemptions("");
  }

  async function handleCreateVoucher(event: React.FormEvent) {
    event.preventDefault();
    const needsPlan = voucherKind !== "discount";
    if ((!editingVoucherId && !voucherCode.trim()) || !voucherLabel.trim() || (needsPlan && !voucherPlanId)) return;
    setVoucherBusy(true);
    setVoucherFormError(null);
    try {
      const { percentOff, amountOffMinor } = discountValueFrom(voucherKind, voucherDiscountMode, voucherDiscountValue);
      const input = {
        label: voucherLabel,
        kind: voucherKind,
        planId: voucherKind === "discount" ? (voucherPlanId || null) : voucherPlanId,
        grantDays: voucherKind === "days" ? (voucherGrantDays ? Number(voucherGrantDays) : null) : null,
        discountPercentOff: percentOff,
        discountAmountOffMinor: amountOffMinor,
        expiresAt: null,
      };
      if (editingVoucherId) await updateVoucher(editingVoucherId, input);
      else await createVoucher({ code: voucherCode, ...input });
      resetVoucherForm();
      vouchers.reload();
    } catch (err) {
      setVoucherFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoucherBusy(false);
    }
  }

  async function handleCreateCampaign(event: React.FormEvent) {
    event.preventDefault();
    const needsPlan = campaignKind !== "discount";
    if ((!editingCampaignId && !campaignCode.trim()) || !campaignLabel.trim() || (needsPlan && !campaignPlanId)) return;
    setCampaignBusy(true);
    setCampaignFormError(null);
    try {
      const { percentOff, amountOffMinor } = discountValueFrom(campaignKind, campaignDiscountMode, campaignDiscountValue);
      const input = {
        label: campaignLabel,
        kind: campaignKind,
        planId: campaignKind === "discount" ? (campaignPlanId || null) : campaignPlanId,
        grantDays: campaignKind === "lifetime" ? null : (Number(campaignGrantDays) || 30),
        discountPercentOff: percentOff,
        discountAmountOffMinor: amountOffMinor,
        maximumRedemptions: campaignMaxRedemptions ? Number(campaignMaxRedemptions) : null,
        expiresAt: null,
      };
      if (editingCampaignId) await updateVoucherCampaign(editingCampaignId, input);
      else await createVoucherCampaign({ code: campaignCode, ...input });
      resetCampaignForm();
      campaigns.reload();
    } catch (err) {
      setCampaignFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setCampaignBusy(false);
    }
  }

  function startEditVoucher(voucher: Voucher) {
    setEditingVoucherId(voucher.id);
    setVoucherCode("");
    setVoucherLabel(voucher.label);
    setVoucherKind(voucher.kind);
    setVoucherPlanId(voucher.plan_id ?? "");
    setVoucherGrantDays(voucher.grant_days ? String(voucher.grant_days) : "");
    setVoucherDiscountMode(voucher.discount_amount_off_minor ? "amount" : "percent");
    setVoucherDiscountValue(
      voucher.discount_percent_off ? String(voucher.discount_percent_off)
        : voucher.discount_amount_off_minor ? (voucher.discount_amount_off_minor / 100).toFixed(2) : "",
    );
  }

  function startEditCampaign(campaign: VoucherCampaign) {
    setEditingCampaignId(campaign.id);
    setCampaignCode("");
    setCampaignLabel(campaign.label);
    setCampaignKind(campaign.kind);
    setCampaignPlanId(campaign.plan_id ?? "");
    setCampaignGrantDays(campaign.grant_days ? String(campaign.grant_days) : "30");
    setCampaignDiscountMode(campaign.discount_amount_off_minor ? "amount" : "percent");
    setCampaignDiscountValue(
      campaign.discount_percent_off ? String(campaign.discount_percent_off)
        : campaign.discount_amount_off_minor ? (campaign.discount_amount_off_minor / 100).toFixed(2) : "",
    );
    setCampaignMaxRedemptions(campaign.maximum_redemptions ? String(campaign.maximum_redemptions) : "");
  }

  return (
    <div>
      <header className="qa-page-head">
        <h1>Vouchers</h1>
        <p>
          Vouchers de uso único (código &rarr; um resgate) e campanhas de múltiplo resgate. Cada
          código tem um tipo explícito: <strong>desconto</strong> (leva ao checkout do Stripe com o
          valor já reduzido), <strong>dias extras</strong> (concede acesso por N dias direto, sem
          Stripe) ou <strong>vitalício</strong> (concede acesso permanente direto, sem Stripe).
        </p>
      </header>

      <div className="qa-card">
        <h2>Voucher de uso único</h2>
        {voucherFormError ? <div className="qa-error">{voucherFormError}</div> : null}
        <form className="qa-form-row" onSubmit={handleCreateVoucher}>
          <input disabled={Boolean(editingVoucherId)} placeholder={editingVoucherId ? "Código preservado (hash)" : "Código (ex.: BEMVINDO30)"} value={voucherCode} onChange={(e) => setVoucherCode(e.target.value)} />
          <input placeholder="Rótulo" value={voucherLabel} onChange={(e) => setVoucherLabel(e.target.value)} />
          <select value={voucherKind} onChange={(e) => setVoucherKind(e.target.value as VoucherKind)}>
            <option value="days">{KIND_LABEL.days}</option>
            <option value="lifetime">{KIND_LABEL.lifetime}</option>
            <option value="discount">{KIND_LABEL.discount}</option>
          </select>
          <select value={voucherPlanId} onChange={(e) => setVoucherPlanId(e.target.value)}>
            <option value="">{voucherKind === "discount" ? "Qualquer plano (o cliente escolhe no checkout)" : "Plano…"}</option>
            {(plans.data ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          {voucherKind === "days" ? (
            <input placeholder="Dias concedidos" value={voucherGrantDays} onChange={(e) => setVoucherGrantDays(e.target.value)} />
          ) : null}
          {voucherKind === "lifetime" ? (
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Acesso permanente, sem data de expiração.</span>
          ) : null}
          {voucherKind === "discount" ? (
            <>
              <select value={voucherDiscountMode} onChange={(e) => setVoucherDiscountMode(e.target.value as DiscountMode)}>
                <option value="percent">Percentual (%)</option>
                <option value="amount">Valor fixo (R$)</option>
              </select>
              <input
                placeholder={voucherDiscountMode === "percent" ? "Ex.: 20" : "Ex.: 20,00"}
                value={voucherDiscountValue}
                onChange={(e) => setVoucherDiscountValue(e.target.value)}
              />
            </>
          ) : null}
          <button type="submit" className="qa-btn primary" disabled={voucherBusy}>
            {editingVoucherId ? "Salvar edição" : "+ Criar"}
          </button>
          {editingVoucherId ? <button type="button" className="qa-btn" onClick={resetVoucherForm}>Cancelar</button> : null}
        </form>

        {vouchers.error ? <div className="qa-error">{vouchers.error}</div> : null}
        {!vouchers.loading && !(vouchers.data ?? []).length ? <div className="qa-empty">Nenhum voucher ainda.</div> : null}
        {(vouchers.data ?? []).length ? (
          <table className="qa-table">
            <thead>
              <tr>
                <th>Rótulo</th>
                <th>Status</th>
                <th>Tipo / valor</th>
                <th>Criado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(vouchers.data ?? []).map((voucher) => (
                <tr key={voucher.id}>
                  <td>{voucher.label}</td>
                  <td>
                    <span className={`qa-badge ${voucher.status}`}>{VOUCHER_STATUS_LABEL[voucher.status]}</span>
                  </td>
                  <td>{valueColumn(voucher)}</td>
                  <td>{new Date(voucher.created_at).toLocaleDateString("pt-BR")}</td>
                  <td>
                    {voucher.status !== "used" ? <button type="button" className="qa-btn" onClick={() => startEditVoucher(voucher)}>Editar</button> : null}{" "}
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
        <h2>Campanha de múltiplo resgate</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: -6 }}>
          Ex.: código <code>ACESSOBETA26</code>, tipo dias extras, 90 dias, limite de resgates 5:
          as primeiras 5 pessoas que aplicarem o código ganham 90 dias de acesso; a 6ª tentativa
          é recusada e a campanha aparece como "esgotada" abaixo.
        </p>
        {campaignFormError ? <div className="qa-error">{campaignFormError}</div> : null}
        <form className="qa-form-row" onSubmit={handleCreateCampaign}>
          <input disabled={Boolean(editingCampaignId)} placeholder={editingCampaignId ? "Código preservado (hash)" : "Código (ex.: LANCAMENTO20)"} value={campaignCode} onChange={(e) => setCampaignCode(e.target.value)} />
          <input placeholder="Rótulo" value={campaignLabel} onChange={(e) => setCampaignLabel(e.target.value)} />
          <select value={campaignKind} onChange={(e) => setCampaignKind(e.target.value as VoucherKind)}>
            <option value="days">{KIND_LABEL.days}</option>
            <option value="lifetime">{KIND_LABEL.lifetime}</option>
            <option value="discount">{KIND_LABEL.discount}</option>
          </select>
          <select value={campaignPlanId} onChange={(e) => setCampaignPlanId(e.target.value)}>
            <option value="">{campaignKind === "discount" ? "Qualquer plano (o cliente escolhe no checkout)" : "Plano…"}</option>
            {(plans.data ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          {campaignKind === "days" ? (
            <input placeholder="Dias concedidos" value={campaignGrantDays} onChange={(e) => setCampaignGrantDays(e.target.value)} />
          ) : null}
          {campaignKind === "lifetime" ? (
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Acesso permanente, sem data de expiração.</span>
          ) : null}
          {campaignKind === "discount" ? (
            <>
              <select value={campaignDiscountMode} onChange={(e) => setCampaignDiscountMode(e.target.value as DiscountMode)}>
                <option value="percent">Percentual (%)</option>
                <option value="amount">Valor fixo (R$)</option>
              </select>
              <input
                placeholder={campaignDiscountMode === "percent" ? "Ex.: 20" : "Ex.: 20,00"}
                value={campaignDiscountValue}
                onChange={(e) => setCampaignDiscountValue(e.target.value)}
              />
            </>
          ) : null}
          <input placeholder="Limite de resgates (vazio = ilimitado)" value={campaignMaxRedemptions} onChange={(e) => setCampaignMaxRedemptions(e.target.value)} />
          <button type="submit" className="qa-btn primary" disabled={campaignBusy}>
            {editingCampaignId ? "Salvar edição" : "+ Criar"}
          </button>
          {editingCampaignId ? <button type="button" className="qa-btn" onClick={resetCampaignForm}>Cancelar</button> : null}
        </form>

        {campaigns.error ? <div className="qa-error">{campaigns.error}</div> : null}
        {!campaigns.loading && !(campaigns.data ?? []).length ? <div className="qa-empty">Nenhuma campanha ainda.</div> : null}
        {(campaigns.data ?? []).length ? (
          <table className="qa-table">
            <thead>
              <tr>
                <th>Rótulo</th>
                <th>Status</th>
                <th>Tipo / valor</th>
                <th>Resgates</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(campaigns.data ?? []).map((campaign) => {
                const badge = campaignStatusBadge(campaign);
                return (
                  <tr key={campaign.id}>
                    <td>{campaign.label}</td>
                    <td>
                      <span className={`qa-badge ${badge.className}`}>{badge.label}</span>
                    </td>
                    <td>{valueColumn(campaign)}</td>
                    <td>
                      {campaign.redemption_count}
                      {campaign.maximum_redemptions ? ` / ${campaign.maximum_redemptions}` : ""}
                    </td>
                    <td>
                      <button type="button" className="qa-btn" onClick={() => startEditCampaign(campaign)}>Editar</button>{" "}
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
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
