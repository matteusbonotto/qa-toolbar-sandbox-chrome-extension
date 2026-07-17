const { getWorkspace, saveWorkspace, onStorageChanged, STORAGE_KEYS } = window.QTS_STORAGE;

const TOOLBAR_HEIGHT = 48;
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
  authorized: false,
  integrityObserver: null,
  integrityInterval: null,
  accessInterval: null,
  locationInterval: null,
  lastHref: window.location.href,
  macroRecording: null,
  macroPlaying: false,
  selectionCleanup: null,
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
  return (workspace.environments || []).find((environment) => environment.active !== false && matchesAnyPattern(environment.urlPatterns, href)) ?? null;
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
  return state.minimized || state.workspace?.preferences?.pushSiteContent === false ? 0 : TOOLBAR_HEIGHT;
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
    return { clientHtml: "", mainHtml: "", color: "#3a3a3a", text: "#ffffff" };
  }
  const client = findById(workspace.clients, environment.clientId);
  const project = findById(workspace.projects, environment.projectId);
  const product = findById(workspace.products, environment.productId);
  const color = environment.color || "#ef3340";

  const compact = workspace.preferences?.compactMode === true;
  const clientHtml = client ? window.QTS_AVATAR.buildEntityHtml({ ...client, showLabel: true }, { size: 14, maxChars: 18 }) : "";
  const segments = [project, product]
    .filter(Boolean)
    .map((entity) => window.QTS_AVATAR.buildEntityHtml({ ...entity, showLabel: compact ? false : entity.showLabel !== false }, { size: 18, maxChars: 16 }));
  segments.push(`<strong class="qts-environment-name">${escapeHtml(environment.name)}</strong>`);

  return {
    clientHtml,
    mainHtml: segments.join('<span class="qts-crumb-sep">|</span>'),
    color,
    text: contrastTextColor(color),
  };
}

const SENSITIVE_QUERY_KEYS = /^(?:token|access_token|refresh_token|authorization|code|secret|key|password|session)$/i;
function safeCurrentUrl() {
  try {
    const url = new URL(window.location.href);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.test(key)) url.searchParams.set(key, "[oculto]");
    }
    if (/token|secret|password|session/i.test(url.hash)) url.hash = "#oculto";
    return url.href;
  } catch {
    return String(window.location.href).slice(0, 2_048);
  }
}

function applyPinnedTools() {
  const root = state.shadowRoot;
  if (!root) return;
  const pinned = new Set(state.workspace?.preferences?.pinnedTools || []);
  const groups = {
    passFail: ["testStatusButton", "passButton", "failButton"],
    notes: ["noteButton", "shapeButton"],
    screenshot: ["screenshotButton"],
    record: ["recordToggleButton", "recordStopButton", "recordTimer"],
  };
  for (const [key, ids] of Object.entries(groups)) {
    for (const id of ids) root.getElementById(id)?.classList.toggle("isPreferenceHidden", !pinned.has(key));
  }
  const enabledTools = new Set(state.workspace?.preferences?.enabledTools || window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS);
  const menuItems = {
    clickSpy: "clickSpyMenuItem", freezeClock: "freezeClockMenuItem", forceHttp: "forceHttpMenuItem",
    inspectors: "inspectorsMenuItem", jsonStudio: "jsonStudioMenuItem", breakpoints: "breakpointMenuItem",
    testAccounts: "testAccountsMenuItem", paymentMethods: "paymentMethodsMenuItem", resources: "resourcesMenuItem",
    characterCounter: "characterCounterMenuItem", macroStudio: "macroStudioMenuItem", multiClick: "multiClickMenuItem",
    inputLab: "inputLabMenuItem", fakerFill: "fakerFillMenuItem",
  };
  for (const [key, id] of Object.entries(menuItems)) root.getElementById(id)?.classList.toggle("isPreferenceHidden", !enabledTools.has(key));
  renderPinnedMacros();
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
  const currentUrl = safeCurrentUrl();
  const urlElement = root.getElementById("currentUrl");
  urlElement.textContent = currentUrl;
  urlElement.title = currentUrl;
  root.getElementById("restoreButton").classList.toggle("isVisible", state.minimized);
  applyPinnedTools();
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
      #left { min-width: 0; flex: 1 1 auto; display: grid; grid-template-rows: 15px 25px; align-content: center; gap: 1px; }
      #right { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 0 0 auto; }
      #contextRow { min-width: 0; display: flex; align-items: center; gap: 8px; }
      #breadcrumb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 28vw; display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
      .qts-crumb-sep { opacity: .55; }
      .qts-client-label {
        display: inline-flex; align-items: center; gap: 4px; width: max-content; max-width: 220px;
        font-size: 9px; line-height: 14px; font-weight: 700; opacity: .74; overflow: hidden;
      }
      .qts-client-label.isHidden { display: none; }
      .qts-badge-avatar {
        display: inline-flex; align-items: center; justify-content: center; border-radius: 5px;
        color: #fff; font-weight: 800; flex-shrink: 0; object-fit: cover; vertical-align: middle;
      }
      .qts-badge-name { vertical-align: middle; overflow: hidden; text-overflow: ellipsis; }
      #currentUrl {
        position: relative; min-width: 150px; max-width: min(34vw, 620px); height: 24px; padding: 0 11px 0 31px;
        display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid rgba(0,0,0,.2);
        border-radius: 999px; background: rgba(255,255,255,.94); color: #17191f; font-size: 11px; line-height: 22px;
        font-weight: 650; box-shadow: inset 0 1px 2px rgba(0,0,0,.11); direction: ltr;
      }
      #currentUrl::before {
        content: ""; position: absolute; left: 9px; top: 5px; width: 13px; height: 13px; background: #167c4b;
        -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 1.5c.69 0 1.58 1.45 1.94 4.044H6.06C6.42 2.95 7.31 1.5 8 1.5ZM1.5 8c0-.323.024-.64.07-.95h3.37A15.7 15.7 0 0 0 4.9 8c0 .323.014.64.04.95H1.57A6.6 6.6 0 0 1 1.5 8Zm4.52 0c0-.326.015-.644.044-.95h3.872c.029.306.044.624.044.95 0 .326-.015.644-.044.95H6.064A10.5 10.5 0 0 1 6.02 8Zm5.04-.95h3.37c.046.31.07.627.07.95 0 .323-.024.64-.07.95h-3.37c.026-.31.04-.627.04-.95 0-.323-.014-.64-.04-.95ZM2.146 10.456H5.1c.15.866.38 1.676.67 2.386a6.5 6.5 0 0 1-3.624-2.386Zm3.914 0h3.88C9.58 13.05 8.69 14.5 8 14.5c-.69 0-1.58-1.45-1.94-4.044Z'/%3E%3C/svg%3E") center/contain no-repeat;
        mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 1.5c.69 0 1.58 1.45 1.94 4.044H6.06C6.42 2.95 7.31 1.5 8 1.5ZM1.5 8c0-.323.024-.64.07-.95h3.37A15.7 15.7 0 0 0 4.9 8c0 .323.014.64.04.95H1.57A6.6 6.6 0 0 1 1.5 8Zm4.52 0c0-.326.015-.644.044-.95h3.872c.029.306.044.624.044.95 0 .326-.015.644-.044.95H6.064A10.5 10.5 0 0 1 6.02 8Zm5.04-.95h3.37c.046.31.07.627.07.95 0 .323-.024.64-.07.95h-3.37c.026-.31.04-.627.04-.95 0-.323-.014-.64-.04-.95ZM2.146 10.456H5.1c.15.866.38 1.676.67 2.386a6.5 6.5 0 0 1-3.624-2.386Zm3.914 0h3.88C9.58 13.05 8.69 14.5 8 14.5c-.69 0-1.58-1.45-1.94-4.044Z'/%3E%3C/svg%3E") center/contain no-repeat;
      }
      button {
        all: unset; box-sizing: border-box; cursor: pointer; height: 24px; padding: 0 9px;
        display: inline-flex; align-items: center; gap: 5px; border-radius: 7px;
        background: rgba(0,0,0,.2); color: inherit; font: inherit; font-size: 11px; font-weight: 800;
        border: 1px solid rgba(255,255,255,.35); white-space: nowrap;
      }
      button:hover { background: rgba(0,0,0,.32); }
      button.iconOnly { width: 26px; padding: 0; justify-content: center; }
      button.isActive { background: #ffd700 !important; color: #111 !important; border-color: #fff !important; }
      #clearAllButton.isHidden, .isHidden, .isPreferenceHidden { display: none !important; }
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
      #macroRecordingChip { background: #8f0909; color: #fff; border-color: #fff; animation: qts-rec-pulse 1.3s ease-in-out infinite; }
      #pinnedMacrosMenu:empty { display: none; }
      #pinnedMacrosMenu { display: grid; gap: 4px; padding-bottom: 5px; margin-bottom: 2px; border-bottom: 1px solid #292929; }
    </style>
    <div id="bar" role="toolbar" aria-label="Ferramentas de QA">
      <div id="left">
        <span id="clientLabel" class="qts-client-label isHidden"></span>
        <div id="contextRow"><span id="breadcrumb"></span><span id="currentUrl"></span></div>
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
        <button id="macroRecordingChip" class="isHidden" type="button">● Macro <span id="macroStepCount">0</span> · parar</button>
        <div id="toolsWrapper">
          <button id="toolsButton" type="button" title="${escapeHtml(t.tools)}">${escapeHtml(t.tools)} ▾</button>
          <div id="toolsMenu" role="menu">
            <div id="pinnedMacrosMenu"></div>
            <button type="button" id="macroStudioMenuItem" role="menuitem">🧩 ${escapeHtml(t.macroStudioMenuLabel)}</button>
            <button type="button" id="characterCounterMenuItem" role="menuitem">🔤 ${escapeHtml(t.characterCounterMenuLabel)}</button>
            <button type="button" id="multiClickMenuItem" role="menuitem">⚡ ${escapeHtml(t.multiClickMenuLabel)}</button>
            <button type="button" id="inputLabMenuItem" role="menuitem">✅ ${escapeHtml(t.inputLabMenuLabel)}</button>
            <button type="button" id="fakerFillMenuItem" role="menuitem">✨ ${escapeHtml(t.fakerFillMenuLabel)}</button>
            <button type="button" id="clickSpyMenuItem" role="menuitem">🖱 Click Spy</button>
            <button type="button" id="freezeClockMenuItem" role="menuitem">⏸ Freeze Clock</button>
            <button type="button" id="forceHttpMenuItem" role="menuitem">⚠ Force HTTP</button>
            <button type="button" id="inspectorsMenuItem" role="menuitem">{ } ${escapeHtml(t.inspectorsTitle)}<span id="inspectorsBadge" class="qts-badge" style="display:none">0</span></button>
            <button type="button" id="jsonStudioMenuItem" role="menuitem">🧪 ${escapeHtml(t.jsonStudioTitle)}</button>
            <button type="button" id="breakpointMenuItem" role="menuitem">📐 Breakpoint Viewer</button>
            <button type="button" id="testAccountsMenuItem" role="menuitem">🔑 ${escapeHtml(t.testAccountsMenuLabel)}</button>
            <button type="button" id="paymentMethodsMenuItem" role="menuitem">💳 ${escapeHtml(t.paymentMethodsMenuLabel)}</button>
            <button type="button" id="resourcesMenuItem" role="menuitem">🔗 ${escapeHtml(t.resourcesMenuLabel)}</button>
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
  shadow.getElementById("macroRecordingChip").addEventListener("click", () => stopMacroRecording());

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
  shadow.getElementById("paymentMethodsMenuItem").addEventListener("click", () => { openPaymentMethodsDrawer(); closeToolsMenu(); });
  shadow.getElementById("resourcesMenuItem").addEventListener("click", () => { openResourcesDrawer(); closeToolsMenu(); });
  shadow.getElementById("characterCounterMenuItem").addEventListener("click", () => { openCharacterCounter(); closeToolsMenu(); });
  shadow.getElementById("macroStudioMenuItem").addEventListener("click", () => { openMacroStudio(); closeToolsMenu(); });
  shadow.getElementById("multiClickMenuItem").addEventListener("click", () => { openMultiClick(); closeToolsMenu(); });
  shadow.getElementById("inputLabMenuItem").addEventListener("click", () => { openInputLab(); closeToolsMenu(); });
  shadow.getElementById("fakerFillMenuItem").addEventListener("click", () => { openFakerFill(); closeToolsMenu(); });

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
  if (document.getElementById(HOST_ID) || !state.authorized || !state.environment) return;
  const { host, shadow } = buildShadowHost();
  state.shadowRoot = shadow;
  document.documentElement.appendChild(host);

  const spacer = document.createElement("div");
  spacer.id = SPACER_ID;
  if (document.body) document.body.insertBefore(spacer, document.body.firstChild);

  render();
}

function removeToolbar({ disableBridge = false } = {}) {
  cancelElementSelection();
  state.macroRecording?.cleanup?.();
  state.macroRecording = null;
  state.integrityObserver?.disconnect();
  state.integrityObserver = null;
  if (state.integrityInterval) window.clearInterval(state.integrityInterval);
  state.integrityInterval = null;
  document.getElementById(HOST_ID)?.remove();
  document.getElementById(SPACER_ID)?.remove();
  document.querySelectorAll(".qts-modal-backdrop,.qts-result-overlay,.qts-floating-item,.qts-shape-preview").forEach((element) => element.remove());
  state.shadowRoot = null;
  document.documentElement.style.setProperty("--qts-toolbar-height", "0px");
  document.dispatchEvent(new CustomEvent("qts:pagebridge-active", { detail: { active: false } }));
  if (disableBridge) document.dispatchEvent(new CustomEvent("qts:pagebridge-disable"));
}

function syncToolbarForCurrentLocation() {
  state.environment = findActiveEnvironment(state.workspace || { environments: [] });
  if (!state.authorized || !state.environment) {
    removeToolbar();
    return;
  }
  if (!isToolbarHealthy()) mountToolbar();
  else render();
  document.dispatchEvent(new CustomEvent("qts:pagebridge-active", { detail: { active: true } }));
  installIntegrityMonitor();
}

function scheduleRepair() {
  if (!state.authorized || !state.environment) return;
  if (scheduleRepair.timer) return;
  scheduleRepair.timer = window.setTimeout(() => {
    scheduleRepair.timer = null;
    if (!isToolbarHealthy()) mountToolbar();
  }, 80);
}

function installIntegrityMonitor() {
  if (state.integrityObserver) return;
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) =>
      [...mutation.removedNodes].some((node) => node.nodeType === 1 && (node.id === HOST_ID || node.id === SPACER_ID)),
    );
    if (relevant || !isToolbarHealthy()) scheduleRepair();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  state.integrityObserver = observer;
  state.integrityInterval = window.setInterval(() => {
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
  const notesPinned = (state.workspace?.preferences?.pinnedTools || []).includes("notes");
  state.shadowRoot?.getElementById("clearAllButton")?.classList.toggle("isHidden", !hasItems || !notesPinned);
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
    .qts-tool-lead { margin: 0 0 12px; color: #aaa; }
    .qts-tool-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(125px, 1fr)); gap: 8px; margin: 10px 0; }
    .qts-metric { padding: 11px; border: 1px solid #282828; border-radius: 10px; background: #141414; }
    .qts-metric strong { display: block; color: #ffd700; font-size: 20px; }
    .qts-metric small { color: #aaa; }
    .qts-card { padding: 12px; margin-bottom: 8px; border: 1px solid #292929; border-radius: 10px; background: #121212; }
    .qts-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .qts-card-actions { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 9px; }
    .qts-card-actions button.action { height: 28px; font-size: 11px; }
    .qts-tabs { display: inline-flex; gap: 4px; padding: 3px; margin-bottom: 12px; border: 1px solid #292929; border-radius: 9px; }
    .qts-tabs button { padding: 7px 12px; border: 0; border-radius: 7px; background: transparent; color: #aaa; cursor: pointer; font-weight: 800; }
    .qts-tabs button.isSelected { background: #b20808; color: #fff; }
    .qts-macro-layout { display: grid; grid-template-columns: 180px minmax(0,1fr); gap: 12px; }
    .qts-palette { display: grid; align-content: start; gap: 6px; }
    .qts-palette button { padding: 9px; border: 1px dashed #444; border-radius: 8px; background: #171717; color: #fff; cursor: grab; text-align: left; }
    .qts-flow { min-height: 220px; padding: 9px; border: 1px dashed #444; border-radius: 10px; }
    .qts-step { position: relative; display: grid; grid-template-columns: 28px 115px minmax(0,1fr) 32px; gap: 7px; align-items: center; padding: 8px; margin-bottom: 16px; border: 1px solid #333; border-radius: 9px; background: #171717; }
    .qts-step:not(:last-child)::after { content: "↓"; position: absolute; left: 14px; bottom: -18px; color: #ffd700; }
    .qts-step-index { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #b20808; font-weight: 900; }
    .qts-code { min-height: 350px; padding: 14px; border: 1px solid #2c2c2c; border-radius: 10px; background: #080808; color: #9bffb0; font: 12px/1.55 ui-monospace, Consolas, monospace; white-space: pre; overflow: auto; }
    .qts-status { min-height: 18px; margin-top: 8px; color: #ffd700; }
    .qts-result-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .qts-result-table th, .qts-result-table td { padding: 7px; border-bottom: 1px solid #292929; text-align: left; }
    @media (max-width: 680px) { .qts-macro-layout { grid-template-columns: 1fr; } .qts-palette { grid-template-columns: repeat(2,minmax(0,1fr)); } .qts-step { grid-template-columns: 28px 95px minmax(0,1fr) 32px; } }
  `;
}

const QA_SURFACE_TRANSLATIONS = {
  es: {
    "Contador de caracteres": "Contador de caracteres", "Cole ou selecione um texto para medir caracteres, palavras, linhas e bytes.": "Pega o selecciona un texto para medir caracteres, palabras, líneas y bytes.", "Digite ou cole seu texto...": "Escribe o pega tu texto...", "Usar seleção da página": "Usar selección de la página", "Limpar": "Limpiar", "Com espaços": "Con espacios", "Sem espaços": "Sin espacios", "Palavras": "Palabras", "Linhas": "Líneas", "Elemento": "Elemento", "Selecionar na página": "Seleccionar en la página", "Quantidade": "Cantidad", "Intervalo (ms)": "Intervalo (ms)", "Executar multiclick": "Ejecutar multiclic", "Repita cliques em um elemento, com limite e intervalo controlados.": "Repite clics en un elemento con cantidad e intervalo controlados.", "Input Lab": "Laboratorio de inputs", "Selecionar input na página": "Seleccionar input en la página", "Rodar kit de validação": "Ejecutar kit de validación", "Inspecione as regras HTML e teste texto, números, caracteres especiais, Unicode, vazio e limite sem enviar o formulário. O valor original é restaurado.": "Inspecciona las reglas HTML y prueba texto, números, caracteres especiales, Unicode, vacío y límites sin enviar el formulario. El valor original se restaura.", "Caso": "Caso", "Enviado": "Enviado", "Recebido": "Recibido", "Validade": "Validez", "Tipo": "Tipo", "Obrigatório": "Obligatorio", "Mínimo": "Mínimo", "Máximo": "Máximo", "Não": "No", "Sim": "Sí", "Faker Fill": "Relleno con datos ficticios", "Escopo": "Alcance", "Página atual": "Página actual", "Formulário selecionado": "Formulario seleccionado", "Selecionar formulário": "Seleccionar formulario", "Preencher agora": "Rellenar ahora", "Preencha formulários com dados sintéticos locais em um clique. Senhas, cartões, CVV, tokens e campos ocultos são sempre ignorados.": "Rellena formularios con datos sintéticos locales en un clic. Las contraseñas, tarjetas, CVV, tokens y campos ocultos siempre se ignoran.", "Macro Studio": "Estudio de macros", "Gravar macro": "Grabar macro", "+ Nova no Vibe Code": "+ Nueva en Vibe Code", "Importar": "Importar", "Exportar todas": "Exportar todas", "Grave ações ou monte um fluxo visual. Tudo fica local e só ações declarativas validadas são executadas.": "Graba acciones o crea un flujo visual. Todo permanece local y solo se ejecutan acciones declarativas validadas.", "Monte o fluxo arrastando blocos. As setas representam a ordem de execução.": "Crea el flujo arrastrando bloques. Las flechas muestran el orden de ejecución.", "Código Playwright real, gerado do mesmo fluxo. A extensão não executa código colado.": "Código Playwright real generado desde el mismo flujo. La extensión no ejecuta código pegado.", "Nenhuma macro salva. Grave suas ações ou comece no Vibe Code.": "No hay macros guardadas. Graba tus acciones o empieza en Vibe Code.", "Executar": "Ejecutar", "Editar": "Editar", "Fixar no menu": "Fijar en el menú", "Desafixar": "Desfijar", "Exportar": "Exportar", "Excluir": "Eliminar", "Salvar macro": "Guardar macro", "Nome da macro": "Nombre de la macro", "Descrição opcional": "Descripción opcional", "Copiar código": "Copiar código", "Clique": "Clic", "Escrever": "Escribir", "Selecionar": "Seleccionar", "Tecla": "Tecla", "Esperar": "Esperar", "Primeiro formulário": "Primer formulario", "Página": "Página", "Marcar": "Marcar", "Desmarcar": "Desmarcar", "Valor": "Valor", "Seletor CSS": "Selector CSS", "Remover": "Eliminar", "Arraste uma função para cá ou clique em uma opção da paleta.": "Arrastra una función aquí o elige una opción de la paleta.", "Macros": "Macros"
  },
  en: {
    "Contador de caracteres": "Character Counter", "Cole ou selecione um texto para medir caracteres, palavras, linhas e bytes.": "Paste or select text to measure characters, words, lines, and bytes.", "Digite ou cole seu texto...": "Type or paste your text...", "Usar seleção da página": "Use page selection", "Limpar": "Clear", "Com espaços": "With spaces", "Sem espaços": "Without spaces", "Palavras": "Words", "Linhas": "Lines", "Elemento": "Element", "Selecionar na página": "Select on page", "Quantidade": "Count", "Intervalo (ms)": "Interval (ms)", "Executar multiclick": "Run multiclick", "Repita cliques em um elemento, com limite e intervalo controlados.": "Repeat clicks on an element with controlled count and interval.", "Input Lab": "Input Lab", "Selecionar input na página": "Select input on page", "Rodar kit de validação": "Run validation kit", "Inspecione as regras HTML e teste texto, números, caracteres especiais, Unicode, vazio e limite sem enviar o formulário. O valor original é restaurado.": "Inspect HTML constraints and test text, numbers, special characters, Unicode, empty values, and limits without submitting the form. The original value is restored.", "Caso": "Case", "Enviado": "Attempted", "Recebido": "Received", "Validade": "Validity", "Tipo": "Type", "Obrigatório": "Required", "Mínimo": "Minimum", "Máximo": "Maximum", "Não": "No", "Sim": "Yes", "Faker Fill": "Faker Fill", "Escopo": "Scope", "Página atual": "Current page", "Formulário selecionado": "Selected form", "Selecionar formulário": "Select form", "Preencher agora": "Fill now", "Preencha formulários com dados sintéticos locais em um clique. Senhas, cartões, CVV, tokens e campos ocultos são sempre ignorados.": "Fill forms with local synthetic data in one click. Passwords, cards, CVV, tokens, and hidden fields are always skipped.", "Macro Studio": "Macro Studio", "Gravar macro": "Record macro", "+ Nova no Vibe Code": "+ New in Vibe Code", "Importar": "Import", "Exportar todas": "Export all", "Grave ações ou monte um fluxo visual. Tudo fica local e só ações declarativas validadas são executadas.": "Record actions or build a visual flow. Everything stays local and only validated declarative actions run.", "Monte o fluxo arrastando blocos. As setas representam a ordem de execução.": "Build the flow by dragging blocks. Arrows show the execution order.", "Código Playwright real, gerado do mesmo fluxo. A extensão não executa código colado.": "Real Playwright code generated from the same flow. The extension does not execute pasted code.", "Nenhuma macro salva. Grave suas ações ou comece no Vibe Code.": "No saved macros. Record your actions or start in Vibe Code.", "Executar": "Run", "Editar": "Edit", "Fixar no menu": "Pin to menu", "Desafixar": "Unpin", "Exportar": "Export", "Excluir": "Delete", "Salvar macro": "Save macro", "Nome da macro": "Macro name", "Descrição opcional": "Optional description", "Copiar código": "Copy code", "Clique": "Click", "Escrever": "Fill", "Selecionar": "Select", "Tecla": "Key", "Esperar": "Wait", "Primeiro formulário": "First form", "Página": "Page", "Marcar": "Check", "Desmarcar": "Uncheck", "Valor": "Value", "Seletor CSS": "CSS selector", "Remover": "Remove", "Arraste uma função para cá ou clique em uma opção da paleta.": "Drag a function here or choose one from the palette.", "Macros": "Macros"
  },
};

function translateQaSurfaceText(value) {
  const translations = QA_SURFACE_TRANSLATIONS[state.t?.locale];
  if (!translations || !value) return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const core = value.trim();
  let translated = translations[core] || core;
  if (translated === core) {
    const suffix = Object.keys(translations).sort((left, right) => right.length - left.length).find((source) => core.endsWith(` ${source}`));
    if (suffix) translated = `${core.slice(0, -suffix.length)}${translations[suffix]}`;
  }
  if (state.t.locale === "en") translated = translated.replace(/(\d+) etapa\(s\)/g, "$1 step(s)").replace(/(\d+) clique\(s\)/g, "$1 click(s)").replace(/campo\(s\)/g, "field(s)").replace(/sensível\(is\) protegido\(s\)/g, "sensitive field(s) protected");
  if (state.t.locale === "es") translated = translated.replace(/(\d+) etapa\(s\)/g, "$1 etapa(s)").replace(/(\d+) clique\(s\)/g, "$1 clic(s)").replace(/sensível\(is\) protegido\(s\)/g, "campo(s) sensible(s) protegido(s)");
  if (state.t.locale === "en") translated = translated.replace(/^Executando /, "Running ").replace(/^Macro concluída:/, "Macro completed:").replace(/^Macro interrompida:/, "Macro stopped:").replace(/^Não foi possível iniciar a macro com segurança\.$/, "The macro could not be started safely.");
  if (state.t.locale === "es") translated = translated.replace(/^Executando /, "Ejecutando ").replace(/^Macro concluída:/, "Macro completada:").replace(/^Macro interrompida:/, "Macro interrumpida:").replace(/^Não foi possível iniciar a macro com segurança\.$/, "No se pudo iniciar la macro de forma segura.");
  return `${leading}${translated}${trailing}`;
}

function localizeQaSurface(root) {
  if (!root || state.t?.locale === "pt-BR") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const translated = translateQaSurfaceText(node.nodeValue);
      if (translated !== node.nodeValue) node.nodeValue = translated;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      for (const attribute of ["placeholder", "title", "aria-label"]) if (node.hasAttribute(attribute)) node.setAttribute(attribute, translateQaSurfaceText(node.getAttribute(attribute)));
    }
    node = walker.nextNode();
  }
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
  localizeQaSurface(drawerHost);
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
  const configured = (state.workspace.inspectors || []).filter((inspector) => inspector.active !== false && Array.isArray(inspector.patterns) && inspector.patterns.length);
  if (configured.length && !configured.some((inspector) => inspector.patterns.some((pattern) => {
    const candidate = String(pattern || "").trim();
    if (!candidate) return false;
    try { return candidate.includes("*") ? wildcardToRegExp(candidate).test(String(entry?.url || "")) : String(entry?.url || "").toLowerCase().includes(candidate.toLowerCase()); } catch { return false; }
  }))) return;
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

// Payment methods and resources are environment-aware, read-only views of
// local configuration. Sensitive payment values remain masked until a direct
// reveal action and never enter the safe workspace export.
const revealedPaymentMethodIds = new Set();

function maskedPaymentValue(value) {
  const raw = String(value || "");
  if (!raw) return "—";
  const compact = raw.replace(/\s+/g, "");
  const suffix = compact.slice(-4);
  return `${"•".repeat(Math.max(4, Math.min(12, compact.length - suffix.length)))}${suffix}`;
}

function renderPaymentMethodsList() {
  const body = state.shadowRoot.getElementById("drawerBody");
  if (!body) return;
  const methods = (state.workspace.paymentMethods || []).filter((method) => method.active !== false && (!method.environmentId || method.environmentId === state.environment?.id));
  if (!methods.length) {
    body.innerHTML = `<div class="qts-empty">${escapeHtml(state.t.paymentMethodsEmptyForEnv)}</div>`;
    return;
  }
  body.innerHTML = `<div style="display:grid;gap:10px">${methods.map((method) => {
    const revealed = revealedPaymentMethodIds.has(method.id);
    const value = revealed ? escapeHtml(method.value || "—") : escapeHtml(maskedPaymentValue(method.value));
    return `<div class="qts-net-item" style="cursor:default">
      <b>${escapeHtml(method.label || state.t.paymentMethodFallback)}</b> <span style="color:#ffd700">${escapeHtml(method.type || "other")}</span>
      <div style="margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><small>${value}</small>
      ${method.value ? `<button type="button" class="action" data-reveal-payment="${escapeHtml(method.id)}" style="height:22px;padding:0 8px;font-size:10px">${revealed ? "🙈" : "👁"}</button>` : ""}</div>
      ${method.notes ? `<small style="display:block;margin-top:4px;color:#888">${escapeHtml(method.notes)}</small>` : ""}
    </div>`;
  }).join("")}</div>`;
  body.querySelectorAll("[data-reveal-payment]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.revealPayment;
    if (revealedPaymentMethodIds.has(id)) revealedPaymentMethodIds.delete(id); else revealedPaymentMethodIds.add(id);
    renderPaymentMethodsList();
  }));
}

function openPaymentMethodsDrawer() {
  openDrawer({ title: state.t.paymentMethodsDrawerTitle, bodyHtml: "" });
  renderPaymentMethodsList();
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function openResourcesDrawer() {
  const resources = (state.workspace.resources || []).filter((resource) => resource.active !== false).map((resource) => ({ ...resource, safeUrl: safeExternalUrl(resource.url) })).filter((resource) => resource.safeUrl);
  openDrawer({
    title: state.t.resourcesDrawerTitle,
    bodyHtml: resources.length ? `<div style="display:grid;gap:10px">${resources.map((resource) => `<a class="qts-net-item" href="${escapeHtml(resource.safeUrl)}" target="_blank" rel="noopener noreferrer" style="display:block;color:#fff;text-decoration:none"><b>${escapeHtml(resource.label || resource.safeUrl)}</b><small style="display:block;margin-top:4px;color:#888">${escapeHtml(resource.safeUrl)}</small></a>`).join("")}</div>` : `<div class="qts-empty">${escapeHtml(state.t.resourcesEmpty)}</div>`,
  });
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
    .qts-bp-stage { flex: 1; display: flex; align-items: center; align-content: center; justify-content: center; flex-wrap: wrap; gap: 26px; overflow: auto; padding: 20px; }
    .qts-bp-pane { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 0 1 auto; min-width: 0; max-width: 100%; }
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

// ---------------------------------------------------------------------------
// QA productivity kit: counters, Faker Fill, Input Lab, Multiclick and macros.
// ---------------------------------------------------------------------------

function showQaToast(message, tone = "info") {
  if (!state.shadowRoot) return;
  const toast = document.createElement("div");
  toast.textContent = translateQaSurfaceText(message);
  toast.style.cssText = `position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;max-width:min(620px,88vw);padding:10px 16px;border:1px solid ${tone === "error" ? "#ff6767" : "#ffd700"};border-radius:999px;background:#0b0b0b;color:#fff;font:700 12px/1.35 sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.45)`;
  state.shadowRoot.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3_500);
}

async function persistWorkspaceState() {
  state.workspace = await saveWorkspace(state.workspace);
  render();
  return state.workspace;
}

function downloadMacroJson(macros) {
  const payload = { format: "qts-macros", version: 1, exportedAt: new Date().toISOString(), macros };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `qa-macros-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function renderPinnedMacros() {
  const container = state.shadowRoot?.getElementById("pinnedMacrosMenu");
  if (!container) return;
  const pinned = new Set(state.workspace?.preferences?.pinnedMacroIds || []);
  const macros = (state.workspace?.macros || []).filter((macro) => pinned.has(macro.id));
  container.innerHTML = macros.map((macro) => `<button type="button" data-pinned-macro="${escapeHtml(macro.id)}" title="Executar macro">▶ ${escapeHtml(macro.name)}</button>`).join("");
  container.querySelectorAll("[data-pinned-macro]").forEach((button) => button.addEventListener("click", () => {
    const macro = (state.workspace.macros || []).find((item) => item.id === button.dataset.pinnedMacro);
    closeToolsMenu();
    if (macro) void playMacro(macro);
  }));
}

function openCharacterCounter() {
  const selected = String(document.getSelection()?.toString() || "");
  openDrawer({
    title: "Contador de caracteres",
    bodyHtml: `<p class="qts-tool-lead">Cole ou selecione um texto para medir caracteres, palavras, linhas e bytes.</p>
      <textarea id="characterCounterInput" rows="9" placeholder="Digite ou cole seu texto...">${escapeHtml(selected)}</textarea>
      <div class="qts-card-actions"><button class="action" id="useSelection" type="button">Usar seleção da página</button><button class="action" id="clearCounter" type="button">Limpar</button></div>
      <div class="qts-tool-grid" id="characterMetrics"></div>`,
    onReady(body) {
      const input = body.querySelector("#characterCounterInput");
      const output = body.querySelector("#characterMetrics");
      const update = () => {
        const metrics = window.QTS_QA_TOOLS.countCharacters(input.value);
        output.innerHTML = [["Com espaços", metrics.withSpaces], ["Sem espaços", metrics.withoutSpaces], ["Palavras", metrics.words], ["Linhas", metrics.lines], ["Bytes UTF-8", metrics.bytes]].map(([label, value]) => `<div class="qts-metric"><strong>${value}</strong><small>${label}</small></div>`).join("");
      };
      input.addEventListener("input", update);
      body.querySelector("#useSelection").addEventListener("click", () => { input.value = String(document.getSelection()?.toString() || ""); update(); });
      body.querySelector("#clearCounter").addEventListener("click", () => { input.value = ""; update(); input.focus(); });
      update();
    },
  });
}

function cancelElementSelection() {
  state.selectionCleanup?.();
  state.selectionCleanup = null;
}

function selectPageElement({ accepts = () => true, onSelected, instruction }) {
  closeDrawer();
  cancelElementSelection();
  const style = document.createElement("style");
  style.id = "qts-element-selector-style";
  style.textContent = "html.qts-selecting,html.qts-selecting *{cursor:crosshair!important}.qts-selection-candidate{outline:3px solid #ffd700!important;outline-offset:2px!important}";
  document.documentElement.appendChild(style);
  document.documentElement.classList.add("qts-selecting");
  let candidate = null;
  const cleanup = () => {
    candidate?.classList.remove("qts-selection-candidate");
    document.documentElement.classList.remove("qts-selecting");
    style.remove();
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onOver = (event) => {
    if (event.target.closest?.(`#${HOST_ID}`)) return;
    candidate?.classList.remove("qts-selection-candidate");
    candidate = event.target;
    candidate.classList.add("qts-selection-candidate");
  };
  const onClick = (event) => {
    if (event.target.closest?.(`#${HOST_ID}`)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const target = event.target;
    if (!accepts(target)) { showQaToast("Selecione um elemento compatível.", "error"); return; }
    cleanup(); state.selectionCleanup = null; onSelected(target);
  };
  const onKey = (event) => { if (event.key === "Escape") { cleanup(); state.selectionCleanup = null; showQaToast("Seleção cancelada."); } };
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  state.selectionCleanup = cleanup;
  showQaToast(instruction || "Clique no elemento da página. Esc cancela.");
}

function openMultiClick(selectedElement = null) {
  const selector = selectedElement ? window.QTS_QA_TOOLS.uniqueSelector(selectedElement) : "";
  openDrawer({
    title: "Multiclick",
    bodyHtml: `<p class="qts-tool-lead">Repita cliques em um elemento, com limite e intervalo controlados.</p>
      <label>Elemento</label><input id="multiSelector" value="${escapeHtml(selector)}" readonly placeholder="Nenhum elemento selecionado" />
      <div class="qts-card-actions"><button class="action" id="multiSelect" type="button">Selecionar na página</button></div>
      <div class="qts-tool-grid"><label>Quantidade<input id="multiCount" type="number" min="2" max="100" value="5" /></label><label>Intervalo (ms)<input id="multiInterval" type="number" min="0" max="5000" value="150" /></label></div>
      <button class="action primary" id="multiRun" type="button" ${selector ? "" : "disabled"}>Executar multiclick</button><div class="qts-status" id="multiStatus"></div>`,
    onReady(body) {
      body.querySelector("#multiSelect").addEventListener("click", () => selectPageElement({ onSelected: (element) => openMultiClick(element), instruction: "Clique no botão ou elemento que deve receber os cliques." }));
      body.querySelector("#multiRun").addEventListener("click", async (event) => {
        const runButton = event.currentTarget;
        runButton.disabled = true;
        const count = Math.min(100, Math.max(2, Number(body.querySelector("#multiCount").value) || 2));
        const interval = Math.min(5_000, Math.max(0, Number(body.querySelector("#multiInterval").value) || 0));
        const status = body.querySelector("#multiStatus");
        try { await window.QTS_QA_TOOLS.executeStep({ action: "multiClick", selector, count, interval }); status.textContent = `${count} cliques concluídos.`; }
        catch (error) { status.textContent = error.message; }
        runButton.disabled = false;
      });
    },
  });
}

function openInputLab(selectedElement = null) {
  const info = selectedElement ? window.QTS_QA_TOOLS.inspectInput(selectedElement) : null;
  const infoHtml = info ? `<div class="qts-card"><b>${escapeHtml(info.selector)}</b><div class="qts-tool-grid">${[["Tipo", info.type], ["Obrigatório", info.required ? "Sim" : "Não"], ["Mínimo", info.min ?? info.minLength ?? "—"], ["Máximo", info.max ?? info.maxLength ?? "—"], ["Pattern", info.pattern || "—"]].map(([label, value]) => `<div><small>${label}</small><br><b>${escapeHtml(value)}</b></div>`).join("")}</div></div>` : "";
  openDrawer({
    title: "Input Lab",
    bodyHtml: `<p class="qts-tool-lead">Inspecione as regras HTML e teste texto, números, caracteres especiais, Unicode, vazio e limite sem enviar o formulário. O valor original é restaurado.</p>
      <button class="action" id="inputSelect" type="button">Selecionar input na página</button>${infoHtml}
      ${info ? `<button class="action primary" id="inputRun" type="button" ${info.sensitive ? "disabled" : ""}>Rodar kit de validação</button><div id="inputResults"></div>` : ""}`,
    onReady(body) {
      body.querySelector("#inputSelect").addEventListener("click", () => selectPageElement({ accepts: (element) => ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName), onSelected: (element) => openInputLab(element), instruction: "Clique no input que deseja validar." }));
      body.querySelector("#inputRun")?.addEventListener("click", async (event) => {
        const runButton = event.currentTarget;
        runButton.disabled = true;
        const output = body.querySelector("#inputResults"); output.textContent = "Testando...";
        try {
          const results = await window.QTS_QA_TOOLS.runInputValidation(selectedElement);
          output.innerHTML = `<table class="qts-result-table"><thead><tr><th>Caso</th><th>Enviado</th><th>Recebido</th><th>Validade</th></tr></thead><tbody>${results.map((result) => `<tr><td>${escapeHtml(result.name)}</td><td>${result.attemptedLength}</td><td>${result.actualLength}</td><td>${result.accepted ? "✓ aceito" : `✕ ${escapeHtml(result.message || "rejeitado")}`}</td></tr>`).join("")}</tbody></table>`;
        } catch (error) { output.textContent = error.message; }
        runButton.disabled = false;
      });
    },
  });
}

function openFakerFill(selectedRoot = null) {
  openDrawer({
    title: "Faker Fill",
    bodyHtml: `<p class="qts-tool-lead">Preencha formulários com dados sintéticos locais em um clique. Senhas, cartões, CVV, tokens e campos ocultos são sempre ignorados.</p>
      <div class="qts-card"><b>Escopo</b><p>${selectedRoot ? "Formulário selecionado" : "Página atual"}</p></div>
      <div class="qts-card-actions"><button class="action" id="fakerSelectForm" type="button">Selecionar formulário</button><button class="action primary" id="fakerRun" type="button">Preencher agora</button></div><div class="qts-status" id="fakerStatus"></div>`,
    onReady(body) {
      body.querySelector("#fakerSelectForm").addEventListener("click", () => selectPageElement({ accepts: (element) => Boolean(element.closest("form")), onSelected: (element) => openFakerFill(element.closest("form")), instruction: "Clique dentro do formulário que deseja preencher." }));
      body.querySelector("#fakerRun").addEventListener("click", () => {
        const result = window.QTS_QA_TOOLS.fillWithFakeData(selectedRoot || document);
        body.querySelector("#fakerStatus").textContent = `${result.filled} campo(s) preenchido(s); ${result.protectedCount} sensível(is) protegido(s).`;
      });
    },
  });
}

function appendRecordedStep(step) {
  const recording = state.macroRecording;
  if (!recording || recording.steps.length >= 200) return;
  const elapsed = Date.now() - recording.lastAt;
  if (recording.steps.length && elapsed > 700) recording.steps.push({ action: "wait", ms: Math.min(3_000, elapsed) });
  const previous = recording.steps.at(-1);
  if (previous && previous.action === step.action && previous.selector === step.selector && ["fill", "select", "check"].includes(step.action)) recording.steps[recording.steps.length - 1] = step;
  else recording.steps.push(step);
  recording.lastAt = Date.now();
  const count = state.shadowRoot?.getElementById("macroStepCount");
  if (count) count.textContent = recording.steps.length;
}

function startMacroRecording() {
  if (state.macroRecording) return;
  closeDrawer();
  const click = (event) => {
    const element = event.target;
    if (!(element instanceof Element) || element.closest(`#${HOST_ID}`) || window.QTS_QA_TOOLS.isSensitiveElement(element)) return;
    if (element.matches("input,textarea,select,option")) return;
    const target = element.closest("button,a,[role=button],label") || element;
    const selector = window.QTS_QA_TOOLS.uniqueSelector(target);
    if (selector) appendRecordedStep({ action: "click", selector });
  };
  const change = (event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) || window.QTS_QA_TOOLS.isSensitiveElement(element)) return;
    const selector = window.QTS_QA_TOOLS.uniqueSelector(element);
    if (!selector) return;
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) appendRecordedStep({ action: "check", selector, checked: element.checked });
    else appendRecordedStep({ action: element instanceof HTMLSelectElement ? "select" : "fill", selector, value: element.value });
  };
  const keydown = (event) => {
    if (!["Enter", "Escape", "Tab"].includes(event.key) || window.QTS_QA_TOOLS.isSensitiveElement(event.target)) return;
    const selector = window.QTS_QA_TOOLS.uniqueSelector(event.target);
    if (selector) appendRecordedStep({ action: "press", selector, value: event.key });
  };
  document.addEventListener("click", click, true);
  document.addEventListener("change", change, true);
  document.addEventListener("keydown", keydown, true);
  state.macroRecording = { steps: [], lastAt: Date.now(), cleanup: () => { document.removeEventListener("click", click, true); document.removeEventListener("change", change, true); document.removeEventListener("keydown", keydown, true); } };
  state.shadowRoot?.getElementById("macroRecordingChip")?.classList.remove("isHidden");
  showQaToast("Gravação iniciada. Senhas e dados sensíveis não serão capturados.");
}

function stopMacroRecording() {
  const recording = state.macroRecording;
  if (!recording) return;
  recording.cleanup();
  state.macroRecording = null;
  state.shadowRoot?.getElementById("macroRecordingChip")?.classList.add("isHidden");
  openMacroEditor({ id: crypto.randomUUID(), name: `Macro ${new Date().toLocaleTimeString().slice(0, 5)}`, description: "", steps: recording.steps.filter((step, index, all) => !(step.action === "wait" && index === all.length - 1)) });
}

function macroRunRequest(operation, run) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type: "qts:macro-run", operation, run }, (response) => resolve(chrome.runtime.lastError ? { ok: false } : response || { ok: false })));
}

async function continueMacroRun(run, { announce = false } = {}) {
  if (state.macroPlaying || !run || run.expiresAt <= Date.now()) { if (run) await macroRunRequest("clear"); return; }
  const macro = (state.workspace?.macros || []).find((item) => item.id === run.macroId);
  if (!macro?.steps?.length || run.index >= macro.steps.length) { await macroRunRequest("clear"); return; }
  state.macroPlaying = true;
  if (announce) showQaToast(`Executando “${macro.name}”...`);
  try {
    for (let index = run.index; index < macro.steps.length; index += 1) {
      await macroRunRequest("set", { ...run, index: index + 1 });
      await window.QTS_QA_TOOLS.executeStep(macro.steps[index]);
    }
    await macroRunRequest("clear");
    showQaToast(`Macro concluída: ${macro.steps.length} etapa(s).`);
  } catch (error) {
    await macroRunRequest("clear");
    showQaToast(`Macro interrompida: ${error.message}`, "error");
  }
  state.macroPlaying = false;
}

async function playMacro(macro) {
  if (state.macroPlaying || !macro?.steps?.length) return;
  const run = { macroId: macro.id, index: 0, expiresAt: Date.now() + 10 * 60_000 };
  const saved = await macroRunRequest("set", run);
  if (!saved?.ok) { showQaToast("Não foi possível iniciar a macro com segurança.", "error"); return; }
  await continueMacroRun(run, { announce: true });
}

function defaultMacroStep(action) {
  if (action === "wait") return { action, ms: 500 };
  if (action === "scroll") return { action, y: 500 };
  if (action === "fakerFill") return { action, scope: "page" };
  if (action === "multiClick") return { action, selector: "button", count: 2, interval: 100 };
  if (action === "check") return { action, selector: "input[type=checkbox]", checked: true };
  if (["fill", "select", "press"].includes(action)) return { action, selector: "input", value: action === "press" ? "Enter" : "" };
  return { action: "click", selector: "button" };
}

function macroStepFields(step) {
  if (step.action === "wait") return `<input data-field="ms" type="number" min="0" max="30000" value="${Number(step.ms) || 500}" aria-label="Espera em milissegundos" />`;
  if (step.action === "scroll") return `<input data-field="y" type="number" value="${Number(step.y) || 0}" aria-label="Posição vertical" />`;
  if (step.action === "fakerFill") return `<select data-field="scope"><option value="page" ${step.scope !== "form" ? "selected" : ""}>Página</option><option value="form" ${step.scope === "form" ? "selected" : ""}>Primeiro formulário</option></select>`;
  const selector = `<input data-field="selector" value="${escapeHtml(step.selector || "")}" placeholder="Seletor CSS" aria-label="Seletor CSS" />`;
  if (step.action === "check") return `${selector}<select data-field="checked"><option value="true" ${step.checked !== false ? "selected" : ""}>Marcar</option><option value="false" ${step.checked === false ? "selected" : ""}>Desmarcar</option></select>`;
  if (step.action === "multiClick") return `${selector}<span style="display:flex;gap:5px"><input data-field="count" type="number" min="2" max="100" value="${Number(step.count) || 2}" aria-label="Quantidade" /><input data-field="interval" type="number" min="0" max="5000" value="${Number(step.interval) || 100}" aria-label="Intervalo" /></span>`;
  if (["fill", "select", "press"].includes(step.action)) return `${selector}<input data-field="value" value="${escapeHtml(step.value || "")}" placeholder="Valor" aria-label="Valor" />`;
  return selector;
}

function renderMacroFlow(container, steps, refreshCode) {
  const actions = [["click", "Clique"], ["fill", "Escrever"], ["select", "Selecionar"], ["check", "Checkbox"], ["press", "Tecla"], ["wait", "Esperar"], ["scroll", "Scroll"], ["multiClick", "Multiclick"], ["fakerFill", "Faker Fill"]];
  container.innerHTML = steps.length ? steps.map((step, index) => `<div class="qts-step" draggable="true" data-step-index="${index}"><span class="qts-step-index">${index + 1}</span><select data-field="action">${actions.map(([value, label]) => `<option value="${value}" ${step.action === value ? "selected" : ""}>${label}</option>`).join("")}</select><div data-step-fields>${macroStepFields(step)}</div><button class="qts-icon-btn" type="button" data-remove-step title="Remover">×</button></div>`).join("") : `<div class="qts-empty">Arraste uma função para cá ou clique em uma opção da paleta.</div>`;
  container.querySelectorAll("[data-step-index]").forEach((row) => {
    const index = Number(row.dataset.stepIndex);
    row.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/qts-step", String(index)));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData("text/qts-step")); if (Number.isInteger(from) && from !== index) { const [moved] = steps.splice(from, 1); steps.splice(index, 0, moved); renderMacroFlow(container, steps, refreshCode); refreshCode(); } });
    row.querySelector("[data-remove-step]").addEventListener("click", () => { steps.splice(index, 1); renderMacroFlow(container, steps, refreshCode); refreshCode(); });
    row.querySelector("[data-field=action]").addEventListener("change", (event) => { steps[index] = defaultMacroStep(event.target.value); renderMacroFlow(container, steps, refreshCode); refreshCode(); });
    row.querySelectorAll("input,select").forEach((field) => field.addEventListener("input", refreshCode));
  });
}

function collectMacroEditor(body, original, steps) {
  const collected = steps.map((step, index) => {
    const row = body.querySelector(`[data-step-index="${index}"]`);
    if (!row) return step;
    const get = (name) => row.querySelector(`[data-field="${name}"]`)?.value;
    const action = get("action") || step.action;
    const output = { action };
    if (!["wait", "scroll", "fakerFill"].includes(action)) output.selector = get("selector") || "";
    if (["fill", "select", "press"].includes(action)) output.value = get("value") || "";
    if (action === "check") output.checked = get("checked") !== "false";
    if (action === "wait") output.ms = Number(get("ms")) || 500;
    if (action === "scroll") output.y = Number(get("y")) || 0;
    if (action === "multiClick") { output.count = Number(get("count")) || 2; output.interval = Number(get("interval")) || 100; }
    if (action === "fakerFill") output.scope = get("scope") === "form" ? "form" : "page";
    return output;
  });
  return { ...original, name: body.querySelector("#macroName").value.trim(), description: body.querySelector("#macroDescription").value.trim(), updatedAt: new Date().toISOString(), steps: collected };
}

function openMacroEditor(macro) {
  const original = structuredClone(macro);
  const steps = structuredClone(macro.steps || []);
  const palette = [["click", "🖱 Clique"], ["fill", "⌨ Escrever"], ["select", "▾ Selecionar"], ["check", "☑ Checkbox"], ["press", "↵ Tecla"], ["wait", "⏱ Esperar"], ["scroll", "↕ Scroll"], ["multiClick", "⚡ Multiclick"], ["fakerFill", "✨ Faker Fill"]];
  openDrawer({
    title: "Macro Studio",
    wide: true,
    bodyHtml: `<div class="qts-toolbar-row"><button class="action" id="macroBack" type="button">← Macros</button><input id="macroName" value="${escapeHtml(macro.name)}" placeholder="Nome da macro" /><button class="action primary" id="macroSave" type="button">Salvar macro</button></div>
      <textarea id="macroDescription" rows="2" placeholder="Descrição opcional">${escapeHtml(macro.description || "")}</textarea>
      <div class="qts-tabs"><button type="button" class="isSelected" data-macro-mode="vibe">Vibe Code</button><button type="button" data-macro-mode="coder">Coder</button></div>
      <section id="vibeMode"><p class="qts-tool-lead">Monte o fluxo arrastando blocos. As setas representam a ordem de execução.</p><div class="qts-macro-layout"><aside class="qts-palette">${palette.map(([action, label]) => `<button type="button" draggable="true" data-palette-action="${action}">${label}</button>`).join("")}</aside><div class="qts-flow" id="macroFlow"></div></div></section>
      <section id="coderMode" hidden><div class="qts-toolbar-row"><p class="qts-tool-lead" style="flex:1">Código Playwright real, gerado do mesmo fluxo. A extensão não executa código colado.</p><button class="action" id="copyMacroCode" type="button">Copiar código</button></div><pre class="qts-code" id="macroCode"></pre></section><div class="qts-status" id="macroEditorStatus"></div>`,
    onReady(body) {
      const flow = body.querySelector("#macroFlow");
      const current = () => collectMacroEditor(body, original, steps);
      const refreshCode = () => { body.querySelector("#macroCode").textContent = window.QTS_QA_TOOLS.generatePlaywrightCode(current()); };
      renderMacroFlow(flow, steps, refreshCode); refreshCode();
      body.querySelectorAll("[data-palette-action]").forEach((button) => {
        button.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/qts-new-action", button.dataset.paletteAction));
        button.addEventListener("click", () => { steps.push(defaultMacroStep(button.dataset.paletteAction)); renderMacroFlow(flow, steps, refreshCode); refreshCode(); });
      });
      flow.addEventListener("dragover", (event) => event.preventDefault());
      flow.addEventListener("drop", (event) => { const action = event.dataTransfer.getData("text/qts-new-action"); if (action) { event.preventDefault(); steps.push(defaultMacroStep(action)); renderMacroFlow(flow, steps, refreshCode); refreshCode(); } });
      body.querySelectorAll("[data-macro-mode]").forEach((button) => button.addEventListener("click", () => { body.querySelectorAll("[data-macro-mode]").forEach((item) => item.classList.toggle("isSelected", item === button)); body.querySelector("#vibeMode").hidden = button.dataset.macroMode !== "vibe"; body.querySelector("#coderMode").hidden = button.dataset.macroMode !== "coder"; refreshCode(); }));
      body.querySelector("#macroName").addEventListener("input", refreshCode);
      body.querySelector("#macroBack").addEventListener("click", openMacroStudio);
      body.querySelector("#copyMacroCode").addEventListener("click", () => navigator.clipboard.writeText(body.querySelector("#macroCode").textContent).then(() => { body.querySelector("#macroEditorStatus").textContent = "Código copiado."; }).catch(() => {}));
      body.querySelector("#macroSave").addEventListener("click", async () => {
        const next = current();
        if (!next.name || !next.steps.length) { body.querySelector("#macroEditorStatus").textContent = "Informe um nome e adicione ao menos uma etapa."; return; }
        const index = (state.workspace.macros || []).findIndex((item) => item.id === next.id);
        if (index >= 0) state.workspace.macros[index] = next; else state.workspace.macros.push({ ...next, createdAt: new Date().toISOString() });
        await persistWorkspaceState(); openMacroStudio(); showQaToast("Macro salva.");
      });
    },
  });
}

async function importMacrosFile(file) {
  if (!file || file.size > 1_000_000) throw new Error("Arquivo acima de 1 MB");
  const parsed = JSON.parse(await file.text());
  if (parsed?.format !== "qts-macros" || parsed?.version !== 1 || !Array.isArray(parsed.macros)) throw new Error("Formato de macro inválido");
  const existing = new Set((state.workspace.macros || []).map((macro) => macro.id));
  const imported = parsed.macros.slice(0, 100).map((macro) => ({ ...macro, id: existing.has(macro.id) ? crypto.randomUUID() : macro.id || crypto.randomUUID() }));
  state.workspace.macros = [...(state.workspace.macros || []), ...imported].slice(0, 100);
  await persistWorkspaceState();
  return imported.length;
}

function openMacroStudio() {
  const macros = state.workspace?.macros || [];
  const pinned = new Set(state.workspace?.preferences?.pinnedMacroIds || []);
  openDrawer({
    title: "Macro Studio",
    wide: true,
    bodyHtml: `<p class="qts-tool-lead">Grave ações ou monte um fluxo visual. Tudo fica local e só ações declarativas validadas são executadas.</p>
      <div class="qts-toolbar-row"><button class="action primary" id="startMacroRecording" type="button">● Gravar macro</button><button class="action" id="newMacro" type="button">+ Nova no Vibe Code</button><button class="action" id="importMacros" type="button">Importar</button><button class="action" id="exportAllMacros" type="button" ${macros.length ? "" : "disabled"}>Exportar todas</button><input id="macroFile" type="file" accept="application/json,.json" hidden /></div>
      <div id="macroList">${macros.length ? macros.map((macro) => `<article class="qts-card" data-macro-id="${escapeHtml(macro.id)}"><div class="qts-card-head"><div><b>${escapeHtml(macro.name)}</b><br><small>${macro.steps.length} etapa(s)${macro.description ? ` · ${escapeHtml(macro.description)}` : ""}</small></div><span>${pinned.has(macro.id) ? "📌" : ""}</span></div><div class="qts-card-actions"><button class="action primary" data-macro-action="play" type="button">▶ Executar</button><button class="action" data-macro-action="edit" type="button">Editar</button><button class="action" data-macro-action="pin" type="button">${pinned.has(macro.id) ? "Desafixar" : "Fixar no menu"}</button><button class="action" data-macro-action="export" type="button">Exportar</button><button class="action" data-macro-action="delete" type="button">Excluir</button></div></article>`).join("") : `<div class="qts-empty">Nenhuma macro salva. Grave suas ações ou comece no Vibe Code.</div>`}</div><div class="qts-status" id="macroStatus"></div>`,
    onReady(body) {
      body.querySelector("#startMacroRecording").addEventListener("click", startMacroRecording);
      body.querySelector("#newMacro").addEventListener("click", () => openMacroEditor({ id: crypto.randomUUID(), name: "Nova macro", description: "", steps: [] }));
      body.querySelector("#exportAllMacros").addEventListener("click", () => downloadMacroJson(macros));
      const file = body.querySelector("#macroFile");
      body.querySelector("#importMacros").addEventListener("click", () => file.click());
      file.addEventListener("change", async () => { try { const count = await importMacrosFile(file.files[0]); openMacroStudio(); showQaToast(`${count} macro(s) importada(s).`); } catch (error) { body.querySelector("#macroStatus").textContent = error.message; } });
      body.querySelectorAll("[data-macro-id]").forEach((card) => card.addEventListener("click", async (event) => {
        const action = event.target.dataset.macroAction; if (!action) return;
        const macro = (state.workspace.macros || []).find((item) => item.id === card.dataset.macroId); if (!macro) return;
        if (action === "play") { closeDrawer(); await playMacro(macro); }
        if (action === "edit") openMacroEditor(macro);
        if (action === "export") downloadMacroJson([macro]);
        if (action === "pin") { const ids = new Set(state.workspace.preferences.pinnedMacroIds || []); if (ids.has(macro.id)) ids.delete(macro.id); else ids.add(macro.id); state.workspace.preferences.pinnedMacroIds = [...ids].slice(0, 20); await persistWorkspaceState(); openMacroStudio(); }
        if (action === "delete" && confirm(`Excluir a macro “${macro.name}”?`)) { state.workspace.macros = state.workspace.macros.filter((item) => item.id !== macro.id); state.workspace.preferences.pinnedMacroIds = (state.workspace.preferences.pinnedMacroIds || []).filter((id) => id !== macro.id); await persistWorkspaceState(); openMacroStudio(); }
      }));
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

function requestAccessState(force = false) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "qts:get-access-state", force }, (response) => {
      if (chrome.runtime.lastError) return resolve({ active: false });
      resolve(response || { active: false });
    });
  });
}

async function refreshAuthorization(force = false) {
  const access = await requestAccessState(force);
  state.authorized = access.active === true;
  if (!state.authorized) removeToolbar({ disableBridge: true });
  else syncToolbarForCurrentLocation();
  return state.authorized;
}

async function boot() {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    return;
  }

  state.t = await window.QTS_I18N.load();
  state.workspace = await getWorkspace();
  if (!await refreshAuthorization(true)) return;

  onStorageChanged(async (changes) => {
    if (!changes[STORAGE_KEYS.workspace]) return;
    state.workspace = await getWorkspace();
    syncToolbarForCurrentLocation();
  });

  document.addEventListener("qts:location-change", () => syncToolbarForCurrentLocation());
  window.addEventListener("popstate", () => syncToolbarForCurrentLocation());
  window.addEventListener("hashchange", () => syncToolbarForCurrentLocation());
  state.locationInterval = window.setInterval(() => {
    if (state.lastHref === window.location.href) return;
    state.lastHref = window.location.href;
    syncToolbarForCurrentLocation();
  }, 200);
  state.accessInterval = window.setInterval(() => { void refreshAuthorization(true); }, 60_000);
  const pendingRun = await macroRunRequest("get");
  if (pendingRun?.ok && pendingRun.run) void continueMacroRun(pendingRun.run, { announce: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "qts:remove-toolbar") {
    state.authorized = false;
    removeToolbar({ disableBridge: true });
    sendResponse({ removed: true });
    return undefined;
  }
  if (message?.type === "qts:sync-toolbar") {
    refreshAuthorization(true).then((active) => sendResponse({ present: true, active }));
    return true;
  }
  return undefined;
});

void boot();
