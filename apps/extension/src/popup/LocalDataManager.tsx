import { useState } from "react";
import { FiDownload, FiRefreshCw, FiShield, FiUpload } from "react-icons/fi";
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

  return <div className="qtsDataManager"><section><h2><FiShield /> Importar e exportar</h2><p>A exportação segura exclui credenciais, tokens e números sandbox.</p><div><button onClick={() => void download(false)}><FiDownload /> Exportação segura</button><button onClick={() => void download(true)}>Exportação completa</button></div><label className="qtsPrimary"><FiUpload /> Selecionar JSON<input hidden type="file" accept="application/json" onChange={(event) => void selectFile(event.target.files?.[0])} /></label>{preview && <div className="qtsControlMessage"><b>Preview validado</b><p>{Object.entries(preview.counts).map(([key, count]) => `${key}: ${count}`).join(" · ")}</p><select value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}><option value="merge">Mesclar</option><option value="replace">Substituir</option></select><button onClick={() => void apply()}>Aplicar importação</button><button onClick={() => setPreview(null)}>Cancelar</button></div>}</section><section><h2><FiRefreshCw /> Reset local</h2><p>Dados online e assinatura nunca são apagados por esta ação.</p><select value={resetScope} onChange={(event) => setResetScope(event.target.value as ResetScope)}><option value="layout">Layout</option><option value="toolbar">Toolbar</option><option value="theme">Tema</option><option value="project">Projeto e dados relacionados</option><option value="permissions">Preferências de permissões</option><option value="convertio">Convertio</option><option value="all">Tudo local</option></select><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Digite RESETAR" /><button disabled={confirmation !== "RESETAR"} onClick={() => void reset()}>Resetar escopo</button></section></div>;
}
