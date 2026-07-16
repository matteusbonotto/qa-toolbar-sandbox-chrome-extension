const { getWorkspace, onStorageChanged, STORAGE_KEYS } = window.QTS_STORAGE;

const TOOLBAR_HEIGHT = 34;
const HOST_ID = "qts-toolbar-host";
const SPACER_ID = "qts-toolbar-spacer";

const state = {
  workspace: null,
  environment: null,
  minimized: false,
  shadowRoot: null,
  placementMode: null, // null | "pass" | "fail" | "shape"
  clickSpyActive: false,
  clockFrozen: false,
  forceHttpActive: false,
  networkHistory: [],
};

const FORCE_HTTP_STATUSES = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503];

const TEST_STATUS_OPTIONS = [
  { key: "pass", label: "Pass", icon: "✓", color: "#179153" },
  { key: "fail", label: "Fail", icon: "✕", color: "#c70e0e" },
  { key: "blocked", label: "Blocked", icon: "⛔", color: "#a34b05" },
  { key: "limitation", label: "Limitation", icon: "△", color: "#5b21b6" },
];
const TEST_STATUS_HISTORY_KEY = "qtsTestStatusHistoryV1";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wildcardToRegExp(pattern) {
  const escaped = String(pattern || "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesAnyPattern(patterns, href) {
  if (!Array.isArray(patterns) || !patterns.length) return false;
  return patterns.some((pattern) => {
    try {
      return wildcardToRegExp(pattern).test(href);
    } catch {
      return false;
    }
  });
}

function findActiveEnvironment(workspace) {
  const href = window.location.href;
  return (workspace.environments || []).find((environment) => matchesAnyPattern(environment.urlPatterns, href)) ?? null;
}

function findById(collection, id) {
  return (collection || []).find((item) => item.id === id) ?? null;
}

function contrastTextColor(hexColor) {
  const hex = String(hexColor || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

function getCurrentHeight() {
  return state.minimized ? 0 : TOOLBAR_HEIGHT;
}

function setSpacerHeight() {
  document.documentElement.style.setProperty("--qts-toolbar-height", `${getCurrentHeight()}px`);
}

function buildBreadcrumb(workspace, environment) {
  if (!environment) {
    return { label: "Nenhum ambiente configurado para esta URL", color: "#3a3a3a", text: "#ffffff" };
  }
  const client = findById(workspace.clients, environment.clientId);
  const project = findById(workspace.projects, environment.projectId);
  const product = findById(workspace.products, environment.productId);
  const parts = [client?.name, project?.name, product?.name].filter(Boolean);
  const color = environment.color || "#ef3340";
  return {
    label: parts.length ? `${parts.join(" · ")} — ${environment.name}` : environment.name,
    color,
    text: contrastTextColor(color),
  };
}

function render() {
  const root = state.shadowRoot;
  if (!root) return;

  const breadcrumb = buildBreadcrumb(state.workspace, state.environment);
  const bar = root.getElementById("bar");
  bar.style.setProperty("--qts-bg", breadcrumb.color);
  bar.style.setProperty("--qts-text", breadcrumb.text);
  bar.classList.toggle("isMinimized", state.minimized);

  root.getElementById("breadcrumb").textContent = breadcrumb.label;
  root.getElementById("restoreButton").classList.toggle("isVisible", state.minimized);

  setSpacerHeight();
}

function buildShadowHost() {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      #bar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
        height: ${TOOLBAR_HEIGHT}px; display: flex; align-items: center; justify-content: space-between;
        gap: 10px; padding: 0 12px; background: var(--qts-bg, #ef3340); color: var(--qts-text, #fff);
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 2px 10px rgba(0,0,0,.25); transition: transform 160ms ease;
      }
      #bar.isMinimized { transform: translateY(-110%); }
      #left, #right { display: flex; align-items: center; gap: 6px; min-width: 0; }
      #breadcrumb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 30vw; }
      button {
        all: unset; box-sizing: border-box; cursor: pointer; height: 24px; padding: 0 9px;
        display: inline-flex; align-items: center; gap: 5px; border-radius: 7px;
        background: rgba(0,0,0,.2); color: inherit; font: inherit; font-size: 11px; font-weight: 800;
        border: 1px solid rgba(255,255,255,.35); white-space: nowrap;
      }
      button:hover { background: rgba(0,0,0,.32); }
      button.iconOnly { width: 26px; padding: 0; justify-content: center; }
      button.isActive { background: #ffd700 !important; color: #111 !important; border-color: #fff !important; }
      #clearAllButton.isHidden { display: none; }
      #restoreButton {
        all: unset; box-sizing: border-box; position: fixed; top: 6px; right: 8px; z-index: 2147483647;
        width: 30px; height: 26px; display: none; align-items: center; justify-content: center;
        border: 1px solid rgba(255,215,0,.55); border-radius: 9px; background: #0b0b0b; color: #ffd700;
        font: 900 13px sans-serif; cursor: pointer; box-shadow: 0 8px 18px rgba(0,0,0,.34);
      }
      #restoreButton.isVisible { display: inline-flex; }
      .brand { opacity: .85; font-weight: 900; letter-spacing: .04em; }

      #toolsWrapper { position: relative; }
      #toolsMenu {
        position: absolute; top: 30px; right: 0; width: 220px; padding: 6px; display: grid; gap: 4px;
        border-radius: 10px; background: #0c0c0c; border: 1px solid rgba(255,255,255,.18);
        box-shadow: 0 16px 40px rgba(0,0,0,.45); opacity: 0; visibility: hidden; transform: translateY(-6px);
        transition: opacity 140ms ease, transform 140ms ease, visibility 140ms; color: #fff; z-index: 10;
      }
      #toolsMenu.isOpen { opacity: 1; visibility: visible; transform: translateY(0); }
      #toolsMenu button {
        width: 100%; justify-content: flex-start; background: #171717; border-color: #2c2c2c; font-size: 11px;
      }
      #toolsMenu button:hover { background: #232323; border-color: #ffd700; }
      #toolsMenu button.isActive { background: #ffd700 !important; color: #111 !important; }
      .qts-badge { margin-left: auto; padding: 1px 6px; border-radius: 999px; background: #b20808; color: #fff; font-size: 9px; }
    </style>
    <div id="bar" role="toolbar" aria-label="QA Toolbar Sandbox">
      <div id="left">
        <span class="brand">QA Sandbox</span>
        <span id="breadcrumb"></span>
      </div>
      <div id="right">
        <button id="testStatusButton" type="button" title="Registrar status do teste">Test Status</button>
        <button id="passButton" class="iconOnly" type="button" title="Marcador Pass">✓</button>
        <button id="failButton" class="iconOnly" type="button" title="Marcador Fail">✕</button>
        <button id="noteButton" class="iconOnly" type="button" title="Nota de texto">T</button>
        <button id="shapeButton" class="iconOnly" type="button" title="Desenhar forma">▭</button>
        <button id="clearAllButton" class="isHidden" type="button" title="Remover todas as anotações">Limpar</button>
        <button id="screenshotButton" class="iconOnly" type="button" title="Capturar screenshot">📷</button>
        <div id="toolsWrapper">
          <button id="toolsButton" type="button" title="Ferramentas">Tools ▾</button>
          <div id="toolsMenu" role="menu">
            <button type="button" id="clickSpyMenuItem" role="menuitem">🖱 Click Spy</button>
            <button type="button" id="freezeClockMenuItem" role="menuitem">⏸ Freeze Clock</button>
            <button type="button" id="forceHttpMenuItem" role="menuitem">⚠ Force HTTP</button>
            <button type="button" id="inspectorsMenuItem" role="menuitem">{ } Inspectors<span id="inspectorsBadge" class="qts-badge" style="display:none">0</span></button>
            <button type="button" id="jsonStudioMenuItem" role="menuitem">🧪 JSON Studio</button>
            <button type="button" id="breakpointMenuItem" role="menuitem">📐 Breakpoint Viewer</button>
          </div>
        </div>
        <button id="settingsButton" class="iconOnly" type="button" title="Configurações">⚙</button>
        <button id="minimizeButton" class="iconOnly" type="button" title="Minimizar">▲</button>
      </div>
    </div>
    <button id="restoreButton" type="button" title="Mostrar QA Toolbar Sandbox">▼</button>
  `;

  shadow.getElementById("settingsButton").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "qts:open-options" });
  });
  shadow.getElementById("minimizeButton").addEventListener("click", () => setMinimized(true));
  shadow.getElementById("restoreButton").addEventListener("click", () => setMinimized(false));
  shadow.getElementById("testStatusButton").addEventListener("click", () => openTestStatusModal());
  shadow.getElementById("passButton").addEventListener("click", (event) => enablePlacementMode("pass", event.currentTarget));
  shadow.getElementById("failButton").addEventListener("click", (event) => enablePlacementMode("fail", event.currentTarget));
  shadow.getElementById("noteButton").addEventListener("click", () => addFloatingTextNote());
  shadow.getElementById("shapeButton").addEventListener("click", (event) => enablePlacementMode("shape", event.currentTarget));
  shadow.getElementById("clearAllButton").addEventListener("click", () => clearAllFloatingItems());
  shadow.getElementById("screenshotButton").addEventListener("click", () => captureScreenshot());

  shadow.getElementById("toolsButton").addEventListener("click", (event) => {
    event.stopPropagation();
    shadow.getElementById("toolsMenu").classList.toggle("isOpen");
  });
  shadow.addEventListener("click", () => shadow.getElementById("toolsMenu").classList.remove("isOpen"));
  shadow.getElementById("toolsMenu").addEventListener("click", (event) => event.stopPropagation());

  shadow.getElementById("clickSpyMenuItem").addEventListener("click", () => { toggleClickSpy(); closeToolsMenu(); });
  shadow.getElementById("freezeClockMenuItem").addEventListener("click", () => { toggleFreezeClock(); closeToolsMenu(); });
  shadow.getElementById("forceHttpMenuItem").addEventListener("click", () => { openForceHttpDialog(); closeToolsMenu(); });
  shadow.getElementById("inspectorsMenuItem").addEventListener("click", () => { openInspectorsDrawer(); closeToolsMenu(); });
  shadow.getElementById("jsonStudioMenuItem").addEventListener("click", () => { openJsonStudio(); closeToolsMenu(); });
  shadow.getElementById("breakpointMenuItem").addEventListener("click", () => { openBreakpointViewer(); closeToolsMenu(); });

  return { host, shadow };
}

function closeToolsMenu() {
  state.shadowRoot?.getElementById("toolsMenu")?.classList.remove("isOpen");
}

function setMinimized(value) {
  state.minimized = value;
  render();
}

function isToolbarHealthy() {
  const host = document.documentElement.querySelector(`#${HOST_ID}`);
  const spacer = document.body?.querySelector(`#${SPACER_ID}`);
  return Boolean(host?.isConnected && host.shadowRoot?.getElementById("bar") && (!document.body || spacer?.isConnected));
}

function mountToolbar() {
  const { host, shadow } = buildShadowHost();
  state.shadowRoot = shadow;
  document.documentElement.appendChild(host);

  const spacer = document.createElement("div");
  spacer.id = SPACER_ID;
  if (document.body) document.body.insertBefore(spacer, document.body.firstChild);

  render();
}

function scheduleRepair() {
  if (scheduleRepair.timer) return;
  scheduleRepair.timer = window.setTimeout(() => {
    scheduleRepair.timer = null;
    if (!isToolbarHealthy()) mountToolbar();
  }, 80);
}

function installIntegrityMonitor() {
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) =>
      [...mutation.removedNodes].some((node) => node.nodeType === 1 && (node.id === HOST_ID || node.id === SPACER_ID)),
    );
    if (relevant || !isToolbarHealthy()) scheduleRepair();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(() => {
    if (!isToolbarHealthy()) scheduleRepair();
  }, 1500);
}

// ---------------------------------------------------------------------------
// Test Status: Pass/Fail/Blocked/Limitation, a full-screen result overlay and
// a local history entry (URL + timestamp) for evidence purposes.
// ---------------------------------------------------------------------------

function closeTestStatusModal() {
  document.getElementById("qts-test-status-modal")?.remove();
}

function openTestStatusModal() {
  closeTestStatusModal();
  const modal = document.createElement("div");
  modal.id = "qts-test-status-modal";
  modal.className = "qts-modal-backdrop";
  modal.innerHTML = `
    <div class="qts-modal">
      <header><h2>Test Status</h2><button type="button" data-close>×</button></header>
      <div class="qts-status-grid">
        ${TEST_STATUS_OPTIONS.map((option) => `
          <button type="button" class="qts-status-option" data-status="${option.key}" style="--qts-status-color:${option.color}">
            <span class="qts-status-icon">${option.icon}</span><span>${escapeHtml(option.label)}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("isOpen"));
  modal.querySelector("[data-close]").addEventListener("click", closeTestStatusModal);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeTestStatusModal(); });
  modal.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.status;
      const option = TEST_STATUS_OPTIONS.find((item) => item.key === key);
      closeTestStatusModal();
      showResultOverlay(option);
      void recordTestStatus(option);
    });
  });
}

function showResultOverlay(option) {
  document.getElementById("qts-result-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "qts-result-overlay";
  overlay.className = "qts-result-overlay";
  overlay.style.setProperty("--qts-status-color", option.color);
  overlay.innerHTML = `<div class="qts-result-icon">${option.icon}</div><div class="qts-result-text">${escapeHtml(option.label)}</div>`;
  document.body.appendChild(overlay);
  window.setTimeout(() => overlay.remove(), 2100);
}

async function recordTestStatus(option) {
  const stored = await chrome.storage.local.get(TEST_STATUS_HISTORY_KEY);
  const history = Array.isArray(stored[TEST_STATUS_HISTORY_KEY]) ? stored[TEST_STATUS_HISTORY_KEY] : [];
  history.unshift({ status: option.key, label: option.label, url: window.location.href, at: new Date().toISOString() });
  await chrome.storage.local.set({ [TEST_STATUS_HISTORY_KEY]: history.slice(0, 200) });
}

// ---------------------------------------------------------------------------
// Floating annotations: Pass/Fail markers, text notes and shapes, drawn
// directly on the host page (light DOM) so they can sit over arbitrary page
// content — the toolbar bar itself stays inside the Shadow Root, but these
// need to overlay whatever the tester is pointing at.
// ---------------------------------------------------------------------------

function cancelPlacementMode() {
  if (!state.placementMode) return;
  document.body.classList.remove("qts-placement-mode");
  state.shadowRoot?.querySelectorAll("button.isActive").forEach((button) => button.classList.remove("isActive"));
  state.placementMode = null;
  document.removeEventListener("click", handlePlacementClick, true);
  document.removeEventListener("mousedown", handleShapeMouseDown, true);
  document.removeEventListener("keydown", handlePlacementEscape, true);
}

function handlePlacementEscape(event) {
  if (event.key === "Escape") cancelPlacementMode();
}

function enablePlacementMode(mode, triggerButton) {
  cancelPlacementMode();
  state.placementMode = mode;
  document.body.classList.add("qts-placement-mode");
  triggerButton.classList.add("isActive");
  document.addEventListener("keydown", handlePlacementEscape, true);
  if (mode === "shape") document.addEventListener("mousedown", handleShapeMouseDown, true);
  else document.addEventListener("click", handlePlacementClick, true);
}

function isInsideToolbarUi(target) {
  return Boolean(target.closest?.(`#${HOST_ID}, .qts-floating-item, .qts-modal-backdrop`));
}

function handlePlacementClick(event) {
  if (isInsideToolbarUi(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.placementMode === "pass" || state.placementMode === "fail") {
    placeMarker(state.placementMode, event.clientX, event.clientY);
  }
  cancelPlacementMode();
}

function placeMarker(kind, clientX, clientY) {
  const size = 52;
  const marker = document.createElement("div");
  marker.className = "qts-floating-item qts-marker";
  marker.style.left = `${Math.max(4, clientX - size / 2)}px`;
  marker.style.top = `${Math.max(getCurrentHeight() + 4, clientY - size / 2)}px`;
  marker.innerHTML = `
    <div class="qts-marker-body ${kind === "fail" ? "isFail" : "isPass"}" data-drag-handle>${kind === "fail" ? "✕" : "✓"}</div>
    <button type="button" class="qts-remove-btn" title="Remover">×</button>
  `;
  document.body.appendChild(marker);
  makeDraggable(marker, marker.querySelector("[data-drag-handle]"));
  marker.querySelector(".qts-remove-btn").addEventListener("click", () => { marker.remove(); updateClearAllVisibility(); });
  updateClearAllVisibility();
}

function addFloatingTextNote() {
  const note = document.createElement("div");
  note.className = "qts-floating-item qts-note isEditing";
  note.style.left = `${Math.max(12, window.innerWidth - 320)}px`;
  note.style.top = `${getCurrentHeight() + 24}px`;
  note.innerHTML = `
    <div class="qts-editor-head" data-drag-handle><span>Nota de texto</span><button type="button" class="qts-remove-btn" title="Remover">×</button></div>
    <div class="qts-editor-body">
      <textarea placeholder="Escreva aqui..."></textarea>
      <div class="qts-editor-actions"><button type="button" data-save>Salvar</button></div>
    </div>
  `;
  document.body.appendChild(note);
  makeDraggable(note, note.querySelector("[data-drag-handle]"));
  note.querySelector(".qts-remove-btn").addEventListener("click", () => { note.remove(); updateClearAllVisibility(); });
  note.querySelector("[data-save]").addEventListener("click", () => {
    const text = note.querySelector("textarea").value.trim() || "Nota";
    note.className = "qts-floating-item qts-note isSaved";
    note.innerHTML = `
      <div class="qts-note-content" data-drag-handle>${escapeHtml(text)}</div>
      <button type="button" class="qts-edit-btn" title="Editar">✎</button>
      <button type="button" class="qts-remove-btn" title="Remover">×</button>
    `;
    makeDraggable(note, note.querySelector("[data-drag-handle]"));
    note.querySelector(".qts-remove-btn").addEventListener("click", () => { note.remove(); updateClearAllVisibility(); });
    note.querySelector(".qts-edit-btn").addEventListener("click", () => reopenTextNoteEditor(note, text));
  });
  updateClearAllVisibility();
}

function reopenTextNoteEditor(note, currentText) {
  note.className = "qts-floating-item qts-note isEditing";
  note.innerHTML = `
    <div class="qts-editor-head" data-drag-handle><span>Nota de texto</span><button type="button" class="qts-remove-btn" title="Remover">×</button></div>
    <div class="qts-editor-body">
      <textarea placeholder="Escreva aqui...">${escapeHtml(currentText)}</textarea>
      <div class="qts-editor-actions"><button type="button" data-save>Salvar</button></div>
    </div>
  `;
  makeDraggable(note, note.querySelector("[data-drag-handle]"));
  note.querySelector(".qts-remove-btn").addEventListener("click", () => { note.remove(); updateClearAllVisibility(); });
  note.querySelector("[data-save]").addEventListener("click", () => {
    const text = note.querySelector("textarea").value.trim() || "Nota";
    note.className = "qts-floating-item qts-note isSaved";
    note.innerHTML = `
      <div class="qts-note-content" data-drag-handle>${escapeHtml(text)}</div>
      <button type="button" class="qts-edit-btn" title="Editar">✎</button>
      <button type="button" class="qts-remove-btn" title="Remover">×</button>
    `;
    makeDraggable(note, note.querySelector("[data-drag-handle]"));
    note.querySelector(".qts-remove-btn").addEventListener("click", () => { note.remove(); updateClearAllVisibility(); });
    note.querySelector(".qts-edit-btn").addEventListener("click", () => reopenTextNoteEditor(note, text));
  });
}

function handleShapeMouseDown(event) {
  if (event.button !== 0 || isInsideToolbarUi(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const preview = document.createElement("div");
  preview.className = "qts-shape-preview";
  preview.style.left = `${startX}px`;
  preview.style.top = `${startY}px`;
  document.body.appendChild(preview);

  const handleMove = (moveEvent) => {
    const left = Math.min(startX, moveEvent.clientX);
    const top = Math.min(startY, moveEvent.clientY);
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    preview.style.width = `${Math.abs(moveEvent.clientX - startX)}px`;
    preview.style.height = `${Math.abs(moveEvent.clientY - startY)}px`;
  };
  const handleUp = (upEvent) => {
    document.removeEventListener("mousemove", handleMove, true);
    document.removeEventListener("mouseup", handleUp, true);
    const left = Math.min(startX, upEvent.clientX);
    const top = Math.min(startY, upEvent.clientY);
    const width = Math.max(40, Math.abs(upEvent.clientX - startX));
    const height = Math.max(40, Math.abs(upEvent.clientY - startY));
    preview.remove();
    placeShape(left, top, width, height);
    cancelPlacementMode();
  };
  document.addEventListener("mousemove", handleMove, true);
  document.addEventListener("mouseup", handleUp, true);
}

function placeShape(left, top, width, height) {
  const shape = document.createElement("div");
  shape.className = "qts-floating-item qts-shape";
  shape.style.left = `${left}px`;
  shape.style.top = `${top}px`;
  shape.style.width = `${width}px`;
  shape.style.height = `${height}px`;
  shape.innerHTML = `
    <div class="qts-shape-box" data-drag-handle></div>
    <button type="button" class="qts-remove-btn" title="Remover">×</button>
  `;
  document.body.appendChild(shape);
  makeDraggable(shape, shape.querySelector("[data-drag-handle]"));
  shape.querySelector(".qts-remove-btn").addEventListener("click", () => { shape.remove(); updateClearAllVisibility(); });
  updateClearAllVisibility();
}

function makeDraggable(element, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    dragging = true;
    const rect = element.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    event.preventDefault();
  });
  document.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    element.style.left = `${Math.max(0, event.clientX - offsetX)}px`;
    element.style.top = `${Math.max(getCurrentHeight(), event.clientY - offsetY)}px`;
  });
  document.addEventListener("mouseup", () => { dragging = false; });
}

function clearAllFloatingItems() {
  document.querySelectorAll(".qts-floating-item").forEach((item) => item.remove());
  updateClearAllVisibility();
}

function updateClearAllVisibility() {
  const hasItems = document.querySelectorAll(".qts-floating-item").length > 0;
  state.shadowRoot?.getElementById("clearAllButton")?.classList.toggle("isHidden", !hasItems);
}

// ---------------------------------------------------------------------------
// Screenshot: delegates to the background service worker, which is the only
// context allowed to call chrome.tabs.captureVisibleTab.
// ---------------------------------------------------------------------------

function captureScreenshot() {
  chrome.runtime.sendMessage({ type: "qts:capture-visible-tab" }, (response) => {
    if (!response?.ok) {
      console.error("QA Toolbar Sandbox: screenshot failed", response?.error);
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = response.dataUrl;
    anchor.download = `qa-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    anchor.click();
  });
}

// ---------------------------------------------------------------------------
// Generic drawer/modal helpers (rendered inside the Shadow Root — unlike
// markers/notes/shapes, tool panels don't need to sit at page click
// coordinates, so they don't need the light-DOM !important escape hatch).
// ---------------------------------------------------------------------------

function ensureDrawerHost() {
  let drawerHost = state.shadowRoot.getElementById("drawerHost");
  if (!drawerHost) {
    drawerHost = document.createElement("div");
    drawerHost.id = "drawerHost";
    state.shadowRoot.appendChild(drawerHost);
  }
  return drawerHost;
}

function drawerStyles() {
  return `
    .qts-drawer-backdrop {
      position: fixed; inset: 0; z-index: 2147483647; display: flex; justify-content: flex-end;
      background: rgba(0,0,0,.5); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .qts-drawer {
      width: min(440px, 92vw); height: 100%; background: #0b0b0b; color: #fff; border-left: 2px solid #b20808;
      display: flex; flex-direction: column; box-shadow: -18px 0 40px rgba(0,0,0,.4);
    }
    .qts-drawer.isWide { width: min(900px, 96vw); }
    .qts-drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #262626; }
    .qts-drawer-head h2 { margin: 0; font-size: 15px; }
    .qts-drawer-head button { width: 30px; height: 30px; border: 0; border-radius: 8px; background: #b20808; color: #fff; font-size: 18px; cursor: pointer; }
    .qts-drawer-body { flex: 1; overflow: auto; padding: 14px 16px; }
    .qts-drawer input, .qts-drawer select, .qts-drawer textarea {
      width: 100%; padding: 8px 10px; border: 1px solid #2c2c2c; border-radius: 8px; background: #141414; color: #fff; font: inherit;
    }
    .qts-drawer button.action { height: 32px; padding: 0 12px; border: 1px solid #333; border-radius: 8px; background: #1c1c1c; color: #fff; cursor: pointer; font-weight: 700; }
    .qts-drawer button.action.primary { background: #b20808; border-color: #b20808; }
    .qts-empty { padding: 24px; text-align: center; color: #888; border: 1px dashed #333; border-radius: 10px; }
    .qts-net-item { padding: 8px 10px; margin-bottom: 6px; border: 1px solid #262626; border-radius: 8px; background: #131313; cursor: pointer; }
    .qts-net-item b { color: #ffd700; }
    .qts-net-item small { display: block; color: #888; word-break: break-all; }
    .qts-json-tree { font: 11px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  `;
}

function openDrawer({ title, wide = false, bodyHtml, onReady }) {
  const drawerHost = ensureDrawerHost();
  drawerHost.innerHTML = `<style>${drawerStyles()}</style>
    <div class="qts-drawer-backdrop" id="drawerBackdrop">
      <div class="qts-drawer ${wide ? "isWide" : ""}">
        <div class="qts-drawer-head"><h2>${escapeHtml(title)}</h2><button type="button" id="drawerClose">×</button></div>
        <div class="qts-drawer-body" id="drawerBody">${bodyHtml}</div>
      </div>
    </div>`;
  drawerHost.querySelector("#drawerClose").addEventListener("click", closeDrawer);
  drawerHost.querySelector("#drawerBackdrop").addEventListener("click", (event) => { if (event.target.id === "drawerBackdrop") closeDrawer(); });
  onReady?.(drawerHost.querySelector("#drawerBody"));
}

function closeDrawer() {
  const drawerHost = state.shadowRoot?.getElementById("drawerHost");
  if (drawerHost) drawerHost.innerHTML = "";
}

function renderJsonTree(value, depth = 0) {
  if (value === null) return `<span style="color:#888">null</span>`;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[<br>${value.map((item) => `${"&nbsp;".repeat((depth + 1) * 2)}${renderJsonTree(item, depth + 1)}`).join(",<br>")}<br>${"&nbsp;".repeat(depth * 2)}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (!keys.length) return "{}";
    return `{<br>${keys.map((key) => `${"&nbsp;".repeat((depth + 1) * 2)}<span style="color:#ffd700">${escapeHtml(key)}</span>: ${renderJsonTree(value[key], depth + 1)}`).join(",<br>")}<br>${"&nbsp;".repeat(depth * 2)}}`;
  }
  if (typeof value === "string") return `<span style="color:#8ad1ff">${escapeHtml(JSON.stringify(value))}</span>`;
  return `<span style="color:#9bffb0">${escapeHtml(String(value))}</span>`;
}

// ---------------------------------------------------------------------------
// Click Spy: highlight the next clickable element and report what it is,
// instead of actually navigating/submitting — a safe way to inspect intent.
// ---------------------------------------------------------------------------

let clickSpyCleanup = null;

function toggleClickSpy() {
  if (state.clickSpyActive) { deactivateClickSpy(); return; }
  state.clickSpyActive = true;
  state.shadowRoot.getElementById("clickSpyMenuItem").classList.add("isActive");
  let hovered = null;
  const overHandler = (event) => {
    const target = event.target.closest("a,button,[role=button],input,select,textarea");
    if (target === hovered || isInsideToolbarUi(event.target)) return;
    hovered?.classList.remove("qts-spy-hover");
    hovered = target;
    hovered?.classList.add("qts-spy-hover");
  };
  const clickHandler = (event) => {
    if (isInsideToolbarUi(event.target)) return;
    const target = event.target.closest("a,button,[role=button],input,select,textarea") || event.target;
    event.preventDefault();
    event.stopPropagation();
    reportClickSpyTarget(target);
    deactivateClickSpy();
  };
  const escHandler = (event) => { if (event.key === "Escape") deactivateClickSpy(); };
  document.addEventListener("mouseover", overHandler, true);
  document.addEventListener("click", clickHandler, true);
  document.addEventListener("keydown", escHandler, true);
  clickSpyCleanup = () => {
    hovered?.classList.remove("qts-spy-hover");
    document.removeEventListener("mouseover", overHandler, true);
    document.removeEventListener("click", clickHandler, true);
    document.removeEventListener("keydown", escHandler, true);
  };
}

function deactivateClickSpy() {
  state.clickSpyActive = false;
  state.shadowRoot?.getElementById("clickSpyMenuItem")?.classList.remove("isActive");
  clickSpyCleanup?.();
  clickSpyCleanup = null;
}

function reportClickSpyTarget(target) {
  const anchor = target.closest?.("a[href]");
  const description = [
    ["Elemento", target.tagName.toLowerCase()],
    ["Texto", target.textContent?.trim().slice(0, 80) || "—"],
    ["Destino", anchor ? new URL(anchor.getAttribute("href"), window.location.href).href : "—"],
    ["Tipo", anchor ? "Navegação" : target.tagName === "BUTTON" || target.getAttribute("type") === "submit" ? "Ação/submit" : "Controle de formulário"],
  ];
  openDrawer({
    title: "Click Spy — resultado",
    bodyHtml: `<div style="display:grid;gap:10px">${description.map(([label, value]) => `
      <div><div style="color:#ffd700;font-size:10px;text-transform:uppercase;font-weight:800">${escapeHtml(label)}</div><div style="word-break:break-all">${escapeHtml(value)}</div></div>
    `).join("")}</div>`,
  });
}

// ---------------------------------------------------------------------------
// Freeze Clock and Force HTTP: both act on the page's real Date/fetch, which
// only pagebridge.js (MAIN world) can see — the isolated-world toolbar only
// dispatches/listens for CustomEvents on document.
// ---------------------------------------------------------------------------

function toggleFreezeClock() {
  document.dispatchEvent(new CustomEvent("qts:freeze-clock-command", { detail: { freeze: !state.clockFrozen } }));
}

function openForceHttpDialog() {
  openDrawer({
    title: "Force HTTP — forçar próxima resposta",
    bodyHtml: `
      <p style="color:#999;margin-top:0">Escolha um status para a próxima requisição JSON (fetch). A regra é usada uma única vez.</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${FORCE_HTTP_STATUSES.map((status) => `<button type="button" class="action" data-status="${status}">HTTP ${status}</button>`).join("")}
      </div>
      <div style="margin-top:14px"><button type="button" class="action" id="forceHttpClear">Cancelar regra ativa</button></div>
    `,
    onReady: (body) => {
      body.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("qts:force-http-command", { detail: { status: Number(button.dataset.status) } }));
        closeDrawer();
      }));
      body.querySelector("#forceHttpClear").addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("qts:force-http-command", { detail: { status: null } }));
        closeDrawer();
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Inspectors: a live list of JSON API responses captured by pagebridge.js.
// Fully generic/declarative — no product-specific endpoint names hardcoded.
// ---------------------------------------------------------------------------

function handleNetworkCaptured(entry) {
  state.networkHistory.unshift(entry);
  if (state.networkHistory.length > 150) state.networkHistory.length = 150;
  const badge = state.shadowRoot?.getElementById("inspectorsBadge");
  if (badge) {
    badge.textContent = String(state.networkHistory.length);
    badge.style.display = state.networkHistory.length ? "inline-flex" : "none";
  }
  if (state.shadowRoot?.getElementById("drawerHost")?.dataset.view === "inspectors") renderInspectorsList();
}

function renderInspectorsList() {
  const body = state.shadowRoot.getElementById("drawerBody");
  if (!body) return;
  if (!state.networkHistory.length) {
    body.innerHTML = `<div class="qts-empty">Nenhuma resposta JSON capturada ainda nesta página.</div>`;
    return;
  }
  body.innerHTML = state.networkHistory.map((entry, index) => `
    <div class="qts-net-item" data-index="${index}">
      <b>${entry.status || "—"}</b> ${escapeHtml(entry.method)} <small>${escapeHtml(entry.url)}</small>
    </div>
  `).join("");
  body.querySelectorAll("[data-index]").forEach((row) => row.addEventListener("click", () => {
    const entry = state.networkHistory[Number(row.dataset.index)];
    openDrawer({
      title: `${entry.method} ${entry.status}`,
      wide: true,
      bodyHtml: `<div class="qts-json-tree">${renderJsonTree(entry.payload)}</div>`,
    });
  }));
}

function openInspectorsDrawer() {
  openDrawer({ title: "Inspectors", wide: true, bodyHtml: "" });
  state.shadowRoot.getElementById("drawerHost").dataset.view = "inspectors";
  renderInspectorsList();
}

// ---------------------------------------------------------------------------
// JSON Studio: format/compact/copy any pasted JSON.
// ---------------------------------------------------------------------------

function openJsonStudio() {
  openDrawer({
    title: "JSON Studio",
    wide: true,
    bodyHtml: `
      <textarea id="jsonInput" rows="16" placeholder="Cole um JSON aqui..." style="font:12px ui-monospace,Consolas,monospace"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="button" class="action primary" id="jsonFormat">Formatar</button>
        <button type="button" class="action" id="jsonCompact">Compactar</button>
        <button type="button" class="action" id="jsonCopy">Copiar</button>
      </div>
      <p id="jsonError" style="color:#ff6b6b"></p>
    `,
    onReady: (body) => {
      const input = body.querySelector("#jsonInput");
      const errorEl = body.querySelector("#jsonError");
      const run = (transform) => {
        try {
          const parsed = JSON.parse(input.value);
          input.value = transform(parsed);
          errorEl.textContent = "";
        } catch (error) {
          errorEl.textContent = `JSON inválido: ${error.message}`;
        }
      };
      body.querySelector("#jsonFormat").addEventListener("click", () => run((parsed) => JSON.stringify(parsed, null, 2)));
      body.querySelector("#jsonCompact").addEventListener("click", () => run((parsed) => JSON.stringify(parsed)));
      body.querySelector("#jsonCopy").addEventListener("click", () => navigator.clipboard.writeText(input.value).catch(() => {}));
    },
  });
}

// ---------------------------------------------------------------------------
// Breakpoint Viewer: mobile/desktop side-by-side preview via iframes.
// ---------------------------------------------------------------------------

function openBreakpointViewer() {
  const initialUrl = window.location.href;
  openDrawer({
    title: "Breakpoint Viewer",
    wide: true,
    bodyHtml: `
      <input id="bpUrl" type="url" value="${escapeHtml(initialUrl)}" style="margin-bottom:10px" />
      <div style="display:grid;grid-template-columns:375px 1fr;gap:12px">
        <div>
          <small style="color:#888">Mobile · 375×667</small>
          <iframe id="bpMobile" style="width:375px;height:667px;border:1px solid #333;border-radius:8px;background:#fff"></iframe>
        </div>
        <div>
          <small style="color:#888">Desktop · 100%</small>
          <iframe id="bpDesktop" style="width:100%;height:667px;border:1px solid #333;border-radius:8px;background:#fff"></iframe>
        </div>
      </div>
    `,
    onReady: (body) => {
      const urlInput = body.querySelector("#bpUrl");
      const load = () => {
        const url = urlInput.value.trim();
        if (!/^https?:\/\//i.test(url)) return;
        body.querySelector("#bpMobile").src = url;
        body.querySelector("#bpDesktop").src = url;
      };
      urlInput.addEventListener("change", load);
      load();
    },
  });
}

document.addEventListener("qts:network-captured", (event) => handleNetworkCaptured(event.detail));
document.addEventListener("qts:freeze-clock-state", (event) => {
  state.clockFrozen = Boolean(event.detail?.frozen);
  state.shadowRoot?.getElementById("freezeClockMenuItem")?.classList.toggle("isActive", state.clockFrozen);
});
document.addEventListener("qts:force-http-state", (event) => {
  state.forceHttpActive = Boolean(event.detail?.active);
  state.shadowRoot?.getElementById("forceHttpMenuItem")?.classList.toggle("isActive", state.forceHttpActive);
});

async function boot() {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    return;
  }

  state.workspace = await getWorkspace();
  state.environment = findActiveEnvironment(state.workspace);

  mountToolbar();
  installIntegrityMonitor();

  onStorageChanged(async (changes) => {
    if (!changes[STORAGE_KEYS.workspace]) return;
    state.workspace = await getWorkspace();
    state.environment = findActiveEnvironment(state.workspace);
    render();
  });
}

void boot();
