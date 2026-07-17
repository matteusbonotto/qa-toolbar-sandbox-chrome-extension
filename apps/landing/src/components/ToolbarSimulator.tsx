import { useEffect, useMemo, useRef, useState } from "react";
import { simulatorWorkspace } from "../data/simulatorData";
import { SegmentedControl } from "./SegmentedControl";
import { MockToolbar, type PlacementMode, type RecordState } from "./MockToolbar";
import { MockPage, type MarkerItem, type NoteItem, type ShapeItem } from "./MockPage";
import { useI18n } from "../i18n/I18nProvider";
import type { Dictionary } from "../i18n/translations";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `sim-${idCounter}`;
}

const STATUS_OPTIONS = [
  { key: "pass", icon: "✓", color: "#179153" },
  { key: "fail", icon: "✕", color: "#c70e0e" },
  { key: "blocked", icon: "⛔", color: "#a34b05" },
  { key: "limitation", icon: "△", color: "#5b21b6" },
] as const;

function statusLabel(t: Dictionary, key: (typeof STATUS_OPTIONS)[number]["key"]): string {
  switch (key) {
    case "pass":
      return t.mockToolbar.statusPass;
    case "fail":
      return t.mockToolbar.statusFail;
    case "blocked":
      return t.mockToolbar.statusBlocked;
    case "limitation":
      return t.mockToolbar.statusLimitation;
  }
}

export function ToolbarSimulator() {
  const { t } = useI18n();
  const [clientId, setClientId] = useState(simulatorWorkspace[0]!.id);

  const client = useMemo(
    () => simulatorWorkspace.find((c) => c.id === clientId) ?? simulatorWorkspace[0]!,
    [clientId],
  );

  const [projectId, setProjectId] = useState(client.projects[0]!.id);
  const project = useMemo(
    () => client.projects.find((p) => p.id === projectId) ?? client.projects[0]!,
    [client, projectId],
  );

  const [productId, setProductId] = useState(project.products[0]!.id);
  const product = useMemo(
    () => project.products.find((p) => p.id === productId) ?? project.products[0]!,
    [project, productId],
  );

  const [environmentId, setEnvironmentId] = useState(product.environments[0]!.id);
  const environment = useMemo(
    () => product.environments.find((e) => e.id === environmentId) ?? product.environments[0]!,
    [product, environmentId],
  );

  function handleClientChange(nextClientId: string) {
    const nextClient = simulatorWorkspace.find((c) => c.id === nextClientId);
    if (!nextClient) return;
    const nextProject = nextClient.projects[0]!;
    const nextProduct = nextProject.products[0]!;
    setClientId(nextClientId);
    setProjectId(nextProject.id);
    setProductId(nextProduct.id);
    setEnvironmentId(nextProduct.environments[0]!.id);
  }

  function handleProjectChange(nextProjectId: string) {
    const nextProject = client.projects.find((p) => p.id === nextProjectId);
    if (!nextProject) return;
    const nextProduct = nextProject.products[0]!;
    setProjectId(nextProjectId);
    setProductId(nextProduct.id);
    setEnvironmentId(nextProduct.environments[0]!.id);
  }

  function handleProductChange(nextProductId: string) {
    const nextProduct = project.products.find((p) => p.id === nextProductId);
    if (!nextProduct) return;
    setProductId(nextProductId);
    setEnvironmentId(nextProduct.environments[0]!.id);
  }

  // Demo interaction state (mirrors the real toolbar's behaviour, scoped to the mock page).
  const [placementMode, setPlacementMode] = useState<PlacementMode>(null);
  const [markers, setMarkers] = useState<MarkerItem[]>([]);
  const [shapes, setShapes] = useState<ShapeItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [screenshotFlash, setScreenshotFlash] = useState(false);
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [testStatusOpen, setTestStatusOpen] = useState(false);
  const [resultOverlay, setResultOverlay] = useState<{ icon: string; color: string; label: string } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [clickSpyActive, setClickSpyActive] = useState(false);
  const [freezeClockActive, setFreezeClockActive] = useState(false);
  const [inspectorsCount, setInspectorsCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }

  useEffect(() => {
    if (recordState !== "recording") return;
    const id = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [recordState]);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  function handleSelectPlacement(kind: "pass" | "fail" | "shape") {
    setPlacementMode((current) => (current === kind ? null : kind));
  }

  function handlePageClick(x: number, y: number) {
    if (placementMode === "pass" || placementMode === "fail") {
      setMarkers((prev) => [...prev, { id: nextId(), kind: placementMode, x, y }]);
    } else if (placementMode === "shape") {
      setShapes((prev) => [...prev, { id: nextId(), x, y }]);
    }
    setPlacementMode(null);
  }

  function handleAddNote() {
    setNotes((prev) => [...prev, { id: nextId(), x: 40 + prev.length * 12, y: 40 + prev.length * 12, text: "", editing: true }]);
  }

  function handleNoteSave(id: string, text: string) {
    setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, text: text.trim() || t.mockToolbar.newNote, editing: false } : note)));
  }

  function handleNoteEdit(id: string) {
    setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, editing: true } : note)));
  }

  function handleMove(kind: "marker" | "shape" | "note", id: string, x: number, y: number) {
    if (kind === "marker") setMarkers((prev) => prev.map((item) => (item.id === id ? { ...item, x, y } : item)));
    else if (kind === "shape") setShapes((prev) => prev.map((item) => (item.id === id ? { ...item, x, y } : item)));
    else setNotes((prev) => prev.map((item) => (item.id === id ? { ...item, x, y } : item)));
  }

  function handleRemove(kind: "marker" | "shape" | "note", id: string) {
    if (kind === "marker") setMarkers((prev) => prev.filter((item) => item.id !== id));
    else if (kind === "shape") setShapes((prev) => prev.filter((item) => item.id !== id));
    else setNotes((prev) => prev.filter((item) => item.id !== id));
  }

  function handleClearAll() {
    setMarkers([]);
    setShapes([]);
    setNotes([]);
  }

  function handleScreenshot() {
    setScreenshotFlash(true);
    window.setTimeout(() => setScreenshotFlash(false), 250);
    showToast(t.toast.screenshotCaptured);
  }

  function handleToggleRecord() {
    if (recordState === "recording") {
      showToast(t.toast.recorded(formatElapsed(recordSeconds)));
      setRecordSeconds(0);
      setRecordState("idle");
    } else {
      setRecordState("recording");
    }
  }

  function handleToggleClickSpy() {
    const next = !clickSpyActive;
    setClickSpyActive(next);
    showToast(next ? t.toast.clickSpyOn : t.toast.clickSpyOff);
  }

  function handleToggleFreezeClock() {
    const next = !freezeClockActive;
    setFreezeClockActive(next);
    showToast(next ? t.toast.freezeOn : t.toast.freezeOff);
  }

  function handleForceHttp() {
    showToast(t.toast.forceHttp);
  }

  function handleSimulateRequest() {
    setInspectorsCount((c) => c + 1);
    showToast(t.toast.requestCaptured);
  }

  function handleOpenInspectors() {
    showToast(inspectorsCount > 0 ? t.toast.inspectorsCount(inspectorsCount) : t.toast.inspectorsEmpty);
    setToolsOpen(false);
  }

  function handleOpenJsonStudio() {
    showToast(t.toast.jsonStudio);
    setToolsOpen(false);
  }

  function handleOpenBreakpoint() {
    showToast(t.toast.breakpointViewer);
    setToolsOpen(false);
  }

  function handleSelectStatus(key: (typeof STATUS_OPTIONS)[number]["key"]) {
    const option = STATUS_OPTIONS.find((item) => item.key === key)!;
    const label = statusLabel(t, key);
    setTestStatusOpen(false);
    setResultOverlay({ icon: option.icon, color: option.color, label });
    window.setTimeout(() => setResultOverlay(null), 1600);
    showToast(t.toast.statusRecorded(label));
  }

  return (
    <div className="qts-simulator">
      <div className="qts-simulator-controls">
        <p className="qts-simulator-hint">{t.simulator.hint}</p>
        <SegmentedControl
          label={t.simulator.client}
          value={client.id}
          onChange={handleClientChange}
          options={simulatorWorkspace.map((c) => ({ id: c.id, label: c.name }))}
        />
        <SegmentedControl
          label={t.simulator.project}
          value={project.id}
          onChange={handleProjectChange}
          options={client.projects.map((p) => ({ id: p.id, label: p.name }))}
        />
        <SegmentedControl
          label={t.simulator.product}
          value={product.id}
          onChange={handleProductChange}
          options={project.products.map((p) => ({ id: p.id, label: p.name }))}
        />
        <SegmentedControl
          label={t.simulator.environment}
          value={environment.id}
          onChange={setEnvironmentId}
          options={product.environments.map((e) => ({ id: e.id, label: e.name, swatch: e.color }))}
        />
      </div>

      <div className="qts-mock-device-stage">
      <div
        className={`qts-mock-browser${product.viewport === "mobile" ? " is-mobile" : ""}`}
        data-viewport={product.viewport ?? "desktop"}
      >
        <div className="qts-mock-browser-chrome">
          <div className="qts-mock-browser-dots">
            <span />
            <span />
            <span />
          </div>
          <div className="qts-mock-browser-address">
            <span className="qts-mock-browser-lock">🔒</span>
            {environment.url}
          </div>
        </div>

        {minimized ? (
          <button type="button" className="qts-mock-restore" title={t.mockToolbar.restore} onClick={() => setMinimized(false)}>
            ▼
          </button>
        ) : (
          <MockToolbar
            client={client}
            project={project}
            product={product}
            environmentName={environment.name}
            color={environment.color}
            placementMode={placementMode}
            onSelectPlacement={handleSelectPlacement}
            onAddNote={handleAddNote}
            hasAnnotations={markers.length + shapes.length + notes.length > 0}
            onClearAll={handleClearAll}
            onScreenshot={handleScreenshot}
            recordState={recordState}
            recordElapsed={formatElapsed(recordSeconds)}
            onToggleRecord={handleToggleRecord}
            toolsOpen={toolsOpen}
            onToggleTools={() => setToolsOpen((v) => !v)}
            clickSpyActive={clickSpyActive}
            onToggleClickSpy={handleToggleClickSpy}
            freezeClockActive={freezeClockActive}
            onToggleFreezeClock={handleToggleFreezeClock}
            onForceHttp={handleForceHttp}
            inspectorsCount={inspectorsCount}
            onOpenInspectors={handleOpenInspectors}
            onOpenJsonStudio={handleOpenJsonStudio}
            onOpenBreakpoint={handleOpenBreakpoint}
            testStatusOpen={testStatusOpen}
            onToggleTestStatus={() => setTestStatusOpen((v) => !v)}
            onMinimize={() => setMinimized(true)}
          />
        )}

        {testStatusOpen ? (
          <div className="qts-status-popover">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="qts-status-option"
                style={{ "--qts-status-color": option.color } as React.CSSProperties}
                onClick={() => handleSelectStatus(option.key)}
              >
                <span className="qts-status-icon">{option.icon}</span>
                <span>{statusLabel(t, option.key)}</span>
              </button>
            ))}
          </div>
        ) : null}

        <MockPage
          color={environment.color}
          placementMode={placementMode}
          markers={markers}
          shapes={shapes}
          notes={notes}
          onPageClick={handlePageClick}
          onMove={handleMove}
          onRemove={handleRemove}
          onNoteSave={handleNoteSave}
          onNoteEdit={handleNoteEdit}
          clickSpyActive={clickSpyActive}
          freezeClockActive={freezeClockActive}
          onSimulateRequest={handleSimulateRequest}
        />
        {screenshotFlash ? <div className="qts-mock-flash" /> : null}
        {resultOverlay ? (
          <div className="qts-result-overlay" style={{ "--qts-status-color": resultOverlay.color } as React.CSSProperties}>
            <div className="qts-result-icon">{resultOverlay.icon}</div>
            <div className="qts-result-text">{resultOverlay.label}</div>
          </div>
        ) : null}
        {toast ? <div className="qts-mock-toast">{toast}</div> : null}
      </div>
      </div>
    </div>
  );
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
