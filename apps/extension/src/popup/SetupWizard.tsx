import { useEffect, useMemo, useState } from "react";
import { FiArrowLeft, FiArrowRight, FiCheck, FiCreditCard, FiHelpCircle, FiImage, FiPlus, FiShield, FiSkipForward, FiTrash2, FiUser, FiX } from "react-icons/fi";
import type { Project } from "@qts/domain";
import { normalizeUrlPattern, normalizeUrlPatterns, permissionOrigins, urlMatchesAny } from "../services/workspace";

type EnvironmentDraft = { id: string; name: string; color: string; riskLevel: "low" | "medium" | "high" | "critical" };
type AssignedUrl = { value: string; environmentId: string; broad: boolean };
type TestAccount = { id: string; email: string; password: string; inboxUrl: string; environmentIds: string[]; image: string };
type PaymentMethod = { id: string; brand: string; number: string; holder: string; cvv: string; expiration: string; scenario: string; environmentIds: string[] };
type WizardData = {
  projectName: string;
  projectImage: string;
  clientImage: string;
  subscriptionImage: string;
  environments: EnvironmentDraft[];
  urls: AssignedUrl[];
  accounts: TestAccount[];
  payments: PaymentMethod[];
  inspectorsEnabled: boolean;
  inspectorEndpoints: string[];
};

const colors = ["#ef1823", "#3b82f6", "#f59e0b", "#22c55e", "#a855f7"];
const steps = ["Projeto", "Ambientes", "URLs", "Contas", "Pagamentos", "Inspectors"];
const requiredSteps = new Set([0, 1, 2]);

export function SetupWizard({ maximumUrls, onMessage }: { maximumUrls: number; onMessage: (message: string) => void }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>({ projectName: "", projectImage: "", clientImage: "", subscriptionImage: "", environments: [], urls: [], accounts: [], payments: [], inspectorsEnabled: true, inspectorEndpoints: ["get-candy", "get-member", "get-history", "get-prices", "checkout"] });
  const [environmentInput, setEnvironmentInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountImage, setAccountImage] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountInbox, setAccountInbox] = useState("");
  const [paymentBrand, setPaymentBrand] = useState("");
  const [paymentScenario, setPaymentScenario] = useState("");
  const [paymentNumber, setPaymentNumber] = useState("");
  const [paymentHolder, setPaymentHolder] = useState("");
  const [paymentCvv, setPaymentCvv] = useState("");
  const [paymentExpiration, setPaymentExpiration] = useState("");
  const [inspectorInput, setInspectorInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void browser.storage.local.get(["qtsWizardData", "qtsSetup"]).then((stored) => {
      if (stored.qtsWizardData) {
        const restored = stored.qtsWizardData as WizardData;
        setData({ ...restored, inspectorEndpoints: restored.inspectorEndpoints ?? ["get-candy", "get-member", "get-history", "get-prices", "checkout"] });
        setSelectedEnvironmentId(restored.environments[0]?.id ?? "");
        return;
      }
      const legacy = stored.qtsSetup as { projectName?: string; environmentName?: string; domains?: string[]; urlPatterns?: string[] } | undefined;
      const environment: EnvironmentDraft = { id: crypto.randomUUID(), name: legacy?.environmentName || "Local", color: colors[0]!, riskLevel: "low" };
      const patterns = normalizeUrlPatterns(legacy?.urlPatterns ?? legacy?.domains ?? ["localhost"]);
      setData((current) => ({ ...current, projectName: legacy?.projectName || "Meu projeto QA", environments: [environment], urls: patterns.map((pattern) => ({ ...pattern, environmentId: environment.id })) }));
      setSelectedEnvironmentId(environment.id);
    });
  }, []);

  const requiredReady = useMemo(() => data.projectName.trim().length >= 2 && data.environments.length > 0 && data.urls.length > 0, [data]);
  const broadAccess = data.urls.some((url) => url.broad || url.value === "*");

  const addEnvironment = () => {
    const name = environmentInput.trim();
    if (!name || data.environments.some((item) => item.name.toLowerCase() === name.toLowerCase())) return;
    const environment: EnvironmentDraft = { id: crypto.randomUUID(), name, color: colors[data.environments.length % colors.length]!, riskLevel: /prod/i.test(name) ? "critical" : /stage|beta|hml|qa/i.test(name) ? "medium" : "low" };
    setData((current) => ({ ...current, environments: [...current.environments, environment] }));
    setSelectedEnvironmentId((current) => current || environment.id);
    setEnvironmentInput("");
  };

  const removeEnvironment = (environmentId: string) => {
    const remaining = data.environments.filter((item) => item.id !== environmentId);
    setData((current) => ({
      ...current,
      environments: current.environments.filter((item) => item.id !== environmentId),
      urls: current.urls.filter((url) => url.environmentId !== environmentId),
    }));
    if (selectedEnvironmentId === environmentId) setSelectedEnvironmentId(remaining[0]?.id ?? "");
  };

  const addUrl = () => {
    const normalized = normalizeUrlPattern(urlInput);
    if (!normalized) { onMessage("URL inválida. Exemplos: https://google.com/*, *.com.br/*, google.* ou *."); return; }
    if (!selectedEnvironmentId) { onMessage("Escolha o ambiente desta URL."); return; }
    if (data.urls.some((item) => item.value === normalized.value && item.environmentId === selectedEnvironmentId)) return;
    if (data.urls.length >= maximumUrls) { onMessage(`Seu acesso atual permite ${maximumUrls} URLs.`); return; }
    setData((current) => ({ ...current, urls: [...current.urls, { ...normalized, environmentId: selectedEnvironmentId }] }));
    setUrlInput("");
  };

  const canLeaveStep = () => {
    if (step === 0 && data.projectName.trim().length < 2) return "Informe o nome do projeto, por exemplo Cinemark.";
    if (step === 1 && !data.environments.length) return "Adicione ao menos um ambiente.";
    if (step === 2 && !data.urls.length) return "Adicione ao menos uma URL em que a toolbar aparecerá.";
    return "";
  };

  const next = () => {
    const error = canLeaveStep();
    if (error) { onMessage(error); return; }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const goToStep = (index: number) => {
    if (index <= step) { setStep(index); return; }
    const missing = data.projectName.trim().length < 2 ? "Informe o projeto antes de avançar." : !data.environments.length ? "Adicione um ambiente antes de avançar." : !data.urls.length && index > 2 ? "Adicione uma URL antes de avançar." : "";
    if (missing) { onMessage(missing); return; }
    setStep(index);
  };

  const save = async () => {
    if (!requiredReady) { onMessage("Conclua Projeto, Ambientes e URLs antes de ativar a toolbar."); return; }
    setSaving(true);
    try {
      const normalized = normalizeUrlPatterns(data.urls.map((item) => item.value));
      const origins = permissionOrigins(normalized).filter((origin) => !/localhost|127\.0\.0\.1/.test(origin));
      if (origins.length && !await browser.permissions.request({ origins })) throw new Error("Permissão não concedida. A toolbar não pode aparecer sem acesso às URLs escolhidas.");
      const registered = await browser.scripting.getRegisteredContentScripts();
      const oldIds = registered.filter((item) => item.id.startsWith("qts-workspace-") || item.id.startsWith("qts-domain-")).map((item) => item.id);
      if (oldIds.length) await browser.scripting.unregisterContentScripts({ ids: oldIds });
      if (origins.length) await browser.scripting.registerContentScripts([{
        id: "qts-workspace-active",
        matches: origins,
        js: ["content-scripts/content.js"],
        persistAcrossSessions: true,
        runAt: "document_idle",
      }]);
      const projectId = crypto.randomUUID();
      const projects: Project[] = [{
        id: projectId,
        name: data.projectName.trim(),
        accentColor: "#ef1823",
        environments: data.environments.map((environment) => ({ ...environment, urlPatterns: data.urls.filter((url) => url.environmentId === environment.id).map((url) => url.value) })),
      }];
      const firstEnvironment = data.environments[0]!;
      await browser.storage.local.set({
        qtsWizardData: data,
        qtsProjects: projects,
        qtsActiveProjectId: projectId,
        qtsSetup: { projectName: data.projectName.trim(), environmentName: firstEnvironment.name, urlPatterns: data.urls.map((url) => url.value), domains: [] },
      });
      const tabs = await browser.tabs.query({});
      const matching = tabs.filter((tab) => tab.id && tab.url && urlMatchesAny(tab.url, data.urls.map((url) => url.value)));
      await Promise.all(matching.map((tab) => browser.tabs.reload(tab.id!)));
      onMessage(matching.length ? `Tudo pronto. ${matching.length} aba(s) recarregada(s); a toolbar deve aparecer agora.` : "Configuração salva. Abra uma URL cadastrada para ver a toolbar.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Não foi possível ativar a toolbar.");
    } finally { setSaving(false); }
  };

  return <div className="qtsWizard">
    <ol className="qtsWizardSteps">{steps.map((label, index) => <li className={index === step ? "isActive" : index < step ? "isDone" : ""} key={label}><button onClick={() => goToStep(index)}><span>{index < step ? <FiCheck /> : index + 1}</span>{label}{requiredSteps.has(index) && <small>obrigatório</small>}</button></li>)}</ol>
    <section className="qtsWizardCard">
      {step === 0 && <><WizardHead title="Qual projeto você vai testar?" text="Use um nome reconhecível por todo o time, como Cinemark, Checkout ou Portal do Cliente." /><label className="qtsWizardField">Nome do projeto <Info text="Este nome aparece na toolbar e organiza ambientes, contas e evidências." /><input autoFocus value={data.projectName} onChange={(event) => setData({ ...data, projectName: event.target.value })} placeholder="Ex.: Cinemark" /></label><div className="qtsImageGrid"><ImageField label="Imagem do projeto" value={data.projectImage} onChange={(value) => setData({ ...data, projectImage: value })} /><ImageField label="Imagem do cliente" value={data.clientImage} onChange={(value) => setData({ ...data, clientImage: value })} /><ImageField label="Imagem da assinatura" value={data.subscriptionImage} onChange={(value) => setData({ ...data, subscriptionImage: value })} /></div></>}
      {step === 1 && <><WizardHead title="Cadastre os ambientes" text="Digite e pressione Enter ou clique em adicionar. Exemplos: Alfa, Beta, Stage e Produção." /><PillInput value={environmentInput} setValue={setEnvironmentInput} onAdd={addEnvironment} placeholder="Ex.: Stage" /><div className="qtsPills">{data.environments.map((environment) => <span key={environment.id} style={{ borderColor: environment.color }}>{environment.name}<button aria-label={`Excluir ${environment.name}`} onClick={() => removeEnvironment(environment.id)}><FiX /></button></span>)}</div></>}
      {step === 2 && <><WizardHead title="Em quais URLs a toolbar deve aparecer?" text="Protocolos, caminhos e curingas são aceitos. Cada URL fica ligada a um ambiente." /><div className="qtsUrlComposer"><select value={selectedEnvironmentId} onChange={(event) => setSelectedEnvironmentId(event.target.value)}>{data.environments.map((environment) => <option value={environment.id} key={environment.id}>{environment.name}</option>)}</select><PillInput value={urlInput} setValue={setUrlInput} onAdd={addUrl} placeholder="https://google.com/*" /></div><div className="qtsExamples"><b>Exemplos:</b><button onClick={() => setUrlInput("https://google.com/*")}>https://google.com/*</button><button onClick={() => setUrlInput("*.com.br/*")}>*.com.br/*</button><button onClick={() => setUrlInput("google.*")}>google.*</button><button onClick={() => setUrlInput("*")}>* (todos)</button></div>{broadAccess && <div className="qtsBroadWarning"><FiShield /><span><b>Acesso amplo solicitado</b><small>O Chrome exigirá acesso a todos os sites para suportar * ou curingas de domínio. A extensão ainda monta a toolbar somente nas URLs salvas.</small></span></div>}<div className="qtsPills qtsUrlPills">{data.urls.map((url) => <span key={`${url.environmentId}:${url.value}`}><small>{data.environments.find((item) => item.id === url.environmentId)?.name}</small>{url.value}<button aria-label={`Excluir ${url.value}`} onClick={() => setData((current) => ({ ...current, urls: current.urls.filter((item) => item !== url) }))}><FiX /></button></span>)}</div></>}
      {step === 3 && <><WizardHead title="Contas de teste" text="Opcional. As credenciais permanecem neste perfil do navegador, como no userscript." /><div className="qtsInlineForm qtsFormFour"><input type="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="qa@exemplo.com" /><input type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="Senha de teste" /><input type="url" value={accountInbox} onChange={(event) => setAccountInbox(event.target.value)} placeholder="URL do inbox" /><button onClick={() => { if (!accountEmail.trim()) return; setData({ ...data, accounts: [...data.accounts, { id: crypto.randomUUID(), email: accountEmail.trim(), password: accountPassword, inboxUrl: accountInbox.trim(), image: accountImage.trim(), environmentIds: data.environments.map((item) => item.id) }] }); setAccountEmail(""); setAccountPassword(""); setAccountInbox(""); setAccountImage(""); }}><FiPlus /> Adicionar</button></div><ImageField label="Imagem da conta" value={accountImage} onChange={setAccountImage} /><EntityList items={data.accounts.map((item) => ({ id: item.id, title: item.email, subtitle: `${item.environmentIds.length} ambiente(s) · ${item.inboxUrl ? "inbox configurado" : "sem inbox"}` }))} onRemove={(id) => setData({ ...data, accounts: data.accounts.filter((item) => item.id !== id) })} /></>}
      {step === 4 && <><WizardHead title="Métodos de pagamento sandbox" text="Opcional. Cadastre apenas cartões e meios de teste; nunca use dados reais." /><div className="qtsInlineForm qtsFormFour"><input value={paymentBrand} onChange={(event) => setPaymentBrand(event.target.value)} placeholder="Bandeira / provedor" /><input inputMode="numeric" value={paymentNumber} onChange={(event) => setPaymentNumber(event.target.value)} placeholder="Número sandbox" /><input value={paymentHolder} onChange={(event) => setPaymentHolder(event.target.value)} placeholder="Titular" /><input type="password" inputMode="numeric" value={paymentCvv} onChange={(event) => setPaymentCvv(event.target.value)} placeholder="CVV" /><input value={paymentExpiration} onChange={(event) => setPaymentExpiration(event.target.value)} placeholder="MM/AA" /><input value={paymentScenario} onChange={(event) => setPaymentScenario(event.target.value)} placeholder="Cenário: aprovado" /><button onClick={() => { if (!paymentBrand.trim()) return; setData({ ...data, payments: [...data.payments, { id: crypto.randomUUID(), brand: paymentBrand.trim(), number: paymentNumber.trim(), holder: paymentHolder.trim(), cvv: paymentCvv.trim(), expiration: paymentExpiration.trim(), scenario: paymentScenario.trim(), environmentIds: data.environments.map((item) => item.id) }] }); setPaymentBrand(""); setPaymentNumber(""); setPaymentHolder(""); setPaymentCvv(""); setPaymentExpiration(""); setPaymentScenario(""); }}><FiCreditCard /> Adicionar</button></div><EntityList items={data.payments.map((item) => ({ id: item.id, title: item.brand, subtitle: `${item.scenario || "Sem cenário"} · final ${item.number.slice(-4) || "----"}` }))} onRemove={(id) => setData({ ...data, payments: data.payments.filter((item) => item.id !== id) })} /></>}
      {step === 5 && <><WizardHead title="Inspectors e ferramentas" text="Cadastre endpoints sem /api/. O menu Tools permanece sempre acessível." /><label className="qtsWizardToggle"><input type="checkbox" checked={data.inspectorsEnabled} onChange={(event) => setData({ ...data, inspectorsEnabled: event.target.checked })} /><span><b>Ativar inspectors automáticos</b><small>Observa respostas compatíveis da própria página e exibe payloads localmente.</small></span></label><div className="qtsInspectorComposer"><PillInput value={inspectorInput} setValue={setInspectorInput} onAdd={() => { const endpoint = inspectorInput.trim().replace(/^\/api\//i, "").toLowerCase(); if (!/^[a-z0-9][a-z0-9_-]*$/.test(endpoint) || data.inspectorEndpoints.includes(endpoint)) return; setData({ ...data, inspectorEndpoints: [...data.inspectorEndpoints, endpoint] }); setInspectorInput(""); }} placeholder="Ex.: get-candy" /><div className="qtsPills">{data.inspectorEndpoints.map((endpoint) => <span key={endpoint}>{endpoint}<button onClick={() => setData({ ...data, inspectorEndpoints: data.inspectorEndpoints.filter((item) => item !== endpoint) })}><FiX /></button></span>)}</div></div><div className="qtsWizardSummary"><FiCheck /><span><b>{data.projectName}</b><small>{data.environments.length} ambientes · {data.urls.length} URLs · {data.accounts.length} contas · {data.payments.length} pagamentos · {data.inspectorEndpoints.length} inspectors</small></span></div></>}
      <footer><button className="qtsWizardBack" disabled={step === 0} onClick={() => setStep((current) => current - 1)}><FiArrowLeft /> Voltar</button><div>{!requiredSteps.has(step) && step < steps.length - 1 && <button className="qtsWizardSkip" onClick={next}><FiSkipForward /> Pular por enquanto</button>}{step < steps.length - 1 ? <button className="qtsPrimary" onClick={next}>Continuar <FiArrowRight /></button> : <button className="qtsPrimary" disabled={saving} onClick={() => void save()}><FiCheck /> {saving ? "Ativando..." : "Salvar e ativar toolbar"}</button>}</div></footer>
    </section>
  </div>;
}

function WizardHead({ title, text }: { title: string; text: string }) { return <header className="qtsWizardHead"><h2>{title}</h2><p>{text}</p></header>; }
function Info({ text }: { text: string }) { return <button className="qtsInfo" type="button" title={text} aria-label={text}><FiHelpCircle /></button>; }
function PillInput({ value, setValue, onAdd, placeholder }: { value: string; setValue: (value: string) => void; onAdd: () => void; placeholder: string }) { return <div className="qtsPillInput"><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); onAdd(); } }} placeholder={placeholder} /><button onClick={onAdd}><FiPlus /> Adicionar</button></div>; }
function ImageField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="qtsImageField"><span><FiImage /> {label} <Info text="Opcional. Use uma URL HTTPS ou importe uma imagem pequena; ela fica somente neste navegador." /></span><input value={value.startsWith("data:") ? "Imagem importada" : value} onChange={(event) => onChange(event.target.value)} placeholder="https://..." disabled={value.startsWith("data:")} /><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 512_000) { event.target.value = ""; return; } const reader = new FileReader(); reader.onload = () => onChange(String(reader.result || "")); reader.readAsDataURL(file); }} />{value && <button type="button" onClick={() => onChange("")}><FiTrash2 /> Remover</button>}</label>; }
function EntityList({ items, onRemove }: { items: { id: string; title: string; subtitle: string }[]; onRemove: (id: string) => void }) { return <div className="qtsEntityList">{items.length ? items.map((item) => <article key={item.id}><FiUser /><span><b>{item.title}</b><small>{item.subtitle}</small></span><button onClick={() => onRemove(item.id)} aria-label={`Excluir ${item.title}`}><FiTrash2 /></button></article>) : <p>Nenhum item cadastrado. Você pode pular esta etapa.</p>}</div>; }
