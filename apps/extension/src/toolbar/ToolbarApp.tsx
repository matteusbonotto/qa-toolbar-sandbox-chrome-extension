import { useEffect, useRef, useState } from "react";
import {
  FiAlertOctagon, FiAlertTriangle, FiBox, FiCamera, FiCheck, FiChevronDown,
  FiChevronUp, FiCircle, FiClipboard, FiClock, FiCode, FiCreditCard,
  FiDownload, FiGrid, FiHelpCircle, FiMaximize, FiMousePointer, FiPackage,
  FiPause, FiPlay, FiRefreshCw, FiSearch, FiSettings, FiSquare, FiStopCircle,
  FiType, FiUser, FiX,
} from "react-icons/fi";
import { useToolbarStore, type PanelId } from "../store/useToolbarStore";
import { featureEnabled, type EntitlementCache } from "../services/entitlements";
import { matchEnvironment, type Project } from "@qts/domain";

type Workspace = { projectName: string; domain: string; environmentName: string };
const ONBOARDING_KEY = "qtsOnboardingV2Complete";
const SPACER_ID = "qts-windowsill-page-spacer";

const inspectorItems = ["Product Inspector", "Member Inspector", "Purchase History", "Prices Inspector", "Movies Inspector", "Showtimes Inspector"];

export function ToolbarApp() {
  const state = useToolbarStore();
  const panelRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace>({ projectName: "QA Sandbox", domain: window.location.hostname, environmentName: "LOCAL" });
  const [toast, setToast] = useState("");
  const [entitlements, setEntitlements] = useState<EntitlementCache | null>(null);

  useEffect(() => {
    if (typeof browser === "undefined") return;
    void browser.storage.local.get(["qtsSetup", "qtsProjects", "qtsActiveProjectId", ONBOARDING_KEY, "qtsEntitlementCache"]).then((stored) => {
      const projects = (stored.qtsProjects ?? []) as Project[];
      const project = projects.find((item) => item.id === stored.qtsActiveProjectId) ?? projects[0];
      const matched = project ? matchEnvironment(window.location.href, project.environments) : null;
      if (project && matched?.environment) {
        setWorkspace({ projectName: project.name, domain: window.location.hostname, environmentName: matched.environment.name });
      } else if (stored.qtsSetup) setWorkspace(stored.qtsSetup as Workspace);
      if (stored.qtsEntitlementCache) setEntitlements(stored.qtsEntitlementCache as EntitlementCache);
      if (!stored[ONBOARDING_KEY]) setOnboardingOpen(true);
    });
    const updateEntitlements = (changes: Record<string, Browser.storage.StorageChange>) => {
      if (changes.qtsEntitlementCache?.newValue) setEntitlements(changes.qtsEntitlementCache.newValue as EntitlementCache);
    };
    browser.storage.local.onChanged.addListener(updateEntitlements);
    return () => browser.storage.local.onChanged.removeListener(updateEntitlements);
  }, []);

  useEffect(() => {
    if (state.activePanel) panelRef.current?.focus();
  }, [state.activePanel]);

  useEffect(() => {
    const closeFloatingUi = (event: MouseEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setToolsOpen(false);
      state.closePanel();
      setOnboardingOpen(false);
    };
    document.addEventListener("mousedown", closeFloatingUi);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeFloatingUi);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [state.closePanel]);

  useEffect(() => {
    let spacer = document.getElementById(SPACER_ID);
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.id = SPACER_ID;
      spacer.setAttribute("aria-hidden", "true");
      document.body.prepend(spacer);
    }
    const isCompact = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 720px)").matches;
    const visibleHeight = state.isExpanded ? (isCompact ? 78 : 42) : 0;
    spacer.style.cssText = `display:block;width:100%;height:${visibleHeight}px;min-height:${visibleHeight}px;flex:0 0 ${visibleHeight}px;transition:height 180ms ease,min-height 180ms ease;`;
    document.documentElement.style.setProperty("--qts-windowsill-height", `${visibleHeight}px`);
    document.documentElement.style.scrollPaddingTop = `${visibleHeight}px`;
    return () => {
      spacer?.remove();
      document.documentElement.style.removeProperty("--qts-windowsill-height");
      document.documentElement.style.removeProperty("scroll-padding-top");
    };
  }, [state.isExpanded]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const openTool = (panel: Exclude<PanelId, null>) => {
    if ((panel === "inspectors" || panel === "errors") && !featureEnabled(entitlements, "inspectors.enabled")) {
      notify("Disponível no Pro. Abra o ícone da extensão para comparar os planos.");
      return;
    }
    setToolsOpen(false);
    state.openPanel(panel);
  };

  const finishOnboarding = () => {
    setOnboardingOpen(false);
    setOnboardingStep(0);
    if (typeof browser !== "undefined") void browser.storage.local.set({ [ONBOARDING_KEY]: true });
  };

  if (!state.isExpanded) {
    return <button id="qtsEnvironmentRestoreButton" className="isVisible" onClick={state.toggleExpanded} title="Mostrar QA Toolbar"><FiChevronDown /></button>;
  }

  return (
    <div className="qtsHost qtsWindowsillHost" onMouseDown={(event) => event.stopPropagation()}>
      <div id="qtsEnvironmentWindowsill" role="toolbar" aria-label="QA Toolbar Sandbox">
        <div className="qtsEnvironmentLeftContent">
          <span className="qtsEnvironmentFlag" aria-hidden="true">🧪</span>
          <span className="qtsEnvironmentCountry" title={workspace.projectName}>{compact(workspace.projectName, 16)}</span>
          <span className="qtsEnvironmentDivider">|</span>
          <span className="qtsEnvironmentName">{workspace.environmentName}</span>
          <span className="qtsEnvironmentDivider qtsDesktopOnly">|</span>
          <span id="qtsEvidenceUrl" className="qtsEvidenceUrl qtsDesktopOnly" title={window.location.href}>{compact(window.location.host + window.location.pathname, 34)}</span>
        </div>

        <div className="qtsEvidenceCenter" data-recording={state.captureEnabled}>{state.captureEnabled ? "● RECORDING · 00:00" : `${entitlements?.plan.name?.toUpperCase() ?? "STARTER"} · READY TO TEST`}</div>

        <div className="qtsEnvironmentRightContent">
          <span id="qtsEvidenceTotalTime" className="qtsEvidenceTotalTime">00:00</span>
          <span className="qtsEnvironmentDivider qtsDesktopOnly">|</span>
          <QaButton title={state.captureEnabled ? "Pausar gravação" : "Iniciar gravação"} label={state.captureEnabled ? "Pause local capture" : "Start local capture"} onClick={() => featureEnabled(entitlements, "recording.enabled") ? state.toggleCapture() : notify("Gravação está no Pro. Clique no ícone da extensão para liberar.")} active={state.captureEnabled}>{state.captureEnabled ? <FiPause /> : <FiPlay />}</QaButton>
          <QaButton title="Parar gravação" label="Stop evidence recording" onClick={() => state.captureEnabled && state.toggleCapture()} disabled={!state.captureEnabled}><FiStopCircle /></QaButton>
          <QaButton title="Capturar screenshot" label="Capture screenshot" onClick={() => notify("Screenshot será habilitado após a permissão da aba ativa.")}><FiCamera /></QaButton>
          <span className="qtsEnvironmentDivider qtsDesktopOnly">|</span>
          <QaButton className="qtsEnvironmentPassButton" title="Adicionar marcador Pass" label="Place Pass marker" onClick={() => notify("Modo de marcador PASS ativado.")}><FiCheck /></QaButton>
          <QaButton className="qtsEnvironmentFailButton" title="Adicionar marcador Fail" label="Place Fail marker" onClick={() => notify("Modo de marcador FAIL ativado.")}><FiX /></QaButton>
          <QaButton title="Adicionar nota de texto" label="Add text note" onClick={() => notify(featureEnabled(entitlements, "annotations.enabled") ? "Editor de nota preparado para o próximo incremento." : "Anotações estão no Pro. Clique no ícone da extensão para liberar.")}><FiType /></QaButton>
          <QaButton title="Desenhar forma" label="Draw shape" onClick={() => notify(featureEnabled(entitlements, "annotations.enabled") ? "Ferramenta de formas preparada para o próximo incremento." : "Anotações estão no Pro. Clique no ícone da extensão para liberar.")}><FiMaximize /></QaButton>
          <QaButton className="qtsLegacyToolbarLabButton qtsWideOnly" title="Inspecionar elemento clicável" label="Inspect clickable element" onClick={() => notify(featureEnabled(entitlements, "inspectors.enabled") ? "Click Spy ativado para o próximo clique." : "Inspectors estão no Pro. Clique no ícone da extensão para liberar.")}><FiMousePointer /></QaButton>
          <QaButton className="qtsLegacyToolbarLabButton qtsWideOnly" title="Congelar relógio" label="Freeze clock" onClick={() => notify("Controle de tempo disponível no módulo avançado.")}><FiClock /></QaButton>
          <QaButton className="qtsLegacyToolbarLabButton qtsWideOnly" title="Forçar resposta HTTP" label="Configure forced HTTP response" onClick={() => notify(featureEnabled(entitlements, "httpControls.enabled") ? "Forçar HTTP exige consentimento de interceptação." : "HTTP Controls é exclusivo do Scale.")}><FiAlertOctagon /></QaButton>

          <div className="qtsEnvironmentToolsWrapper" ref={toolsRef}>
            <button id="qtsEnvironmentToolsButton" className="qtsEnvironmentToolsButton" type="button" title="Ferramentas" aria-expanded={toolsOpen} onClick={() => setToolsOpen((value) => !value)}><FiGrid /><span>Tools</span></button>
            <div id="qtsEnvironmentToolsMenu" className={`qtsEnvironmentToolsMenu ${toolsOpen ? "isOpen" : ""}`}>
              <MenuButton icon={<FiPackage />} label="Network Observatory" onClick={() => openTool("observatory")} />
              <MenuButton icon={<FiCreditCard />} label="Payment Methods" onClick={() => openTool("payments")} />
              <MenuButton icon={<FiUser />} label="Test Accounts" onClick={() => openTool("accounts")} />
              <MenuButton icon={<FiClipboard />} label="Test Status" onClick={() => openTool("test-status")} />
              <MenuButton icon={<FiAlertTriangle />} label="Errors" badge="2" onClick={() => openTool("errors")} />
              <details className="qtsLegacyInspectorToolsGroup">
                <summary><span><FiCode /> Inspectors</span><FiChevronDown /></summary>
                {inspectorItems.map((label) => <button type="button" key={label} onClick={() => openTool("inspectors")}><FiBox /><span>{label}</span><small>waiting payload</small></button>)}
              </details>
              <MenuButton icon={<FiCircle />} label="RUT Generator" onClick={() => openTool("rut")} />
              <MenuButton icon={<FiSettings />} label="Settings" onClick={() => openTool("settings")} />
              <MenuButton icon={<FiHelpCircle />} label="Guia rápido" onClick={() => { setToolsOpen(false); setOnboardingStep(0); setOnboardingOpen(true); }} />
            </div>
          </div>

          <button id="qtsEnvironmentMinimizeButton" className="qtsEnvironmentActionButton qtsEnvironmentMinimizeButton" type="button" title="Ocultar toolbar" onClick={state.toggleExpanded}><FiChevronUp /></button>
        </div>
      </div>

      {state.activePanel && <ToolDrawer panel={state.activePanel} close={state.closePanel} panelRef={panelRef} workspace={workspace} />}
      {onboardingOpen && <Onboarding step={onboardingStep} setStep={setOnboardingStep} finish={finishOnboarding} />}
      {toast && <div className="qtsToast qtsToast" role="status">{toast}</div>}
    </div>
  );
}

function QaButton({ title, label, onClick, children, className = "", active = false, disabled = false }: { title: string; label: string; onClick: () => void; children: React.ReactNode; className?: string; active?: boolean; disabled?: boolean }) {
  return <button type="button" className={`qtsEnvironmentActionButton ${className} ${active ? "isActive" : ""}`} title={title} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function MenuButton({ icon, label, onClick, badge }: { icon: React.ReactNode; label: string; onClick: () => void; badge?: string }) {
  return <button className="qtsEnvironmentToolsMenuItem" type="button" title={label === "Network Observatory" ? "Observatory" : undefined} onClick={onClick}><span className="qtsLegacyToolMenuContent"><span className="qtsLegacyToolMenuLabel">{icon}<span>{label}</span></span>{badge && <span className="qtsLegacyErrorsCount">{badge}</span>}</span></button>;
}

function ToolDrawer({ panel, close, panelRef, workspace }: { panel: Exclude<PanelId, null>; close: () => void; panelRef: React.RefObject<HTMLElement | null>; workspace: Workspace }) {
  const content: Record<Exclude<PanelId, null>, { eyebrow: string; title: string; description: string }> = {
    observatory: { eyebrow: "QA NETWORK OBSERVATORY", title: "Requests da página", description: "Histórico local, erros HTTP e payloads capturados com consentimento." },
    payments: { eyebrow: "QA SANDBOX", title: "Payment Methods", description: "Dados de pagamento de teste do contexto atual." },
    accounts: { eyebrow: "QA ACCOUNTS", title: "Test Accounts", description: "Contas de teste por ambiente, armazenadas somente neste navegador." },
    "test-status": { eyebrow: "QA EVIDENCE", title: "Test Status", description: "Marque a evidência atual como aprovada ou reprovada." },
    errors: { eyebrow: "QA ERROR MONITOR", title: "HTTP errors 500+", description: "Sinais capturados e provável responsabilidade técnica." },
    rut: { eyebrow: "QA UTILITY", title: "RUT Generator", description: "Gerador local configurável para dados sintéticos." },
    settings: { eyebrow: "QA CONFIGURATION", title: "Settings", description: "Toolbar, contexto, ferramentas fixadas e privacidade." },
    inspectors: { eyebrow: "QA API INSPECTOR", title: "Inspector payload", description: "Aguardando um payload compatível nesta rota." },
  };
  const current = content[panel];
  return <aside id="qtsLegacyProductDrawer" className="qtsPanel isOpen" ref={panelRef} tabIndex={-1} aria-label={`${panel} panel`}>
    <header className="qtsPaymentDrawerHeader"><div className="qtsPaymentDrawerHeaderLeft"><div className="qtsPaymentDrawerEyebrow">{current.eyebrow}</div><h2 className="qtsPaymentDrawerTitle">{current.title}</h2><p className="qtsPaymentDrawerSubtitle">{current.description}</p></div><button className="qtsPaymentDrawerCloseButton" onClick={close} aria-label="Close panel"><FiX /></button></header>
    <div className="qtsLegacyDrawerBody"><DrawerContent panel={panel} workspace={workspace} /></div>
  </aside>;
}

function DrawerContent({ panel, workspace }: { panel: Exclude<PanelId, null>; workspace: Workspace }) {
  if (panel === "test-status") return <div className="qtsStatusChooser"><button className="pass"><FiCheck /> PASS</button><button className="fail"><FiX /> FAIL</button><p>O marcador aparece sobre a página e pode ser incluído na evidência.</p></div>;
  if (panel === "settings") return <><section className="qtsLegacySection"><h3>Contexto atual</h3><p><b>{workspace.projectName}</b><br />{workspace.environmentName} · {workspace.domain}</p></section><section className="qtsLegacySection"><h3>Interface e toolbar</h3><label><input type="checkbox" defaultChecked /> Empurrar o conteúdo do site</label><label><input type="checkbox" defaultChecked /> Fixar evidências e anotações</label></section><button className="qtsDrawerAction" onClick={() => typeof browser !== "undefined" && void browser.runtime.openOptionsPage()}><FiSettings /> Abrir configuração completa</button></>;
  if (panel === "payments") return <><div className="qtsDrawerSearch"><FiSearch /><input placeholder="Buscar método de pagamento" /></div><EmptyCard title="Nenhum método cadastrado" text="Cadastre somente dados de sandbox na configuração local." /></>;
  if (panel === "accounts") return <><div className="qtsDrawerSearch"><FiSearch /><input placeholder="Buscar conta de teste" /></div><EmptyCard title="Nenhuma conta cadastrada" text="Organize contas por país, ambiente e loyalty." /></>;
  if (panel === "errors") return <><div className="qtsErrorCard"><span>500</span><div><b>POST /api/checkout</b><p>Responsável sugerido: Checkout API</p></div></div><div className="qtsErrorCard"><span>503</span><div><b>GET /api/member</b><p>Responsável sugerido: Member API</p></div></div></>;
  if (panel === "observatory") return <><div className="qtsDrawerToolbar"><button className="isActive">All</button><button>Fetch</button><button>XHR</button><button><FiRefreshCw /></button></div>{[["GET", "/api/catalog", "200"], ["POST", "/api/session", "201"], ["GET", "/api/member", "403"]].map(([method, path, status]) => <div className="qtsRequest" key={path}><span className="qtsMethod">{method}</span><strong>{path}</strong><em data-error={Number(status) >= 400}>{status}</em></div>)}</>;
  if (panel === "inspectors") return <EmptyCard title="Waiting for payload" text="Navegue pelo fluxo da aplicação. O inspector ficará disponível quando observar uma resposta compatível." />;
  return <EmptyCard title="RUT Generator" text="A versão segura usará geração sintética local, sem enviar documentos para serviços externos." />;
}

function EmptyCard({ title, text }: { title: string; text: string }) { return <div className="qtsEmptyCard"><FiPackage /><h3>{title}</h3><p>{text}</p></div>; }

function Onboarding({ step, setStep, finish }: { step: number; setStep: (step: number) => void; finish: () => void }) {
  const slides = [
    { icon: <FiGrid />, eyebrow: "BEM-VINDO", title: "Sua bancada de QA fica no topo.", text: "A barra identifica projeto e ambiente, acompanha a URL atual e mantém as ações principais sempre visíveis." },
    { icon: <FiCamera />, eyebrow: "EVIDÊNCIAS", title: "Grave, marque e explique.", text: "Os botões centrais reúnem gravação, screenshot, Pass, Fail, notas e formas — seguindo o fluxo do userscript original." },
    { icon: <FiPackage />, eyebrow: "MENU TOOLS", title: "Todas as ferramentas continuam juntas.", text: "Abra Tools para acessar pagamentos sandbox, contas, status, erros, inspectors, utilitários e configurações." },
    { icon: <FiChevronUp />, eyebrow: "CONTROLE E PRIVACIDADE", title: "A página continua sob seu controle.", text: "A barra empurra o conteúdo para não cobrir o header. Use a seta para ocultá-la. Dados operacionais permanecem locais por padrão." },
  ];
  const current = slides[step] ?? slides[0]!;
  return <div className="qtsOnboardingBackdrop"><section className="qtsOnboarding" role="dialog" aria-modal="true" aria-labelledby="qts-onboarding-title"><button className="qtsOnboardingSkip" onClick={finish}>Pular guia</button><div className="qtsOnboardingVisual">{current.icon}<span>{step + 1}</span></div><small>{current.eyebrow}</small><h2 id="qts-onboarding-title">{current.title}</h2><p>{current.text}</p><div className="qtsOnboardingDots">{slides.map((_, index) => <i className={index === step ? "isActive" : ""} key={index} />)}</div><footer>{step > 0 ? <button className="secondary" onClick={() => setStep(step - 1)}>Voltar</button> : <span />}{step < slides.length - 1 ? <button onClick={() => setStep(step + 1)}>Próximo</button> : <button onClick={finish}>Começar a testar</button>}</footer></section></div>;
}

function compact(value: string, maximum: number) { return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value; }
