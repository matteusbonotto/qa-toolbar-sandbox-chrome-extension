import { useEffect, useRef, useState } from "react";
import {
  FiAlertOctagon, FiAlertTriangle, FiBox, FiCamera, FiCheck, FiChevronDown,
  FiChevronUp, FiCircle, FiClipboard, FiClock, FiCode, FiCreditCard,
  FiDownload, FiGrid, FiHelpCircle, FiMaximize, FiMousePointer, FiPackage,
  FiPause, FiPlay, FiRefreshCw, FiSearch, FiSettings, FiSquare, FiStopCircle,
  FiType, FiUser, FiX,
} from "react-icons/fi";
import { useToolbarStore, type PanelId } from "../store/useToolbarStore";
import { featureEnabled, loadVerifiedCachedEntitlements, type EntitlementCache } from "../services/entitlements";
import { isLocale, isThemeKey, localizeDom, matchEnvironment, translate, type ColorMode, type Locale, type Project, type ThemeKey } from "@qts/domain";
import { urlMatchesAny } from "../services/workspace";
import { addStatusEvidence, type TestStatus } from "../services/evidence";
import { downloadRecording, EvidenceRecorder } from "../services/recording";
import { startNetworkObservatory, type NetworkRecord } from "../services/networkObservatory";
import { ConvertioClient, loadConvertioKey, type ConversionProgress } from "../services/convertio";
import { startPayloadBridge, type PayloadRecord } from "../services/payloadBridge";
import { JsonStudio } from "./JsonStudio";
import { generateRut } from "../services/syntheticData";

type Workspace = { projectName: string; domain: string; environmentName: string };
type WizardConfiguration = { accounts?: { id: string; email: string; inboxUrl?: string; environmentIds?: string[] }[]; payments?: { id: string; brand: string; number?: string; scenario?: string; expiration?: string }[]; inspectorEndpoints?: string[] };
type Annotation = { id: string; kind: "note" | "shape"; text?: string; x: number; y: number };
const ONBOARDING_KEY = "qtsOnboardingV2Complete";
const SPACER_ID = "qts-windowsill-page-spacer";
const PINNABLE_TOOLS = ["observatory", "payments", "accounts", "test-status", "json-studio", "errors", "inspectors", "rut", "settings"] as const;
type PinnableTool = typeof PINNABLE_TOOLS[number];

const inspectorItems = ["Product Inspector", "Member Inspector", "Purchase History", "Prices Inspector", "Movies Inspector", "Showtimes Inspector"];

export function ToolbarApp() {
  const state = useToolbarStore();
  const panelRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const localizedRootRef = useRef<HTMLDivElement>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace>({ projectName: "QA Sandbox", domain: window.location.hostname, environmentName: "LOCAL" });
  const [toast, setToast] = useState("");
  const [entitlements, setEntitlements] = useState<EntitlementCache | null>(null);
  const [configuration, setConfiguration] = useState<WizardConfiguration>({});
  const [theme, setTheme] = useState<ThemeKey>("red");
  const [colorMode, setColorMode] = useState<ColorMode>("dark");
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const t = (key: string) => translate(locale, key);
  useEffect(() => localizedRootRef.current ? localizeDom(localizedRootRef.current, locale) : undefined, [locale]);
  const [currentStatus, setCurrentStatus] = useState<TestStatus | null>(null);
  const recorderRef = useRef(new EvidenceRecorder());
  const [recordingPhase, setRecordingPhase] = useState<"idle" | "recording" | "paused">("idle");
  const [networkRecords, setNetworkRecords] = useState<NetworkRecord[]>([]);
  const lastRecordingRef = useRef<{ blob: Blob; extension: string } | null>(null);
  const conversionAbortRef = useRef<AbortController | null>(null);
  const [conversionProgress, setConversionProgress] = useState<ConversionProgress | null>(null);
  const [payloadRecords, setPayloadRecords] = useState<PayloadRecord[]>([]);
  const [payloadCaptureEnabled, setPayloadCaptureEnabled] = useState(false);
  const [pinnedTools, setPinnedTools] = useState<PinnableTool[]>(["test-status", "observatory"]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [clockFrozen, setClockFrozen] = useState(false);
  const [forcedFetchActive, setForcedFetchActive] = useState(false);
  const payloadBridgeStopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof browser === "undefined") return;
    void browser.storage.local.get(["qtsSetup", "qtsProjects", "qtsActiveProjectId", "qtsWizardData", "qtsAppearance", "qtsLocale", "qtsPinnedTools", ONBOARDING_KEY, "qtsEntitlementCache"]).then((stored) => {
      const projects = (stored.qtsProjects ?? []) as Project[];
      const project = projects.find((item) => item.id === stored.qtsActiveProjectId) ?? projects[0];
      const matched = project ? matchEnvironment(window.location.href, project.environments) : null;
      const wildcardEnvironment = project?.environments.find((environment) => urlMatchesAny(window.location.href, environment.urlPatterns));
      const environment = wildcardEnvironment ?? matched?.environment;
      if (project && environment) {
        setWorkspace({ projectName: project.name, domain: window.location.hostname, environmentName: environment.name });
      } else if (stored.qtsSetup) setWorkspace(stored.qtsSetup as Workspace);
      void loadVerifiedCachedEntitlements().then(setEntitlements);
      if (stored.qtsWizardData) setConfiguration(stored.qtsWizardData as WizardConfiguration);
      const appearance = stored.qtsAppearance as { theme?: unknown; mode?: unknown } | undefined;
      if (isThemeKey(appearance?.theme)) setTheme(appearance.theme);
      if (appearance?.mode === "light" || appearance?.mode === "dark") setColorMode(appearance.mode);
      if (isLocale(stored.qtsLocale)) setLocale(stored.qtsLocale);
      if (Array.isArray(stored.qtsPinnedTools)) setPinnedTools(stored.qtsPinnedTools.filter((item): item is PinnableTool => PINNABLE_TOOLS.includes(item as PinnableTool)));
      if (!stored[ONBOARDING_KEY]) setOnboardingOpen(true);
    });
    const updateStoredPreferences = (changes: Record<string, Browser.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      if (changes.qtsOfflineEntitlementToken?.newValue) void loadVerifiedCachedEntitlements().then(setEntitlements);
      if (isLocale(changes.qtsLocale?.newValue)) setLocale(changes.qtsLocale.newValue);
    };
    browser.storage.onChanged.addListener(updateStoredPreferences);
    return () => browser.storage.onChanged.removeListener(updateStoredPreferences);
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

  useEffect(() => startNetworkObservatory(setNetworkRecords, Number(entitlements?.features["networkHistory.maximum"] ?? 500)), [entitlements?.features]);
  useEffect(() => () => payloadBridgeStopRef.current?.(), []);

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

  const savePinnedTools = (next: PinnableTool[]) => {
    setPinnedTools(next);
    if (typeof browser !== "undefined") void browser.storage.local.set({ qtsPinnedTools: next });
  };
  const togglePinnedTool = (tool: PinnableTool) => savePinnedTools(pinnedTools.includes(tool) ? pinnedTools.filter((item) => item !== tool) : [...pinnedTools, tool]);
  const movePinnedTool = (tool: PinnableTool, direction: -1 | 1) => {
    const index = pinnedTools.indexOf(tool); const target = index + direction;
    if (index < 0 || target < 0 || target >= pinnedTools.length) return;
    const next = [...pinnedTools]; [next[index], next[target]] = [next[target]!, next[index]!]; savePinnedTools(next);
  };
  const addNote = () => {
    if (!featureEnabled(entitlements, "annotations.enabled")) { notify("Anotações estão disponíveis no Pro."); return; }
    const text = window.prompt("Texto da anotação");
    if (!text?.trim()) return;
    setAnnotations((current) => [...current, { id: crypto.randomUUID(), kind: "note", text: text.trim().slice(0, 500), x: 50, y: 30 }]);
  };
  const addShape = () => {
    if (!featureEnabled(entitlements, "annotations.enabled")) { notify("Anotações estão disponíveis no Pro."); return; }
    setAnnotations((current) => [...current, { id: crypto.randomUUID(), kind: "shape", x: 50, y: 40 }]);
  };
  const startClickSpy = () => {
    if (!featureEnabled(entitlements, "inspectors.enabled")) { notify("Click Spy está disponível no Pro."); return; }
    notify("Click Spy ativo: clique no elemento desejado.");
    const inspect = (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      const element = event.target instanceof Element ? event.target : null;
      if (!element) return;
      const selector = cssSelector(element);
      void navigator.clipboard.writeText(selector).catch(() => undefined);
      notify(`Seletor copiado: ${selector.slice(0, 90)}`);
    };
    document.addEventListener("click", inspect, { capture: true, once: true });
  };
  const toggleFrozenClock = async () => {
    try {
      const next = !clockFrozen;
      await browser.runtime.sendMessage({ type: "qts:toggle-frozen-clock", frozenAt: next ? Date.now() : null });
      setClockFrozen(next); notify(next ? "Relógio da página congelado. Clique novamente para restaurar." : "Relógio da página restaurado.");
    } catch { notify("O navegador não permitiu controlar o relógio nesta página."); }
  };
  const toggleForcedFetch = async () => {
    if (!featureEnabled(entitlements, "httpControls.enabled")) { notify("HTTP Controls é exclusivo do Scale."); return; }
    try {
      if (forcedFetchActive) { await browser.runtime.sendMessage({ type: "qts:set-forced-fetch", pattern: null, status: null }); setForcedFetchActive(false); notify("Resposta Fetch forçada desativada."); return; }
      const pattern = window.prompt("Trecho da URL Fetch que será interceptada nesta aba"); if (!pattern?.trim()) return;
      const status = Number(window.prompt("Status HTTP entre 400 e 599", "500")); if (!Number.isInteger(status) || status < 400 || status > 599) { notify("Informe um status HTTP entre 400 e 599."); return; }
      await browser.runtime.sendMessage({ type: "qts:set-forced-fetch", pattern: pattern.trim(), status }); setForcedFetchActive(true); notify(`Fetch contendo “${pattern.trim()}” responderá ${status}.`);
    } catch { notify("Não foi possível instalar o controle HTTP nesta página."); }
  };

  const markStatus = async (status: TestStatus) => {
    await addStatusEvidence(status, window.location.href);
    setCurrentStatus(status);
    notify(`Status ${status.toUpperCase()} salvo na evidência desta URL.`);
  };

  const captureScreenshot = async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: "qts:capture-visible-tab" }) as { dataUrl?: string };
      if (!response?.dataUrl?.startsWith("data:image/png")) throw new Error("capture_failed");
      const link = document.createElement("a"); link.href = response.dataUrl; link.download = `qa-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}.png`; link.click();
      notify("Screenshot salvo como PNG.");
    } catch { notify("Não foi possível capturar esta aba. Confirme a permissão do site."); }
  };

  const toggleRecording = async () => {
    try {
      if (recordingPhase === "idle") {
        const format = await recorderRef.current.start("mp4");
        setRecordingPhase("recording"); if (!state.captureEnabled) state.toggleCapture();
        notify(`Gravação iniciada em ${format.label}.`);
      } else if (recordingPhase === "recording") { recorderRef.current.pause(); setRecordingPhase("paused"); notify("Gravação pausada."); }
      else { recorderRef.current.resume(); setRecordingPhase("recording"); notify("Gravação retomada."); }
    } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível iniciar a gravação."); }
  };

  const stopRecording = async () => {
    try { const result = await recorderRef.current.stop(); lastRecordingRef.current = { blob: result.blob, extension: result.format.extension }; downloadRecording(result.blob, result.format.extension); setRecordingPhase("idle"); if (state.captureEnabled) state.toggleCapture(); notify(`Evidência ${result.format.extension.toUpperCase()} salva. Use GIF para converter se desejar.`); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível encerrar a gravação."); }
  };

  const convertLastRecording = async () => {
    if (conversionAbortRef.current) { conversionAbortRef.current.abort(); conversionAbortRef.current = null; setConversionProgress(null); notify("Conversão cancelada."); return; }
    const recording = lastRecordingRef.current; if (!recording) { notify("Grave uma evidência antes de solicitar o GIF."); return; }
    const key = await loadConvertioKey(); if (!key) { notify("Configure sua chave em Convertio e GIF nas opções da extensão."); return; }
    if (!await browser.permissions.contains({ origins: ["https://api.convertio.co/*"] }) && !await browser.permissions.request({ origins: ["https://api.convertio.co/*"] })) { notify("Permissão da API Convertio não concedida."); return; }
    const controller = new AbortController(); conversionAbortRef.current = controller;
    try { const gif = await new ConvertioClient(key).convertToGif(recording.blob, `evidence.${recording.extension}`, controller.signal, setConversionProgress); downloadRecording(gif, "gif"); notify("GIF convertido e salvo."); }
    catch (error) { if (!controller.signal.aborted) notify(error instanceof Error ? error.message : "Conversão indisponível."); }
    finally { conversionAbortRef.current = null; setConversionProgress(null); }
  };

  const enablePayloadCapture = async () => {
    if (payloadCaptureEnabled) { payloadBridgeStopRef.current?.(); payloadBridgeStopRef.current = null; setPayloadCaptureEnabled(false); notify("Captura de payloads desativada."); return; }
    try { payloadBridgeStopRef.current = await startPayloadBridge((record) => setPayloadRecords((current) => [record, ...current].slice(0, 200))); setPayloadCaptureEnabled(true); notify("Captura de payloads ativada nesta página."); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível ativar a captura."); }
  };

  if (!state.isExpanded) {
    return <button id="qtsEnvironmentRestoreButton" className="isVisible" data-theme={theme} data-mode={colorMode} onClick={state.toggleExpanded} title={t("toolbar.restore")}><FiChevronDown /></button>;
  }

  return (
    <div ref={localizedRootRef} className="qtsHost qtsWindowsillHost" data-theme={theme} data-mode={colorMode} onMouseDown={(event) => event.stopPropagation()}>
      <div id="qtsEnvironmentWindowsill" role="toolbar" aria-label="QA Toolbar Sandbox">
        <div className="qtsEnvironmentLeftContent">
          <span className="qtsEnvironmentFlag" aria-hidden="true">🧪</span>
          <span className="qtsEnvironmentCountry" title={workspace.projectName}>{compact(workspace.projectName, 16)}</span>
          <span className="qtsEnvironmentDivider">|</span>
          <span className="qtsEnvironmentName">{workspace.environmentName}</span>
          <span className="qtsEnvironmentDivider qtsDesktopOnly">|</span>
          <span id="qtsEvidenceUrl" className="qtsEvidenceUrl qtsDesktopOnly" title={window.location.href}>{compact(window.location.host + window.location.pathname, 34)}</span>
        </div>

        <div className="qtsEvidenceCenter" data-recording={state.captureEnabled}>{state.captureEnabled ? "● RECORDING · 00:00" : `${entitlements?.plan.name?.toUpperCase() ?? "STARTER"} · ${t("toolbar.ready")}`}</div>

        <div className="qtsEnvironmentRightContent">
          <span id="qtsEvidenceTotalTime" className="qtsEvidenceTotalTime">00:00</span>
          <span className="qtsEnvironmentDivider qtsDesktopOnly">|</span>
          <QaButton title={recordingPhase === "recording" ? "Pausar gravação" : recordingPhase === "paused" ? "Retomar gravação" : "Iniciar gravação"} label={recordingPhase === "recording" ? "Pause local capture" : recordingPhase === "paused" ? "Resume local capture" : "Start local capture"} onClick={() => featureEnabled(entitlements, "recording.enabled") ? void toggleRecording() : notify("Gravação está no Pro. Clique no ícone da extensão para liberar.")} active={recordingPhase !== "idle"}>{recordingPhase === "recording" ? <FiPause /> : <FiPlay />}</QaButton>
          <QaButton title="Parar gravação" label="Stop evidence recording" onClick={() => void stopRecording()} disabled={recordingPhase === "idle"}><FiStopCircle /></QaButton>
          <QaButton title={conversionProgress ? "Cancelar conversão GIF" : "Converter última gravação para GIF"} label={conversionProgress ? "Cancel GIF conversion" : "Convert last recording to GIF"} onClick={() => void convertLastRecording()} active={Boolean(conversionProgress)}><FiDownload /></QaButton>
          <QaButton title={t("toolbar.screenshot")} label={t("toolbar.screenshot")} onClick={() => void captureScreenshot()}><FiCamera /></QaButton>
          <span className="qtsEnvironmentDivider qtsDesktopOnly">|</span>
          <QaButton className="qtsEnvironmentPassButton" title="Adicionar marcador Pass" label="Place Pass marker" onClick={() => void markStatus("pass")}><FiCheck /></QaButton>
          <QaButton className="qtsEnvironmentFailButton" title="Adicionar marcador Fail" label="Place Fail marker" onClick={() => void markStatus("fail")}><FiX /></QaButton>
          <QaButton title="Adicionar nota de texto" label="Add text note" onClick={addNote}><FiType /></QaButton>
          <QaButton title="Desenhar forma" label="Draw shape" onClick={addShape}><FiMaximize /></QaButton>
          <QaButton className="qtsLegacyToolbarLabButton qtsWideOnly" title="Inspecionar elemento clicável" label="Inspect clickable element" onClick={startClickSpy}><FiMousePointer /></QaButton>
          <QaButton className="qtsLegacyToolbarLabButton qtsWideOnly" title={clockFrozen ? "Restaurar relógio" : "Congelar relógio"} label={clockFrozen ? "Restore clock" : "Freeze clock"} active={clockFrozen} onClick={() => void toggleFrozenClock()}><FiClock /></QaButton>
          <QaButton className="qtsLegacyToolbarLabButton qtsWideOnly" title={forcedFetchActive ? "Desativar resposta Fetch forçada" : "Forçar resposta Fetch"} label="Configure forced HTTP response" active={forcedFetchActive} onClick={() => void toggleForcedFetch()}><FiAlertOctagon /></QaButton>

          <div className="qtsPinnedTools" aria-label="Ferramentas fixadas">{pinnedTools.slice(0, 4).map((tool) => <QaButton key={tool} title={`Abrir ${toolLabel(tool)}`} label={`Abrir ${toolLabel(tool)}`} onClick={() => openTool(tool)}>{toolIcon(tool)}</QaButton>)}</div>

          <div className="qtsEnvironmentToolsWrapper" ref={toolsRef}>
            <button id="qtsEnvironmentToolsButton" className="qtsEnvironmentToolsButton" type="button" title={t("toolbar.tools")} aria-expanded={toolsOpen} onClick={() => setToolsOpen((value) => !value)}><FiGrid /><span>{t("toolbar.tools")}</span></button>
            <div id="qtsEnvironmentToolsMenu" className={`qtsEnvironmentToolsMenu ${toolsOpen ? "isOpen" : ""}`}>
              <MenuButton icon={<FiPackage />} label="Network Observatory" onClick={() => openTool("observatory")} pinned={pinnedTools.includes("observatory")} onPin={() => togglePinnedTool("observatory")} />
              <MenuButton icon={<FiCreditCard />} label="Payment Methods" onClick={() => openTool("payments")} pinned={pinnedTools.includes("payments")} onPin={() => togglePinnedTool("payments")} />
              <MenuButton icon={<FiUser />} label="Test Accounts" onClick={() => openTool("accounts")} pinned={pinnedTools.includes("accounts")} onPin={() => togglePinnedTool("accounts")} />
              <MenuButton icon={<FiClipboard />} label="Test Status" onClick={() => openTool("test-status")} pinned={pinnedTools.includes("test-status")} onPin={() => togglePinnedTool("test-status")} />
              <MenuButton icon={<FiCode />} label="JSON Studio" onClick={() => openTool("json-studio")} pinned={pinnedTools.includes("json-studio")} onPin={() => togglePinnedTool("json-studio")} />
              <MenuButton icon={<FiAlertTriangle />} label="Errors" badge={String(networkRecords.filter((record) => record.status !== null && record.status >= 400).length)} onClick={() => openTool("errors")} pinned={pinnedTools.includes("errors")} onPin={() => togglePinnedTool("errors")} />
              <details className="qtsLegacyInspectorToolsGroup">
                <summary><span><FiCode /> Inspectors</span><FiChevronDown /></summary>
                {inspectorItems.map((label) => <button type="button" key={label} onClick={() => openTool("inspectors")}><FiBox /><span>{label}</span><small>waiting payload</small></button>)}
              </details>
              <MenuButton icon={<FiCircle />} label="RUT Generator" onClick={() => openTool("rut")} pinned={pinnedTools.includes("rut")} onPin={() => togglePinnedTool("rut")} />
              <MenuButton icon={<FiSettings />} label="Settings" onClick={() => openTool("settings")} pinned={pinnedTools.includes("settings")} onPin={() => togglePinnedTool("settings")} />
              <MenuButton icon={<FiHelpCircle />} label="Guia rápido" onClick={() => { setToolsOpen(false); setOnboardingStep(0); setOnboardingOpen(true); }} />
            </div>
          </div>

          <button id="qtsEnvironmentMinimizeButton" className="qtsEnvironmentActionButton qtsEnvironmentMinimizeButton" type="button" title={t("toolbar.hide")} onClick={state.toggleExpanded}><FiChevronUp /></button>
        </div>
      </div>

      {currentStatus && <div className={`qtsStatusMarker ${currentStatus}`} role="status">{currentStatus.toUpperCase()}</div>}
      <div className="qtsAnnotationLayer" aria-live="polite">{annotations.map((annotation) => <div key={annotation.id} className={`qtsAnnotation ${annotation.kind}`} style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}>{annotation.text && <span>{annotation.text}</span>}<button aria-label="Remover anotação" onClick={() => setAnnotations((current) => current.filter((item) => item.id !== annotation.id))}><FiX /></button></div>)}</div>
      {state.activePanel && <ToolDrawer panel={state.activePanel} close={state.closePanel} panelRef={panelRef} workspace={workspace} configuration={configuration} onStatus={markStatus} networkRecords={networkRecords} payloadRecords={payloadRecords} payloadCaptureEnabled={payloadCaptureEnabled} togglePayloadCapture={enablePayloadCapture} pinnedTools={pinnedTools} togglePinnedTool={togglePinnedTool} movePinnedTool={movePinnedTool} />}
      {onboardingOpen && <Onboarding step={onboardingStep} setStep={setOnboardingStep} finish={finishOnboarding} />}
      {conversionProgress && <div className="qtsToast" role="status">{conversionProgress.stage} — {conversionProgress.percent}%</div>}
      {toast && <div className="qtsToast qtsToast" role="status">{toast}</div>}
    </div>
  );
}

function QaButton({ title, label, onClick, children, className = "", active = false, disabled = false }: { title: string; label: string; onClick: () => void; children: React.ReactNode; className?: string; active?: boolean; disabled?: boolean }) {
  return <button type="button" className={`qtsEnvironmentActionButton ${className} ${active ? "isActive" : ""}`} title={title} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function MenuButton({ icon, label, onClick, badge, pinned, onPin }: { icon: React.ReactNode; label: string; onClick: () => void; badge?: string; pinned?: boolean; onPin?: () => void }) {
  return <div className="qtsToolMenuRow"><button className="qtsEnvironmentToolsMenuItem" type="button" title={label === "Network Observatory" ? "Observatory" : undefined} onClick={onClick}><span className="qtsLegacyToolMenuContent"><span className="qtsLegacyToolMenuLabel">{icon}<span>{label}</span></span>{badge && <span className="qtsLegacyErrorsCount">{badge}</span>}</span></button>{onPin && <button type="button" className="qtsPinButton" aria-label={`${pinned ? "Desafixar" : "Fixar"} ${label}`} onClick={onPin}>{pinned ? "●" : "○"}</button>}</div>;
}

function ToolDrawer({ panel, close, panelRef, workspace, configuration, onStatus, networkRecords, payloadRecords, payloadCaptureEnabled, togglePayloadCapture, pinnedTools, togglePinnedTool, movePinnedTool }: { panel: Exclude<PanelId, null>; close: () => void; panelRef: React.RefObject<HTMLElement | null>; workspace: Workspace; configuration: WizardConfiguration; onStatus: (status: TestStatus) => Promise<void>; networkRecords: NetworkRecord[]; payloadRecords: PayloadRecord[]; payloadCaptureEnabled: boolean; togglePayloadCapture: () => Promise<void>; pinnedTools: PinnableTool[]; togglePinnedTool: (tool: PinnableTool) => void; movePinnedTool: (tool: PinnableTool, direction: -1 | 1) => void }) {
  const content: Record<Exclude<PanelId, null>, { eyebrow: string; title: string; description: string }> = {
    observatory: { eyebrow: "QA NETWORK OBSERVATORY", title: "Requests da página", description: "Histórico local, erros HTTP e payloads capturados com consentimento." },
    payments: { eyebrow: "QA SANDBOX", title: "Payment Methods", description: "Dados de pagamento de teste do contexto atual." },
    accounts: { eyebrow: "QA ACCOUNTS", title: "Test Accounts", description: "Contas de teste por ambiente, armazenadas somente neste navegador." },
    "test-status": { eyebrow: "QA EVIDENCE", title: "Test Status", description: "Marque a evidência atual como aprovada ou reprovada." },
    errors: { eyebrow: "QA ERROR MONITOR", title: "HTTP errors 500+", description: "Sinais capturados e provável responsabilidade técnica." },
    rut: { eyebrow: "QA UTILITY", title: "RUT Generator", description: "Gerador local configurável para dados sintéticos." },
    settings: { eyebrow: "QA CONFIGURATION", title: "Settings", description: "Toolbar, contexto, ferramentas fixadas e privacidade." },
    inspectors: { eyebrow: "QA API INSPECTOR", title: "Inspector payload", description: "Aguardando um payload compatível nesta rota." },
    "json-studio": { eyebrow: "QA JSON STUDIO", title: "JSON Studio", description: "Formate, busque, compare, copie e exporte payloads capturados." },
  };
  const current = content[panel];
  return <aside id="qtsLegacyProductDrawer" className="qtsPanel isOpen" ref={panelRef} tabIndex={-1} aria-label={`${panel} panel`}>
    <header className="qtsPaymentDrawerHeader"><div className="qtsPaymentDrawerHeaderLeft"><div className="qtsPaymentDrawerEyebrow">{current.eyebrow}</div><h2 className="qtsPaymentDrawerTitle">{current.title}</h2><p className="qtsPaymentDrawerSubtitle">{current.description}</p></div><button className="qtsPaymentDrawerCloseButton" onClick={close} aria-label="Close panel"><FiX /></button></header>
    <div className="qtsLegacyDrawerBody"><DrawerContent panel={panel} workspace={workspace} configuration={configuration} onStatus={onStatus} networkRecords={networkRecords} payloadRecords={payloadRecords} payloadCaptureEnabled={payloadCaptureEnabled} togglePayloadCapture={togglePayloadCapture} pinnedTools={pinnedTools} togglePinnedTool={togglePinnedTool} movePinnedTool={movePinnedTool} /></div>
  </aside>;
}

function DrawerContent({ panel, workspace, configuration, onStatus, networkRecords, payloadRecords, payloadCaptureEnabled, togglePayloadCapture, pinnedTools, togglePinnedTool, movePinnedTool }: { panel: Exclude<PanelId, null>; workspace: Workspace; configuration: WizardConfiguration; onStatus: (status: TestStatus) => Promise<void>; networkRecords: NetworkRecord[]; payloadRecords: PayloadRecord[]; payloadCaptureEnabled: boolean; togglePayloadCapture: () => Promise<void>; pinnedTools: PinnableTool[]; togglePinnedTool: (tool: PinnableTool) => void; movePinnedTool: (tool: PinnableTool, direction: -1 | 1) => void }) {
  if (panel === "test-status") return <div className="qtsStatusChooser"><button className="pass" onClick={() => void onStatus("pass")}><FiCheck /> PASS</button><button className="fail" onClick={() => void onStatus("fail")}><FiX /> FAIL</button><button onClick={() => void onStatus("block")}><FiStopCircle /> BLOCK</button><button onClick={() => void onStatus("limitation")}><FiAlertTriangle /> LIMITATION</button><p>O status fica salvo localmente com URL e data e pode ser incluído na evidência.</p></div>;
  if (panel === "settings") return <><section className="qtsLegacySection"><h3>Contexto atual</h3><p><b>{workspace.projectName}</b><br />{workspace.environmentName} · {workspace.domain}</p></section><section className="qtsLegacySection"><h3>Itens fixados</h3><div className="qtsPinnedEditor">{pinnedTools.map((tool, index) => <div key={tool}><span>{toolIcon(tool)} {toolLabel(tool)}</span><button disabled={index === 0} onClick={() => movePinnedTool(tool, -1)} aria-label={`Mover ${toolLabel(tool)} para a esquerda`}>←</button><button disabled={index === pinnedTools.length - 1} onClick={() => movePinnedTool(tool, 1)} aria-label={`Mover ${toolLabel(tool)} para a direita`}>→</button><button onClick={() => togglePinnedTool(tool)} aria-label={`Desafixar ${toolLabel(tool)}`}><FiX /></button></div>)}</div></section><button className="qtsDrawerAction" onClick={() => typeof browser !== "undefined" && void browser.runtime.openOptionsPage()}><FiSettings /> Abrir configuração completa</button></>;
  if (panel === "payments") return <><div className="qtsDrawerSearch"><FiSearch /><input placeholder="Buscar método de pagamento" /></div>{configuration.payments?.length ? configuration.payments.map((payment) => <div className="qtsErrorCard" key={payment.id}><FiCreditCard /><div><b>{payment.brand} · final {payment.number?.slice(-4) || "----"}</b><p>{payment.scenario || "Sem cenário"} {payment.expiration ? `· expira ${payment.expiration}` : ""}</p></div></div>) : <EmptyCard title="Nenhum método cadastrado" text="Cadastre somente dados de sandbox na configuração local." />}</>;
  if (panel === "accounts") return <><div className="qtsDrawerSearch"><FiSearch /><input placeholder="Buscar conta de teste" /></div>{configuration.accounts?.length ? configuration.accounts.map((account) => <div className="qtsErrorCard" key={account.id}><FiUser /><div><b>{account.email}</b><p>{account.inboxUrl || `${account.environmentIds?.length ?? 0} ambiente(s)`}</p></div></div>) : <EmptyCard title="Nenhuma conta cadastrada" text="Organize contas por ambiente e imagem opcional." />}</>;
  if (panel === "errors") { const errors = networkRecords.filter((record) => record.status !== null && record.status >= 400); return errors.length ? <>{errors.map((record) => <div className="qtsErrorCard" key={record.id}><span>{record.status}</span><div><b>{record.method} {safePath(record.url)}</b><p>{record.kind.toUpperCase()} · {record.durationMs} ms</p></div></div>)}</> : <EmptyCard title="Nenhum erro HTTP observado" text="O painel mostra apenas erros reais expostos pelo navegador nesta página." />; }
  if (panel === "observatory") return <><div className="qtsDrawerToolbar"><button className="isActive">All ({networkRecords.length})</button><button>Fetch ({networkRecords.filter((record) => record.kind === "fetch").length})</button><button>XHR ({networkRecords.filter((record) => record.kind === "xhr").length})</button><button onClick={() => void togglePayloadCapture()}>{payloadCaptureEnabled ? "Parar payloads" : "Capturar payloads"}</button></div>{networkRecords.length ? networkRecords.map((record) => <div className="qtsRequest" key={record.id}><span className="qtsMethod">{record.kind.toUpperCase()}</span><strong title={record.url}>{safePath(record.url)}</strong><em data-error={record.status !== null && record.status >= 400}>{record.status ?? `${record.durationMs}ms`}</em></div>) : <EmptyCard title="Nenhuma request observada" text="Navegue pela página para preencher o histórico real de recursos, Fetch e XHR." />}</>;
  if (panel === "inspectors") {
    const endpoints = configuration.inspectorEndpoints ?? [];
    const matches = payloadRecords.filter((record) => endpoints.some((endpoint) => record.url.toLowerCase().includes(endpoint.toLowerCase())));
    return <>
      <button className="qtsDrawerAction" onClick={() => void togglePayloadCapture()}>{payloadCaptureEnabled ? "Desativar captura consentida" : "Ativar captura consentida"}</button>
      {matches.length > 0
        ? matches.map((record) => <section className="qtsLegacySection" key={record.id}><h3>{record.method} {safePath(record.url)} · {record.status}</h3><pre>{JSON.stringify(record.payload, null, 2)}</pre></section>)
        : <EmptyCard title="Aguardando payload compatível" text={payloadCaptureEnabled ? "Navegue pelo fluxo. Apenas endpoints configurados aparecerão aqui." : "Ative a captura consentida para observar respostas Fetch/XHR configuradas."} />}
    </>;
  }
  if (panel === "json-studio") return <JsonStudio records={payloadRecords} />;
  if (panel === "rut") return <RutGenerator />;
  return <EmptyCard title="Ferramenta indisponível" text="Abra a configuração completa para gerenciar este recurso." />;
}

function RutGenerator() {
  const [rut, setRut] = useState(() => generateRut());
  return <section className="qtsLegacySection"><h3>Documento sintético local</h3><p>Use apenas em ambientes de sandbox. Nenhum dado é enviado pela rede.</p><output className="qtsSyntheticValue">{rut}</output><div className="qtsDrawerToolbar"><button onClick={() => setRut(generateRut())}><FiRefreshCw /> Gerar outro</button><button onClick={() => void navigator.clipboard.writeText(rut)}><FiClipboard /> Copiar</button></div></section>;
}

function EmptyCard({ title, text }: { title: string; text: string }) { return <div className="qtsEmptyCard"><FiPackage /><h3>{title}</h3><p>{text}</p></div>; }

function toolLabel(tool: PinnableTool): string { return ({ observatory: "Network Observatory", payments: "Payment Methods", accounts: "Test Accounts", "test-status": "Test Status", "json-studio": "JSON Studio", errors: "Errors", inspectors: "Inspectors", rut: "RUT Generator", settings: "Settings" } satisfies Record<PinnableTool, string>)[tool]; }
function toolIcon(tool: PinnableTool): React.ReactNode { const icons: Record<PinnableTool, React.ReactNode> = { observatory: <FiPackage />, payments: <FiCreditCard />, accounts: <FiUser />, "test-status": <FiClipboard />, "json-studio": <FiCode />, errors: <FiAlertTriangle />, inspectors: <FiBox />, rut: <FiCircle />, settings: <FiSettings /> }; return icons[tool]; }

function safePath(value: string): string { try { const url = new URL(value); return `${url.pathname}${url.search}`.slice(0, 120); } catch { return value.slice(0, 120); } }
function cssSelector(element: Element): string { if (element.id) return `#${CSS.escape(element.id)}`; const parts: string[] = []; let current: Element | null = element; while (current && parts.length < 6) { let part = current.tagName.toLowerCase(); const stableClass = [...current.classList].find((name) => !name.startsWith("qts") && /^[a-zA-Z][\w-]*$/.test(name)); if (stableClass) part += `.${CSS.escape(stableClass)}`; else if (current.parentElement) { const siblings = [...current.parentElement.children].filter((item) => item.tagName === current!.tagName); if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`; } parts.unshift(part); current = current.parentElement; } return parts.join(" > "); }

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
