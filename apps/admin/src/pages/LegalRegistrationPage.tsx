import { useEffect, useState } from "react";
import { getLegalRegistration, updateLegalRegistration } from "../lib/api";
import type { LegalRegistration, LegalRegistrationStatus } from "../lib/types";

const STATUS_LABEL: Record<LegalRegistrationStatus, string> = {
  preparation: "Em preparação",
  payment_pending: "Em andamento (antes do protocolo)",
  protocolled: "Protocolado no INPI",
  registered: "Registrado no INPI",
};

// Mirrors apps/landing/src/legal/legalRegistration.ts resolvePublicText() (pt-BR) so this
// preview matches exactly what visitors and the extension will see — kept in sync by hand since
// admin and landing are separate apps with no shared package.
function previewText(row: {
  status: LegalRegistrationStatus;
  software_name: string;
  holder_name: string;
  protocol_number: string | null;
  protocol_date: string | null;
  registration_number: string | null;
  grant_date: string | null;
}): string {
  const fmt = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR") : "");
  switch (row.status) {
    case "preparation":
      return `O processo de registro de programa de computador da ${row.software_name} está sendo preparado perante o INPI.`;
    case "payment_pending":
      return `O processo de registro de programa de computador da ${row.software_name} está em andamento perante o Instituto Nacional da Propriedade Industrial (INPI).`;
    case "protocolled":
      return `O pedido de registro de programa de computador da ${row.software_name} foi protocolado no INPI sob o processo nº ${row.protocol_number}, em ${fmt(row.protocol_date)}.`;
    case "registered":
      return `${row.software_name} é um programa de computador registrado no INPI sob o nº ${row.registration_number}, concedido em ${fmt(row.grant_date)}. Titular: ${row.holder_name}. O registro refere-se à proteção jurídica do programa de computador e não representa certificação, homologação ou aprovação técnica pelo INPI.`;
  }
}

export function LegalRegistrationPage() {
  const [record, setRecord] = useState<LegalRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);

  const [status, setStatus] = useState<LegalRegistrationStatus>("preparation");
  const [softwareName, setSoftwareName] = useState("QA Toolbar Sandbox");
  const [holderName, setHolderName] = useState("Matheus Alves Bonotto Santos");
  const [protocolNumber, setProtocolNumber] = useState("");
  const [protocolDate, setProtocolDate] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [grantDate, setGrantDate] = useState("");
  const [publicQueryUrl, setPublicQueryUrl] = useState("");
  const [publicNotice, setPublicNotice] = useState("");

  function applyRecord(data: LegalRegistration) {
    setRecord(data);
    setStatus(data.status);
    setSoftwareName(data.software_name);
    setHolderName(data.holder_name);
    setProtocolNumber(data.protocol_number ?? "");
    setProtocolDate(data.protocol_date ?? "");
    setRegistrationNumber(data.registration_number ?? "");
    setGrantDate(data.grant_date ?? "");
    setPublicQueryUrl(data.public_query_url ?? "");
    setPublicNotice(data.public_notice ?? "");
  }

  useEffect(() => {
    getLegalRegistration()
      .then(applyRecord)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const needsProtocol = status === "protocolled" || status === "registered";
  const needsRegistration = status === "registered";
  const missingProtocolFields = needsProtocol && (!protocolNumber.trim() || !protocolDate);
  const missingRegistrationFields = needsRegistration && (!registrationNumber.trim() || !grantDate);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (missingProtocolFields || missingRegistrationFields) return;
    setSaving(true);
    setError(null);
    setSavedHint(false);
    try {
      await updateLegalRegistration({
        status,
        softwareName,
        holderName,
        protocolNumber: protocolNumber.trim() || null,
        protocolDate: protocolDate || null,
        registrationNumber: registrationNumber.trim() || null,
        grantDate: grantDate || null,
        publicQueryUrl: publicQueryUrl.trim() || null,
        publicNotice: publicNotice.trim() || null,
      });
      const fresh = await getLegalRegistration();
      applyRecord(fresh);
      setSavedHint(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div>Carregando…</div>;

  return (
    <div>
      <header className="qa-page-head">
        <h1>Registro de software (INPI)</h1>
        <p>
          Controla o status do processo de Registro de Programa de Computador exibido na landing
          page (rodapé + página "Propriedade Intelectual") e na extensão. Cada alteração fica
          registrada em Auditoria. Nunca declare um status à frente da realidade — o texto público
          é gerado a partir do que estiver salvo aqui.
        </p>
      </header>

      {error ? <div className="qa-error">{error}</div> : null}

      <div className="qa-card">
        <form className="qa-form-col" onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as LegalRegistrationStatus)}>
              {(Object.keys(STATUS_LABEL) as LegalRegistrationStatus[]).map((key) => (
                <option key={key} value={key}>{STATUS_LABEL[key]}</option>
              ))}
            </select>
          </label>

          <label>
            Nome do software
            <input value={softwareName} onChange={(e) => setSoftwareName(e.target.value)} required />
          </label>
          <label>
            Titular
            <input value={holderName} onChange={(e) => setHolderName(e.target.value)} required />
          </label>

          {needsProtocol ? (
            <>
              <label>
                Número do protocolo/processo {missingProtocolFields ? <span className="qa-error" style={{ display: "inline" }}>(obrigatório)</span> : null}
                <input value={protocolNumber} onChange={(e) => setProtocolNumber(e.target.value)} placeholder="Ex.: BR512026000000-0" />
              </label>
              <label>
                Data do protocolo
                <input type="date" value={protocolDate} onChange={(e) => setProtocolDate(e.target.value)} />
              </label>
            </>
          ) : null}

          {needsRegistration ? (
            <>
              <label>
                Número do registro {missingRegistrationFields ? <span className="qa-error" style={{ display: "inline" }}>(obrigatório)</span> : null}
                <input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
              </label>
              <label>
                Data da concessão
                <input type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)} />
              </label>
            </>
          ) : null}

          <label>
            Link público de consulta (opcional)
            <input type="url" value={publicQueryUrl} onChange={(e) => setPublicQueryUrl(e.target.value)} placeholder="https://busca.inpi.gov.br/..." />
          </label>
          <label>
            Observação institucional adicional (opcional)
            <textarea rows={2} value={publicNotice} onChange={(e) => setPublicNotice(e.target.value)} />
          </label>

          <div className="actions">
            <button type="submit" className="qa-btn primary" disabled={saving || missingProtocolFields || missingRegistrationFields}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
            {savedHint ? <span className="savedHint">Salvo — refletido na LP e na extensão.</span> : null}
          </div>
        </form>
      </div>

      <div className="qa-card">
        <h2>Prévia do texto público</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Exatamente o que aparece na LP e na extensão (pt-BR):</p>
        <p>{previewText({ status, software_name: softwareName, holder_name: holderName, protocol_number: protocolNumber || null, protocol_date: protocolDate || null, registration_number: registrationNumber || null, grant_date: grantDate || null })}</p>
      </div>

      {record ? (
        <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          Última atualização: {new Date(record.updated_at).toLocaleString("pt-BR")}
        </p>
      ) : null}
    </div>
  );
}
