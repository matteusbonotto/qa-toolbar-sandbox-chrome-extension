import { useEffect, useState } from "react";
import { FiExternalLink, FiKey, FiTrash2 } from "react-icons/fi";
import { maskedConvertioKey, removeConvertioKey, saveConvertioKey } from "../services/convertio";

export function ConvertioSettings({ onMessage }: { onMessage: (message: string) => void }) {
  const [key, setKey] = useState(""); const [masked, setMasked] = useState<string | null>(null); const [accepted, setAccepted] = useState(false);
  useEffect(() => { void maskedConvertioKey().then(setMasked); }, []);
  const save = async () => {
    if (!accepted) { onMessage("Confirme que entendeu o envio ao serviço externo e possíveis custos."); return; }
    try { const granted = await browser.permissions.request({ origins: ["https://api.convertio.co/*"] }); if (!granted) throw new Error("Permissão para a API Convertio não concedida."); await saveConvertioKey(key); setMasked(await maskedConvertioKey()); setKey(""); onMessage("Chave salva somente neste navegador."); } catch (error) { onMessage(error instanceof Error ? error.message : "Não foi possível salvar a chave."); }
  };
  return <section className="qtsConvertioSettings"><h2><FiKey /> Convertio para GIF</h2><p>O vídeo será enviado à Convertio somente quando você solicitar um GIF. A operação pode consumir créditos da sua própria conta.</p>{masked && <p><b>Chave configurada:</b> {masked}</p>}<input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Cole sua API key" /><label><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> Entendi o processamento externo, possíveis custos e que posso cancelar.</label><div><button disabled={!key.trim()} onClick={() => void save()}>Validar, salvar e continuar</button>{masked && <button onClick={() => void removeConvertioKey().then(() => { setMasked(null); onMessage("Chave Convertio removida."); })}><FiTrash2 /> Remover</button>}<a href="https://developers.convertio.co/api/docs/" target="_blank" rel="noreferrer">Documentação oficial <FiExternalLink /></a></div></section>;
}
