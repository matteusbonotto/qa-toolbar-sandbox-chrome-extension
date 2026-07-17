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
  t: null,
};

const FORCE_HTTP_STATUSES = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503];

function getTestStatusOptions() {
  const t = state.t;
  return [
    { key: "pass", label: t.statusPass, icon: "✓", color: "#179153" },
    { key: "fail", label: t.statusFail, icon: "✕", color: "#c70e0e" },
    { key: "blocked", label: t.statusBlocked, icon: "⛔", color: "#a34b05" },
    { key: "limitation", label: t.statusLimitation, icon: "△", color: "#5b21b6" },
  ];
}
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

/**
 * White-label breadcrumb: Client renders as a small, de-emphasized corner
 * label (logo/initials only by default), while Project → Product → Environment
 * form the main sequence, each entity rendering as a logo image, or — when no
 * logo is set — an auto-generated colored initials badge, so a brand-new
 * client/project/product is never a blank space. Per-entity `showLabel`
 * controls whether the name is spelled out next to the badge.
 */
function buildBreadcrumb(workspace, environment) {
  if (!environment) {
    return { clientHtml: "", mainHtml: escapeHtml(state.t.noEnvironment), color: "#3a3a3a", text: "#ffffff" };
  }
  const client = findById(workspace.clients, environment.clientId);
  const project = findById(workspace.projects, environment.projectId);
  const product = findById(workspace.products, environment.productId);
  const color = environment.color || "#ef3340";

  const clientHtml = client ? window.QTS_AVATAR.buildEntityHtml(client, { size: 15, maxChars: 14 }) : "";
  const segments = [project, product]
    .filter(Boolean)
    .map((entity) => window.QTS_AVATAR.buildEntityHtml(entity, { size: 19, maxChars: 16 }));
  segments.push(`<strong>${escapeHtml(environment.name)}</strong>`);

  return {
    clientHtml,
    mainHtml: segments.join('<span class="qts-crumb-sep">›</span>'),
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

  const clientLabel = root.getElementById("clientLabel");
  clientLabel.innerHTML = breadcrumb.clientHtml;
  clientLabel.classList.toggle("isHidden", !breadcrumb.clientHtml);
  root.getElementById("breadcrumb").innerHTML = breadcrumb.mainHtml;
  root.getElementById("restoreButton").classList.toggle("isVisible", state.minimized);

  setSpacerHeight();
}

function buildShadowHost() {
  const t = state.t;
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
      #breadcrumb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 30vw; display: flex; align-items: center; gap: 4px; }
      .qts-crumb-sep { opacity: .55; }
      .qts-client-label {
        display: inline-flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 700;
        opacity: .82; padding-right: 7px; margin-right: 3px; border-right: 1px solid rgba(255,255,255,.3);
        flex-shrink: 0;
      }
      .qts-client-label.isHidden { display: none; }
      .qts-badge-avatar {
        display: inline-flex; align-items: center; justify-content: center; border-radius: 5px;
        color: #fff; font-weight: 800; flex-shrink: 0; object-fit: cover; vertical-align: middle;
      }
      .qts-badge-name { vertical-align: middle; }
      button {
        all: unset; box-sizing: border-box; cursor: pointer; height: 24px; padding: 0 9px;
        display: inline-flex; align-items: center; gap: 5px; border-radius: 7px;
        background: rgba(0,0,0,.2); color: inherit; font: inherit; font-size: 11px; font-weight: 800;
        border: 1px solid rgba(255,255,255,.35); white-space: nowrap;
      }
      button:hover { background: rgba(0,0,0,.32); }
      button.iconOnly { width: 26px; padding: 0; justify-content: center; }
      button.isActive { background: #ffd700 !important; color: #111 !important; border-color: #fff !important; }
      #clearAllButton.isHidden, .isHidden { display: none !important; }
      #recordToggleButton.isActive { background: #c70e0e !important; color: #fff !important; border-color: #fff !important; animation: qts-rec-pulse 1.6s ease-in-out infinite; }
      #recordToggleButton.isPaused { background: #ffd700 !important; color: #111 !important; animation: none; }
      @keyframes qts-rec-pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
      #recordTimer { font-variant-numeric: tabular-nums; opacity: .9; }
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
        <span id="clientLabel" class="qts-client-label isHidden"></span>
        <span id="breadcrumb"></span>
      </div>
      <div id="right">
        <button id="testStatusButton" type="button" title="${escapeHtml(t.testStatusTitle)}">${escapeHtml(t.testStatus)}</button>
        <button id="passButton" class="iconOnly" type="button" title="${escapeHtml(t.pass)}">✓</button>
        <button id="failButton" class="iconOnly" type="button" title="${escapeHtml(t.fail)}">✕</button>
        <button id="noteButton" class="iconOnly" type="button" title="${escapeHtml(t.note)}">T</button>
        <button id="shapeButton" class="iconOnly" type="button" title="${escapeHtml(t.shape)}">▭</button>
        <button id="clearAllButton" class="isHidden" type="button" title="${escapeHtml(t.clearAllTitle)}">${escapeHtml(t.clearAll)}</button>
        <button id="screenshotButton" class="iconOnly" type="button" title="${escapeHtml(t.screenshot)}">📷</button>
        <button id="recordToggleButton" class="iconOnly" type="button" title="${escapeHtml(t.recordStart)}">⏺</button>
        <button id="recordStopButton" class="iconOnly isHidden" type="button" title="${escapeHtml(t.recordStop)}">⏹</button>
        <span id="recordTimer" class="isHidden">00:00</span>
        <div id="toolsWrapper">
          <button id="toolsButton" type="button" title="${escapeHtml(t.tools)}">${escapeHtml(t.tools)} ▾</button>
          <div id="toolsMenu" role="menu">
            <button type="button" id="clickSpyMenuItem" role="menuitem">🖱 Click Spy</button>
            <button type="button" id="freezeClockMenuItem" role="menuitem">⏸ Freeze Clock</button>
            <button type="button" id="forceHttpMenuItem" role="menuitem">⚠ Force HTTP</button>
            <button type="button" id="inspectorsMenuItem" role="menuitem">{ } ${escapeHtml(t.inspectorsTitle)}<span id="inspectorsBadge" class="qts-badge" style="display:none">0</span></button>
            <button type="button" id="jsonStudioMenuItem" role="menuitem">🧪 ${escapeHtml(t.jsonStudioTitle)}</button>
            <button type="button" id="breakpointMenuItem" role="menuitem">📐 Breakpoint Viewer</button>
            <button type="button" id="testAccountsMenuItem" role="menuitem">🔑 ${escapeHtml(t.testAccountsMenuLabel)}</button>
          </div>
        </div>
        <button id="settingsButton" class="iconOnly" type="button" title="${escapeHtml(t.settings)}">⚙</button>
        <button id="minimizeButton" class="iconOnly" type="button" title="${escapeHtml(t.minimize)}">▲</button>
      </div>
    </div>
    <button id="restoreButton" type="button" title="${escapeHtml(t.restore)}">▼</button>
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
  shadow.getElementById("recordToggleButton").addEventListener("click", () => handleRecordToggle());
  shadow.getElementById("recordStopButton").addEventListener("click", () => stopEvidenceRecording());

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
  shadow.getElementById("testAccountsMenuItem").addEventListener("click", () => { openTestAccountsDrawer(); closeToolsMenu(); });

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
  const options = getTestStatusOptions();
  const modal = document.createElement("div");
  modal.id = "qts-test-status-modal";
  modal.className = "qts-modal-backdrop";
  modal.innerHTML = `
    <div class="qts-modal">
      <header><h2>${escapeHtml(state.t.testStatus)}</h2><button type="button" data-close>×</button></header>
      <div class="qts-status-grid">
        ${options.map((option) => `
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
      const option = options.find((item) => item.key === key);
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
    <button type="button" class="qts-remove-btn" title="${escapeHtml(state.t.remove)}">×</button>
  `;
  document.body.appendChild(marker);
  makeDraggable(marker, marker.querySelector("[data-drag-handle]"));
  marker.querySelector(".qts-remove-btn").addEventListener("click", () => { marker.remove(); updateClearAllVisibility(); });
  updateClearAllVisibility();
}

function addFloatingTextNote() {
  const t = state.t;
  const note = document.createElement("div");
  note.className = "qts-floating-item qts-note isEditing";
  note.style.left = `${Math.max(12, window.innerWidth - 320)}px`;
  note.style.top = `${getCurrentHeight() + 24}px`;
  note.innerHTML = `
    <div class="qts-editor-head" data-drag-handle><span>${escapeHtml(t.noteHeader)}</span><button type="button" class="qts-remove-btn" title="${escapeHtml(t.remove)}">×</button></div>
    <div class="qts-editor-body">
      <textarea placeholder="${escapeHtml(t.notePlaceholder)}"></textarea>
      <div class="qts-editor-actions"><button type="button" data-save>${escapeHtml(t.save)}</button></div>
    </div>
  `;
  document.body.appendChild(note);
  makeDraggable(note, note.querySelector("[data-drag-handle]"));
  note.querySelector(".qts-remove-btn").addEventListener("click", () => { note.remove(); updateClearAllVisibility(); });
  note.querySelector("[data-save]").addEventListener("click", () => {
    const text = note.querySelector("textarea").value.trim() || t.noteDefault;
    note.className = "qts-floating-item qts-note isSaved";
    note.innerHTML = `
      <div class="qts-note-content" data-drag-handle>${escapeHtml(text)}</div>
      <button type="button" class="qts-edit-btn" title="${escapeHtml(t.edit)}">✎</button>
      <button type="button" class="qts-remove-btn" title="${escapeHtml(t.remove)}">×</button>
    `;
    makeDraggable(note, note.querySelector("[data-drag-handle]"));
    note.querySelector(".qts-remove-btn").addEventListener("click", () => { note.remove(); updateClearAllVisibility(); });
    note.querySelector(".qts-edit-btn").addEventListener("click", () => reopenTextNoteEditor(note, text));
  });
  updateClearAllVisibility();
}

function reopenTextNoteEditor(note, currentText) {
  const t = state.t;
  note.className = "qts-floating-item qts-note isEditing";
  note.innerHTML = `
    <div class="qts-editor-head" data-drag-handle><span>${escapeHtml(t.noteHeader)}</span><button type="button" class="qts-remove-btn" title="${escapeHtml(t.remove)}">×</button></div>
    <div class="qts-editor-body">
      <textarea placeholder="${escapeHtml(t.notePlaceholder)}">${escapeHtml(currentText)}</textarea>
      <div class="qts-editor-actions"><button type="button" data-save>${escapeHtml(t.save)}</button></div>
    </div>
  `;
  makeDraggable(note, note.querySelector("[data-drag-handle]"));
  note.querySelector(".qts-remove-btn").addEventListener("click", () => { note.remove(); updateClearAllVisibility(); });
  note.querySelector("[data-save]").addEventListener("click", () => {
    const text = note.querySelector("textarea").value.trim() || t.noteDefault;
    note.className = "qts-floating-item qts-note isSaved";
    note.innerHTML = `
      <div class="qts-note-content" data-drag-handle>${escapeHtml(text)}</div>
      <button type="button" class="qts-edit-btn" title="${escapeHtml(t.edit)}">✎</button>
      <button type="button" class="qts-remove-btn" title="${escapeHtml(t.remove)}">×</button>
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
    <button type="button" class="qts-remove-btn" title="${escapeHtml(state.t.remove)}">×</button>
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

    /* Toolbar shared by every data-listing drawer: search + smart filters + collapse-to-minimal. */
    .qts-toolbar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .qts-toolbar-row input[type="search"] { flex: 1 1 160px; min-width: 0; }
    .qts-icon-btn { width: 32px; height: 32px; padding: 0; border: 1px solid #333; border-radius: 8px; background: #1c1c1c; color: #fff; cursor: pointer; flex: 0 0 auto; }
    .qts-icon-btn:hover { border-color: #ffd700; }
    .qts-filter-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .qts-filter-bar.isCollapsed, .qts-toolbar-search.isCollapsed { display: none; }
    .qts-toggle-group { display: inline-flex; gap: 4px; padding: 3px; border: 1px solid #262626; border-radius: 8px; background: #131313; }
    .qts-toggle-group button { height: 26px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; color: #ccc; font-size: 11px; font-weight: 700; cursor: pointer; }
    .qts-toggle-group button.isSelected { background: #b20808; color: #fff; }
    .qts-combo { position: relative; border: 1px solid #262626; border-radius: 8px; background: #131313; }
    .qts-combo summary { list-style: none; padding: 5px 10px; font-size: 11px; font-weight: 700; cursor: pointer; color: #ddd; }
    .qts-combo summary::-webkit-details-marker { display: none; }
    .qts-combo summary .qts-combo-count { color: #ffd700; }
    .qts-combo[open] > .qts-combo-panel { display: flex; }
    .qts-combo-panel {
      display: none; flex-direction: column; gap: 6px; position: absolute; top: 34px; left: 0; z-index: 5;
      width: max(220px, 100%); max-height: 260px; padding: 8px; border: 1px solid #333; border-radius: 8px;
      background: #101010; box-shadow: 0 12px 30px rgba(0,0,0,.5); overflow: auto;
    }
    .qts-combo-option { display: flex; align-items: center; gap: 8px; padding: 4px 2px; font-size: 11px; cursor: pointer; }
    .qts-combo-option img { width: 20px; height: 20px; border-radius: 4px; object-fit: cover; flex: 0 0 auto; }
    .qts-combo-clear { align-self: flex-end; background: none; border: 0; color: #ff8a8a; font-size: 10px; cursor: pointer; padding: 2px 4px; }

    /* Friendly (default) vs raw JSON detail view. */
    .qts-view-switch { display: inline-flex; margin-bottom: 10px; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
    .qts-view-switch button { height: 28px; padding: 0 12px; border: 0; background: #171717; color: #aaa; font-size: 11px; font-weight: 800; cursor: pointer; }
    .qts-view-switch button.isSelected { background: #b20808; color: #fff; }
    .qts-friendly-field { display: grid; grid-template-columns: minmax(120px,180px) 1fr; gap: 10px; padding: 6px 8px; border-bottom: 1px solid #1c1c1c; }
    .qts-friendly-field .qts-field-label { color: #ffd700; font-size: 10px; font-weight: 800; text-transform: uppercase; word-break: break-word; align-self: start; padding-top: 2px; }
    .qts-friendly-field .qts-field-value { word-break: break-word; }
    .qts-friendly-section { margin: 4px 0; border: 1px solid #222; border-radius: 8px; overflow: hidden; }
    .qts-friendly-section > summary { padding: 7px 10px; background: #161616; color: #fff; font-size: 11px; font-weight: 800; cursor: pointer; list-style: none; }
    .qts-friendly-section > summary::-webkit-details-marker { display: none; }
    .qts-friendly-section > summary .qts-count { color: #888; font-weight: 600; }
    .qts-friendly-hidden { display: none !important; }
  `;
}

// ---------------------------------------------------------------------------
// Smart filters: ≤4 distinct values render as a toggle-button group; more
// than that becomes a searchable combobox with checkboxes (image optional).
// Used by every data-listing drawer, not just Inspectors.
// ---------------------------------------------------------------------------

function renderSmartFilter({ key, label, options }, selected, onChange) {
  if (!options.length) return "";
  if (options.length <= 4) {
    return `<div class="qts-toggle-group" data-filter-key="${escapeHtml(key)}">
      ${options.map((option) => `<button type="button" data-value="${escapeHtml(option.value)}" class="${selected.has(option.value) ? "isSelected" : ""}">${escapeHtml(option.label)}</button>`).join("")}
    </div>`;
  }
  return `<details class="qts-combo" data-filter-key="${escapeHtml(key)}">
    <summary>${escapeHtml(label)} <span class="qts-combo-count">${selected.size ? `(${selected.size})` : ""}</span></summary>
    <div class="qts-combo-panel">
      <input type="search" placeholder="${escapeHtml(state.t.searchPlaceholder)}" data-combo-search />
      <button type="button" class="qts-combo-clear" data-combo-clear>${escapeHtml(state.t.clearSelection)}</button>
      <div data-combo-options>
        ${options.map((option) => `
          <label class="qts-combo-option" data-combo-option data-search="${escapeHtml(option.label.toLowerCase())}">
            <input type="checkbox" data-value="${escapeHtml(option.value)}" ${selected.has(option.value) ? "checked" : ""} />
            ${option.image ? `<img src="${escapeHtml(option.image)}" alt="" />` : ""}
            <span>${escapeHtml(option.label)}</span>
          </label>
        `).join("")}
      </div>
    </div>
  </details>`;
}

function wireSmartFilter(container, onChange) {
  container.querySelectorAll("[data-filter-key]").forEach((widget) => {
    const key = widget.dataset.filterKey;
    if (widget.classList.contains("qts-toggle-group")) {
      widget.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
        button.classList.toggle("isSelected");
        onChange(key, button.dataset.value, button.classList.contains("isSelected"));
      }));
      return;
    }
    widget.querySelectorAll("[data-combo-option] input").forEach((checkbox) => checkbox.addEventListener("change", () => {
      onChange(key, checkbox.value, checkbox.checked);
    }));
    widget.querySelector("[data-combo-search]")?.addEventListener("input", (event) => {
      const term = event.target.value.trim().toLowerCase();
      widget.querySelectorAll("[data-combo-option]").forEach((option) => {
        option.style.display = !term || option.dataset.search.includes(term) ? "" : "none";
      });
    });
    widget.querySelector("[data-combo-clear]")?.addEventListener("click", () => {
      widget.querySelectorAll("input[type=checkbox]").forEach((checkbox) => { checkbox.checked = false; onChange(key, checkbox.value, false); });
    });
  });
}

function openDrawer({ title, wide = false, bodyHtml, onReady }) {
  cleanupBreakpointViewer();
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

function humanizeKey(key) {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatPrimitive(value) {
  if (value === null || value === undefined) return `<span style="color:#666">—</span>`;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return escapeHtml(String(value));
}

/**
 * Friendly (default) rendering of arbitrary JSON: primitive fields as
 * label/value rows, objects as collapsible sections, arrays as numbered
 * collapsible sections — everything generic, nothing product-specific.
 */
function renderFriendlyJson(value, keyLabel = null, depth = 0) {
  if (value === null || typeof value !== "object") {
    if (keyLabel === null) return `<div class="qts-friendly-field"><div class="qts-field-value">${formatPrimitive(value)}</div></div>`;
    return `<div class="qts-friendly-field" data-friendly-key="${escapeHtml(keyLabel)}" data-friendly-value="${escapeHtml(String(value))}">
      <div class="qts-field-label">${escapeHtml(humanizeKey(keyLabel))}</div><div class="qts-field-value">${formatPrimitive(value)}</div>
    </div>`;
  }
  if (Array.isArray(value)) {
    const label = keyLabel === null ? state.t.list : humanizeKey(keyLabel);
    if (!value.length) return `<div class="qts-friendly-field" data-friendly-key="${escapeHtml(keyLabel || "")}"><div class="qts-field-label">${escapeHtml(label)}</div><div class="qts-field-value" style="color:#666">${escapeHtml(state.t.emptyList)}</div></div>`;
    return `<details class="qts-friendly-section" ${depth < 1 ? "open" : ""} data-friendly-key="${escapeHtml(keyLabel || "")}">
      <summary>${escapeHtml(label)} <span class="qts-count">(${value.length})</span></summary>
      <div>${value.map((item, index) => renderFriendlyJson(item, `#${index + 1}`, depth + 1)).join("")}</div>
    </details>`;
  }
  const keys = Object.keys(value);
  const inner = keys.map((key) => renderFriendlyJson(value[key], key, depth + 1)).join("");
  if (keyLabel === null) return `<div>${inner}</div>`;
  return `<details class="qts-friendly-section" ${depth < 1 ? "open" : ""} data-friendly-key="${escapeHtml(keyLabel)}">
    <summary>${escapeHtml(humanizeKey(keyLabel))} <span class="qts-count">(${keys.length})</span></summary>
    <div>${inner}</div>
  </details>`;
}

function filterFriendlyView(container, term) {
  const normalized = term.trim().toLowerCase();
  container.querySelectorAll("[data-friendly-key]").forEach((node) => {
    if (!normalized) { node.classList.remove("qts-friendly-hidden"); return; }
    const haystack = `${node.dataset.friendlyKey || ""} ${node.dataset.friendlyValue || ""} ${node.textContent}`.toLowerCase();
    node.classList.toggle("qts-friendly-hidden", !haystack.includes(normalized));
  });
  // Auto-expand sections that contain a visible match so search results aren't hidden inside a closed <details>.
  container.querySelectorAll("details.qts-friendly-section").forEach((section) => {
    if (normalized && !section.classList.contains("qts-friendly-hidden")) section.open = true;
  });
}

/**
 * Renders a JSON value with a friendly/raw switch (friendly is the default)
 * plus a search box that filters the friendly view, and a "minimizar" toggle
 * that collapses everything down to just the header for a minimal view.
 */
function renderJsonDetail(container, value) {
  const t = state.t;
  container.innerHTML = `
    <div class="qts-toolbar-row">
      <div class="qts-view-switch"><button type="button" data-mode="friendly" class="isSelected">${escapeHtml(t.friendly)}</button><button type="button" data-mode="raw">${escapeHtml(t.raw)}</button></div>
      <input type="search" placeholder="${escapeHtml(t.jsonSearchPlaceholder)}" data-json-search />
      <button type="button" class="qts-icon-btn" data-json-minimize title="${escapeHtml(t.minimizeTitle)}">▬</button>
    </div>
    <div data-json-content></div>
  `;
  const content = container.querySelector("[data-json-content]");
  const searchInput = container.querySelector("[data-json-search]");
  let mode = "friendly";
  const renderMode = () => {
    content.innerHTML = mode === "friendly" ? renderFriendlyJson(value) : `<div class="qts-json-tree">${renderJsonTree(value)}</div>`;
    filterFriendlyView(content, searchInput.value);
  };
  container.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    mode = button.dataset.mode;
    container.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("isSelected", item === button));
    renderMode();
  }));
  searchInput.addEventListener("input", () => filterFriendlyView(content, searchInput.value));
  container.querySelector("[data-json-minimize]").addEventListener("click", () => {
    const minimized = content.classList.toggle("qts-friendly-hidden");
    container.querySelector("[data-json-minimize]").classList.toggle("isActive", minimized);
  });
  renderMode();
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
  const t = state.t;
  const anchor = target.closest?.("a[href]");
  const description = [
    [t.clickSpyElement, target.tagName.toLowerCase()],
    [t.clickSpyText, target.textContent?.trim().slice(0, 80) || "—"],
    [t.clickSpyDestination, anchor ? new URL(anchor.getAttribute("href"), window.location.href).href : "—"],
    [t.clickSpyType, anchor ? t.clickSpyNavigation : target.tagName === "BUTTON" || target.getAttribute("type") === "submit" ? t.clickSpyActionSubmit : t.clickSpyFormControl],
  ];
  openDrawer({
    title: t.clickSpyResultTitle,
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
  const t = state.t;
  openDrawer({
    title: t.forceHttpTitle,
    bodyHtml: `
      <p style="color:#999;margin-top:0">${escapeHtml(t.forceHttpDescription)}</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${FORCE_HTTP_STATUSES.map((status) => `<button type="button" class="action" data-status="${status}">HTTP ${status}</button>`).join("")}
      </div>
      <div style="margin-top:14px"><button type="button" class="action" id="forceHttpClear">${escapeHtml(t.forceHttpCancel)}</button></div>
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

const inspectorsFilterState = { query: "", method: new Set(), status: new Set(), source: new Set(), collapsed: false };

function statusBucket(status) {
  if (!status) return "—";
  return `${String(status)[0]}xx`;
}

function buildInspectorFilterFields() {
  const methods = [...new Set(state.networkHistory.map((entry) => entry.method))].sort();
  const statuses = [...new Set(state.networkHistory.map((entry) => statusBucket(entry.status)))].sort();
  const sources = [...new Set(state.networkHistory.map((entry) => entry.source))].sort();
  return [
    { key: "method", label: state.t.filterMethod, options: methods.map((value) => ({ value, label: value })) },
    { key: "status", label: state.t.filterStatus, options: statuses.map((value) => ({ value, label: value })) },
    { key: "source", label: state.t.filterSource, options: sources.map((value) => ({ value, label: value })) },
  ];
}

function matchesInspectorFilters(entry) {
  const query = inspectorsFilterState.query.trim().toLowerCase();
  if (query) {
    const haystack = `${entry.url} ${entry.method} ${entry.status} ${JSON.stringify(entry.payload)}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (inspectorsFilterState.method.size && !inspectorsFilterState.method.has(entry.method)) return false;
  if (inspectorsFilterState.status.size && !inspectorsFilterState.status.has(statusBucket(entry.status))) return false;
  if (inspectorsFilterState.source.size && !inspectorsFilterState.source.has(entry.source)) return false;
  return true;
}

function renderInspectorsList() {
  const t = state.t;
  const body = state.shadowRoot.getElementById("drawerBody");
  if (!body) return;
  const fields = buildInspectorFilterFields();
  const filtered = state.networkHistory.filter(matchesInspectorFilters);

  body.innerHTML = `
    <div class="qts-toolbar-row">
      <input type="search" placeholder="${escapeHtml(t.inspectorsSearchPlaceholder)}" id="inspectorsSearch" value="${escapeHtml(inspectorsFilterState.query)}" class="${inspectorsFilterState.collapsed ? "qts-toolbar-search isCollapsed" : "qts-toolbar-search"}" />
      <button type="button" class="qts-icon-btn ${inspectorsFilterState.collapsed ? "isActive" : ""}" id="inspectorsCollapseToggle" title="${escapeHtml(t.toggleFilters)}">▬</button>
    </div>
    <div class="qts-filter-bar ${inspectorsFilterState.collapsed ? "isCollapsed" : ""}" id="inspectorsFilterBar">
      ${fields.map((field) => renderSmartFilter(field, inspectorsFilterState[field.key], null)).join("")}
    </div>
    <div id="inspectorsListBody"></div>
  `;

  const listBody = body.querySelector("#inspectorsListBody");
  listBody.innerHTML = filtered.length
    ? filtered.map((entry) => `
        <div class="qts-net-item" data-id="${escapeHtml(entry.id)}">
          <b>${entry.status || "—"}</b> ${escapeHtml(entry.method)} <small>${escapeHtml(entry.url)}</small>
        </div>
      `).join("")
    : `<div class="qts-empty">${state.networkHistory.length ? t.noFilterResults : t.noResponsesYet}</div>`;

  listBody.querySelectorAll("[data-id]").forEach((row) => row.addEventListener("click", () => {
    const entry = state.networkHistory.find((item) => item.id === row.dataset.id);
    openDrawer({ title: `${entry.method} ${entry.status}`, wide: true, bodyHtml: "", onReady: (drawerBody) => renderJsonDetail(drawerBody, entry.payload) });
  }));

  body.querySelector("#inspectorsSearch").addEventListener("input", (event) => {
    inspectorsFilterState.query = event.target.value;
    renderInspectorsList();
  });
  body.querySelector("#inspectorsCollapseToggle").addEventListener("click", () => {
    inspectorsFilterState.collapsed = !inspectorsFilterState.collapsed;
    renderInspectorsList();
  });
  wireSmartFilter(body.querySelector("#inspectorsFilterBar"), (key, value, isSelected) => {
    if (isSelected) inspectorsFilterState[key].add(value); else inspectorsFilterState[key].delete(value);
    renderInspectorsList();
  });
}

function openInspectorsDrawer() {
  openDrawer({ title: state.t.inspectorsTitle, wide: true, bodyHtml: "" });
  state.shadowRoot.getElementById("drawerHost").dataset.view = "inspectors";
  renderInspectorsList();
}

// ---------------------------------------------------------------------------
// Test accounts: read-only view of the accounts registered (from Settings)
// for the environment matching the current URL. Sandbox-only by design —
// passwords are masked by default and never leave this drawer; managing
// (creating/removing) accounts happens on the options page, not here.
// ---------------------------------------------------------------------------

const revealedTestAccountIds = new Set();

function renderTestAccountsList() {
  const t = state.t;
  const body = state.shadowRoot.getElementById("drawerBody");
  if (!body) return;

  if (!state.environment) {
    body.innerHTML = `<div class="qts-empty">${escapeHtml(t.testAccountsNoEnvironment)}</div>`;
    return;
  }

  const accounts = (state.workspace.testAccounts || []).filter((account) => account.environmentId === state.environment.id);
  if (!accounts.length) {
    body.innerHTML = `<div class="qts-empty">${escapeHtml(t.testAccountsEmptyForEnv)}</div>`;
    return;
  }

  body.innerHTML = `<div style="display:grid;gap:10px">${accounts.map((account) => {
    const revealed = revealedTestAccountIds.has(account.id);
    const passwordDisplay = account.password ? (revealed ? escapeHtml(account.password) : "•".repeat(Math.min(10, account.password.length))) : "—";
    return `
      <div class="qts-net-item" data-account-id="${escapeHtml(account.id)}" style="cursor:default">
        <b>${escapeHtml(account.label)}</b>${account.accountType ? ` <span style="color:#ffd700">${escapeHtml(account.accountType)}</span>` : ""}
        <div style="margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <small>${escapeHtml(account.username || "—")}</small>
          <small>${passwordDisplay}</small>
          ${account.password ? `<button type="button" class="action" data-reveal-account="${escapeHtml(account.id)}" style="height:22px;padding:0 8px;font-size:10px">${revealed ? "🙈" : "👁"}</button>` : ""}
          ${account.username ? `<button type="button" class="action" data-copy-account="${escapeHtml(account.id)}" style="height:22px;padding:0 8px;font-size:10px">⧉</button>` : ""}
        </div>
        ${account.notes ? `<small style="display:block;margin-top:4px;color:#888">${escapeHtml(account.notes)}</small>` : ""}
      </div>
    `;
  }).join("")}</div>`;

  body.querySelectorAll("[data-reveal-account]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.revealAccount;
    if (revealedTestAccountIds.has(id)) revealedTestAccountIds.delete(id); else revealedTestAccountIds.add(id);
    renderTestAccountsList();
  }));
  body.querySelectorAll("[data-copy-account]").forEach((button) => button.addEventListener("click", async () => {
    const account = accounts.find((item) => item.id === button.dataset.copyAccount);
    if (!account?.username) return;
    await navigator.clipboard.writeText(account.username).catch(() => {});
    const original = button.textContent;
    button.textContent = "✓";
    window.setTimeout(() => { button.textContent = original; }, 1200);
  }));
}

function openTestAccountsDrawer() {
  openDrawer({ title: state.t.testAccountsDrawerTitle, bodyHtml: "" });
  renderTestAccountsList();
}

// ---------------------------------------------------------------------------
// JSON Studio: format/compact/copy any pasted JSON.
// ---------------------------------------------------------------------------

function openJsonStudio() {
  const t = state.t;
  openDrawer({
    title: t.jsonStudioTitle,
    wide: true,
    bodyHtml: `
      <textarea id="jsonInput" rows="16" placeholder="${escapeHtml(t.jsonStudioPlaceholder)}" style="font:12px ui-monospace,Consolas,monospace"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="button" class="action primary" id="jsonFormat">${escapeHtml(t.jsonStudioFormat)}</button>
        <button type="button" class="action" id="jsonCompact">${escapeHtml(t.jsonStudioCompact)}</button>
        <button type="button" class="action" id="jsonCopy">${escapeHtml(t.jsonStudioCopy)}</button>
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
          errorEl.textContent = t.jsonStudioInvalid(error.message);
        }
      };
      body.querySelector("#jsonFormat").addEventListener("click", () => run((parsed) => JSON.stringify(parsed, null, 2)));
      body.querySelector("#jsonCompact").addEventListener("click", () => run((parsed) => JSON.stringify(parsed)));
      body.querySelector("#jsonCopy").addEventListener("click", () => navigator.clipboard.writeText(input.value).catch(() => {}));
    },
  });
}

// ---------------------------------------------------------------------------
// Breakpoint Viewer: full-screen device-frame comparison (not a sidebar) —
// each pane emulates the device's real pixel size and browser/device chrome,
// scaled down to fit. Scroll/click sync only work when the loaded page is
// same-origin as the top document (cross-origin iframes block script access
// by design); when that fails we tell the user instead of silently no-oping.
// ---------------------------------------------------------------------------

const DEVICE_PRESETS = [
  { id: "macbook-air", label: "MacBook Air M2", width: 1280, height: 832, kind: "laptop" },
  { id: "laptop-1366", label: "Laptop 1366", width: 1366, height: 768, kind: "laptop" },
  { id: "ipad", label: "iPad", width: 768, height: 1024, kind: "tablet" },
  { id: "iphone-12-pro-max", label: "iPhone 12 Pro Max", width: 379, height: 820, kind: "phone" },
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667, kind: "phone" },
];

const breakpointViewerState = { syncScroll: false, syncClick: false, resizeObserver: null, cleanupFns: [] };

function buildDeviceFrameHtml(pane, device) {
  const chrome = device.kind === "phone"
    ? `<div class="qts-bp-phone-status"><span>${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><span>▂▄▆ 🔋</span></div>`
    : `<div class="qts-bp-laptop-bar"><i class="dot r"></i><i class="dot y"></i><i class="dot g"></i><span class="qts-bp-address">${escapeHtml(device.label)} · ${device.width}×${device.height}</span></div>`;
  return `
    <div class="qts-bp-pane" data-pane-wrap="${pane}">
      <div class="qts-bp-frame kind-${device.kind}" data-pane="${pane}">
        ${chrome}
        <div class="qts-bp-viewport-wrap" data-viewport-wrap>
          <iframe data-bp-iframe style="width:${device.width}px;height:${device.height}px"></iframe>
        </div>
        ${device.kind === "phone" ? `<div class="qts-bp-home-indicator"></div>` : ""}
      </div>
      <div class="qts-bp-scale-label" data-scale-label></div>
    </div>
  `;
}

function breakpointStyles() {
  return `
    .qts-bp-overlay { position: fixed; inset: 0; z-index: 2147483647; background: #050505; display: flex; flex-direction: column; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #fff; }
    .qts-bp-topbar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #262626; background: #111; flex-wrap: wrap; }
    .qts-bp-topbar input[type="url"] { flex: 1 1 220px; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid #333; border-radius: 8px; background: #1a1a1a; color: #fff; }
    .qts-bp-topbar select { height: 34px; padding: 0 8px; border: 1px solid #333; border-radius: 8px; background: #1a1a1a; color: #fff; }
    .qts-bp-toggle { height: 34px; padding: 0 12px; border: 1px solid #333; border-radius: 8px; background: #1a1a1a; color: #ccc; cursor: pointer; font-weight: 700; }
    .qts-bp-toggle.isOn { background: #147b49; border-color: #1ca868; color: #fff; }
    .qts-bp-close { width: 34px; height: 34px; border: 0; border-radius: 8px; background: #b20808; color: #fff; font-size: 18px; cursor: pointer; }
    .qts-bp-stage { flex: 1; display: flex; align-items: center; justify-content: center; gap: 26px; overflow: auto; padding: 20px; }
    .qts-bp-pane { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1 1 0; min-width: 0; max-width: 100%; }
    .qts-bp-frame { display: flex; flex-direction: column; align-items: center; background: #1a1a1a; border-radius: 14px; padding: 8px; box-shadow: 0 30px 70px rgba(0,0,0,.5); }
    .qts-bp-frame.kind-phone { border-radius: 34px; padding: 14px 8px; border: 2px solid #2c2c2c; }
    .qts-bp-laptop-bar { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
    .qts-bp-laptop-bar .dot { width: 8px; height: 8px; border-radius: 50%; }
    .qts-bp-laptop-bar .dot.r { background: #ff5f57; } .qts-bp-laptop-bar .dot.y { background: #febc2e; } .qts-bp-laptop-bar .dot.g { background: #28c840; }
    .qts-bp-address { margin-left: 8px; padding: 3px 10px; border-radius: 6px; background: #262626; color: #999; font-size: 10px; }
    .qts-bp-phone-status { width: 100%; display: flex; justify-content: space-between; padding: 4px 14px; color: #ccc; font-size: 10px; }
    .qts-bp-viewport-wrap { position: relative; overflow: hidden; background: #fff; border-radius: 4px; }
    .qts-bp-viewport-wrap iframe { position: absolute; top: 0; left: 0; transform-origin: top left; border: 0; }
    .qts-bp-home-indicator { width: 90px; height: 4px; border-radius: 99px; background: #444; margin-top: 8px; }
    .qts-bp-scale-label { color: #888; font-size: 10px; }
  `;
}

function cleanupBreakpointViewer() {
  breakpointViewerState.resizeObserver?.disconnect();
  breakpointViewerState.resizeObserver = null;
  breakpointViewerState.cleanupFns.forEach((fn) => fn());
  breakpointViewerState.cleanupFns = [];
}

function openBreakpointViewer() {
  const t = state.t;
  cleanupBreakpointViewer();
  const drawerHost = ensureDrawerHost();
  const initialUrl = /^https?:\/\//i.test(window.location.href) ? window.location.href : "https://example.com";
  drawerHost.innerHTML = `<style>${breakpointStyles()}</style>
    <div class="qts-bp-overlay">
      <div class="qts-bp-topbar">
        <input type="url" id="bpUrl" value="${escapeHtml(initialUrl)}" placeholder="https://..." />
        <select id="bpDeviceA">${DEVICE_PRESETS.map((device, index) => `<option value="${device.id}" ${index === 0 ? "selected" : ""}>${escapeHtml(device.label)}</option>`).join("")}</select>
        <select id="bpDeviceB">${DEVICE_PRESETS.map((device, index) => `<option value="${device.id}" ${index === 3 ? "selected" : ""}>${escapeHtml(device.label)}</option>`).join("")}</select>
        <button type="button" class="qts-bp-toggle" id="bpSyncScroll">${escapeHtml(t.syncScroll)}</button>
        <button type="button" class="qts-bp-toggle" id="bpSyncClick">${escapeHtml(t.syncClick)}</button>
        <button type="button" class="qts-bp-close" id="bpClose">×</button>
      </div>
      <div class="qts-bp-stage" id="bpStage"></div>
    </div>`;

  const close = () => { cleanupBreakpointViewer(); closeDrawer(); };
  drawerHost.querySelector("#bpClose").addEventListener("click", close);
  const escHandler = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", escHandler, true);
  breakpointViewerState.cleanupFns.push(() => document.removeEventListener("keydown", escHandler, true));

  const stage = drawerHost.querySelector("#bpStage");
  const urlInput = drawerHost.querySelector("#bpUrl");
  const selectA = drawerHost.querySelector("#bpDeviceA");
  const selectB = drawerHost.querySelector("#bpDeviceB");

  function findDevice(id) { return DEVICE_PRESETS.find((device) => device.id === id) ?? DEVICE_PRESETS[0]; }

  function normalizedPreviewUrl() {
    try {
      const parsed = new URL(urlInput.value.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      // Credentials in preview URLs are unnecessary and can leak through the
      // iframe request. encodeURI also prevents DOM text from becoming markup.
      parsed.username = "";
      parsed.password = "";
      return encodeURI(parsed.href);
    } catch {
      return null;
    }
  }

  function layout() {
    stage.innerHTML = buildDeviceFrameHtml("a", findDevice(selectA.value)) + buildDeviceFrameHtml("b", findDevice(selectB.value));
    fitAndLoad();
    wireSync();
  }

  function fitAndLoad() {
    const url = normalizedPreviewUrl();
    const deviceA = findDevice(selectA.value);
    const deviceB = findDevice(selectB.value);

    // A shared scale (not one computed independently per pane) is what keeps
    // relative real-world proportions intact — a 1280px monitor must always
    // render bigger than a 379px phone at the same zoom. Fitting each device
    // to its own box independently (the previous bug) let the phone claim
    // ~100% while the monitor was squeezed down, inverting their real sizes.
    const paneWidthBudget = stage.clientWidth / 2 - 50;
    const paneHeightBudget = stage.clientHeight - 70;
    const widestDevice = Math.max(deviceA.width, deviceB.width);
    const tallestDevice = Math.max(deviceA.height, deviceB.height);
    const scale = Math.min(1, paneWidthBudget / widestDevice, paneHeightBudget / tallestDevice);

    stage.querySelectorAll("[data-pane]").forEach((frame) => {
      const device = frame.dataset.pane === "a" ? deviceA : deviceB;
      const wrap = frame.querySelector("[data-viewport-wrap]");
      const iframe = frame.querySelector("[data-bp-iframe]");
      wrap.style.width = `${Math.round(device.width * scale)}px`;
      wrap.style.height = `${Math.round(device.height * scale)}px`;
      iframe.style.transform = `scale(${scale})`;
      if (url && iframe.src !== url) iframe.src = url;
      const label = frame.closest("[data-pane-wrap]").querySelector("[data-scale-label]");
      if (label) label.textContent = `${device.label} · ${device.width}×${device.height} · ${Math.round(scale * 100)}%`;
    });
  }

  function wireSync() {
    const iframeA = stage.querySelector('[data-pane="a"] iframe');
    const iframeB = stage.querySelector('[data-pane="b"] iframe');
    if (!iframeA || !iframeB) return;
    let syncing = false;

    const attach = () => {
      let docA;
      let docB;
      try {
        docA = iframeA.contentWindow.document;
        docB = iframeB.contentWindow.document;
      } catch {
        showToolbarToast(state.t.crossOriginToast);
        return;
      }

      const scrollHandler = (source, target) => () => {
        if (!breakpointViewerState.syncScroll || syncing) return;
        syncing = true;
        const sourceWindow = source.contentWindow;
        const ratio = sourceWindow.scrollY / Math.max(1, sourceWindow.document.documentElement.scrollHeight - sourceWindow.innerHeight);
        const targetWindow = target.contentWindow;
        targetWindow.scrollTo(0, ratio * Math.max(0, targetWindow.document.documentElement.scrollHeight - targetWindow.innerHeight));
        syncing = false;
      };
      docA.defaultView.addEventListener("scroll", scrollHandler(iframeA, iframeB));
      docB.defaultView.addEventListener("scroll", scrollHandler(iframeB, iframeA));

      const clickHandler = (source, target) => (event) => {
        if (!breakpointViewerState.syncClick) return;
        const ratioX = event.clientX / source.contentWindow.innerWidth;
        const ratioY = event.clientY / source.contentWindow.innerHeight;
        const targetDoc = target.contentWindow.document;
        const targetElement = targetDoc.elementFromPoint(ratioX * target.contentWindow.innerWidth, ratioY * target.contentWindow.innerHeight);
        targetElement?.click();
      };
      docA.addEventListener("click", clickHandler(iframeA, iframeB), true);
      docB.addEventListener("click", clickHandler(iframeB, iframeA), true);
    };

    iframeA.addEventListener("load", attach, { once: true });
  }

  function showToolbarToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#101010;color:#fff;border:1px solid #ffd700;border-radius:999px;padding:10px 16px;z-index:2147483647;font-size:12px;max-width:80vw;text-align:center";
    drawerHost.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3500);
  }

  urlInput.addEventListener("change", fitAndLoad);
  selectA.addEventListener("change", layout);
  selectB.addEventListener("change", layout);
  drawerHost.querySelector("#bpSyncScroll").addEventListener("click", (event) => {
    breakpointViewerState.syncScroll = !breakpointViewerState.syncScroll;
    event.currentTarget.classList.toggle("isOn", breakpointViewerState.syncScroll);
  });
  drawerHost.querySelector("#bpSyncClick").addEventListener("click", (event) => {
    breakpointViewerState.syncClick = !breakpointViewerState.syncClick;
    event.currentTarget.classList.toggle("isOn", breakpointViewerState.syncClick);
  });

  breakpointViewerState.resizeObserver = new ResizeObserver(() => fitAndLoad());
  breakpointViewerState.resizeObserver.observe(stage);

  layout();
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

// ---------------------------------------------------------------------------
// Evidence recording: getDisplayMedia + MediaRecorder, start/pause/resume/
// stop, download as MP4 when the browser's MediaRecorder supports it,
// falling back to WebM otherwise (documented limitation, not a silent one —
// the download filename extension always matches what was actually
// recorded). GIF/Convertio conversion is a follow-up, not required to
// produce usable evidence today.
// ---------------------------------------------------------------------------

const recordingState = {
  status: "idle", // idle | recording | paused
  stream: null,
  recorder: null,
  chunks: [],
  mimeType: "",
  elapsedMs: 0,
  segmentStartedAt: 0,
  timerId: null,
};

function pickRecordingMimeType() {
  const candidates = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) || "";
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateRecordTimerDisplay() {
  const elapsed = recordingState.elapsedMs + (recordingState.status === "recording" ? Date.now() - recordingState.segmentStartedAt : 0);
  const timer = state.shadowRoot?.getElementById("recordTimer");
  if (timer) timer.textContent = formatDuration(elapsed);
}

function setRecordingUi() {
  const toggle = state.shadowRoot?.getElementById("recordToggleButton");
  const stopButton = state.shadowRoot?.getElementById("recordStopButton");
  const timer = state.shadowRoot?.getElementById("recordTimer");
  if (!toggle) return;
  toggle.classList.toggle("isActive", recordingState.status === "recording");
  toggle.classList.toggle("isPaused", recordingState.status === "paused");
  toggle.textContent = recordingState.status === "recording" ? "⏸" : recordingState.status === "paused" ? "▶" : "⏺";
  toggle.title = recordingState.status === "recording" ? state.t.recordPause : recordingState.status === "paused" ? state.t.recordResume : state.t.recordStart;
  stopButton?.classList.toggle("isHidden", recordingState.status === "idle");
  timer?.classList.toggle("isHidden", recordingState.status === "idle");
}

async function handleRecordToggle() {
  if (recordingState.status === "idle") { await startEvidenceRecording(); return; }
  if (recordingState.status === "recording") { pauseEvidenceRecording(); return; }
  resumeEvidenceRecording();
}

async function startEvidenceRecording() {
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
    openDrawer({ title: state.t.recordingUnavailableTitle, bodyHtml: `<p>${escapeHtml(state.t.recordingUnavailableBody)}</p>` });
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 24, max: 30 } }, audio: false });
  } catch {
    return; // User cancelled the native picker — not an error.
  }
  const mimeType = pickRecordingMimeType();
  recordingState.stream = stream;
  recordingState.chunks = [];
  recordingState.mimeType = mimeType;
  recordingState.elapsedMs = 0;
  recordingState.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recordingState.recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) recordingState.chunks.push(event.data);
  });
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (recordingState.status !== "idle") stopEvidenceRecording();
  }, { once: true });

  recordingState.recorder.start(1000);
  recordingState.status = "recording";
  recordingState.segmentStartedAt = Date.now();
  recordingState.timerId = window.setInterval(updateRecordTimerDisplay, 500);
  setRecordingUi();
}

function pauseEvidenceRecording() {
  if (recordingState.status !== "recording" || !recordingState.recorder) return;
  recordingState.recorder.pause();
  recordingState.elapsedMs += Date.now() - recordingState.segmentStartedAt;
  recordingState.status = "paused";
  setRecordingUi();
}

function resumeEvidenceRecording() {
  if (recordingState.status !== "paused" || !recordingState.recorder) return;
  recordingState.recorder.resume();
  recordingState.segmentStartedAt = Date.now();
  recordingState.status = "recording";
  setRecordingUi();
}

async function stopEvidenceRecording() {
  if (recordingState.status === "idle" || !recordingState.recorder) return;
  const recorder = recordingState.recorder;
  if (recordingState.status === "recording") recordingState.elapsedMs += Date.now() - recordingState.segmentStartedAt;
  window.clearInterval(recordingState.timerId);
  recordingState.timerId = null;

  const stopped = new Promise((resolveStop) => recorder.addEventListener("stop", resolveStop, { once: true }));
  recorder.stop();
  await stopped;
  recordingState.stream?.getTracks().forEach((track) => track.stop());

  const blob = new Blob(recordingState.chunks, { type: recordingState.mimeType || "video/webm" });
  const extension = (recordingState.mimeType || "").includes("mp4") ? "mp4" : "webm";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `qa-evidencia-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);

  recordingState.status = "idle";
  recordingState.recorder = null;
  recordingState.stream = null;
  recordingState.chunks = [];
  recordingState.elapsedMs = 0;
  setRecordingUi();
  updateRecordTimerDisplay();
}

async function boot() {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    return;
  }

  state.t = await window.QTS_I18N.load();
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
