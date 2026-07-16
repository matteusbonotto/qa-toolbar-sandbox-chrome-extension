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
};

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

  return { host, shadow };
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
