import { useState } from "react";
import { FiAlertTriangle, FiDownload, FiFileText, FiRefreshCw, FiShield, FiUpload } from "react-icons/fi";
import type { LocalWorkspace } from "@qts/domain";
import { applyImport, emptyWorkspace, exportWorkspace, previewImport, resetWorkspace, type ImportMode, type ResetScope } from "../services/localWorkspace";

const storageKey = "qtsLocalWorkspaceV2";
const rollbackKey = "qtsLocalWorkspaceRollbackV2";

export function LocalDataManager({ onMessage }: { onMessage: (message: string) => void }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewImport>> | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [resetScope, setResetScope] = useState<ResetScope>("layout");
  const [confirmation, setConfirmation] = useState("");

  const load = async () => {
    const stored = await browser.storage.local.get(storageKey);
    return (stored[storageKey] as LocalWorkspace | undefined) ?? emptyWorkspace();
  };
  const download = async (complete: boolean) => {
    if (complete && !window.confirm("A exportação completa pode conter credenciais e dados sensíveis. Continuar?")) return;
    const exported = await exportWorkspace(await load(), complete ? "complete" : "safe");
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `qa-toolbar-${complete ? "SENSITIVE-complete" : "safe"}-${Date.now()}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const selectFile = async (file?: File) => {
    if (!file || file.size > 10_000_000) { onMessage("Selecione um JSON válido de até 10 MB."); return; }
    try { setPreview(await previewImport(JSON.parse(await file.text()))); } catch (error) { onMessage(error instanceof Error ? error.message : "Importação inválida."); }
  };
  const apply = async () => {
    if (!preview) return;
    const result = applyImport(await load(), preview.workspace, mode);
    await browser.storage.local.set({ [storageKey]: result.workspace, [rollbackKey]: result.rollback });
    setPreview(null); onMessage(`Importação ${mode === "merge" ? "mesclada" : "substituída"} com sucesso. Rollback disponível.`);
  };
  const reset = async () => {
    if (confirmation !== "RESETAR") { onMessage("Digite RESETAR para confirmar."); return; }
    const current = await load();
    await browser.storage.local.set({ [storageKey]: resetWorkspace(current, resetScope), [rollbackKey]: current });
    setConfirmation(""); onMessage("Reset local concluído. Conta, assinatura e licença online não foram alteradas.");
  };

  return <div className="qtsDataManager"><header><small>PORTABILIDADE E CONTROLE</small><h2>Dados locais e segurança</h2><p>Exporte, restaure ou limpe partes específicas do workspace sem afetar sua conta e assinatura.</p></header><div className="qtsDataGrid"><section><span className="qtsDataIcon"><FiShield /></span><h3>Backup do workspace</h3><p>Escolha o nível adequado para compartilhar ou guardar seus dados.</p><div className="qtsExportOptions"><button onClick={() => void download(false)}><FiDownload /><span><b>Exportação segura</b><small>Remove credenciais, tokens e números sandbox.</small></span></button><button onClick={() => void download(true)}><FiFileText /><span><b>Exportação completa</b><small>Arquivo sensível para backup pessoal.</small></span></button></div><label className="qtsImportDrop"><FiUpload /><span><b>Importar arquivo JSON</b><small>Até 10 MB · validado antes de aplicar</small></span><input hidden type="file" accept="application/json" onChange={(event) => void selectFile(event.target.files?.[0])} /></label>{preview && <div className="qtsImportPreview"><b>Arquivo validado</b><p>{Object.entries(preview.counts).map(([key, count]) => `${key}: ${count}`).join(" · ")}</p><label>Estratégia<select value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}><option value="merge">Mesclar com dados atuais</option><option value="replace">Substituir workspace</option></select></label><div><button onClick={() => setPreview(null)}>Cancelar</button><button className="qtsPrimary" onClick={() => void apply()}>Aplicar importação</button></div></div>}</section><section className="qtsDangerZone"><span className="qtsDataIcon"><FiRefreshCw /></span><h3>Reset seletivo</h3><p>Escolha exatamente o que será restaurado. Dados online nunca são apagados.</p><label><span>Escopo do reset</span><select value={resetScope} onChange={(event) => setResetScope(event.target.value as ResetScope)}><option value="layout">Posição e layout</option><option value="toolbar">Preferências da toolbar</option><option value="theme">Tema e aparência</option><option value="project">Projeto e dados relacionados</option><option value="permissions">Preferências de permissões</option><option value="convertio">Integração Convertio</option><option value="all">Todos os dados locais</option></select></label><div className="qtsDangerNotice"><FiAlertTriangle /><span><b>A ação pode ser desfeita por rollback</b><small>Conta, licença, plano e cobrança permanecem intactos.</small></span></div><label><span>Confirmação</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Digite RESETAR" /></label><button className="qtsResetButton" disabled={confirmation !== "RESETAR"} onClick={() => void reset()}>Resetar escopo selecionado</button></section></div></div>;
}
