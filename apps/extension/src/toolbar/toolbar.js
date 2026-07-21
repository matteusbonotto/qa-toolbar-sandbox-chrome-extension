const { getWorkspace, saveWorkspace, onStorageChanged, STORAGE_KEYS } = window.QTS_STORAGE;
const ICON = window.QTS_ICONS.svg;

// 24px of tallest inner content (buttons, #currentUrl) plus a tight 2px top/bottom — founder
// feedback: the old fixed 48px box centered that same content with ~11px of empty space above and
// below it, reading as unnecessarily thick. Every consumer of this constant (spacer height, marker
// placement floor, header-offset math) shares it, so this single number is the actual rendered bar
// height everywhere, not just in the CSS below.
const TOOLBAR_HEIGHT = 28;
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
  httpErrors: [],
  t: null,
  authorized: false,
  features: {},
  integrityObserver: null,
  integrityInterval: null,
  accessInterval: null,
  locationInterval: null,
  lastHref: window.location.href,
  macroRecording: null,
  macroPlaying: false,
  selectionCleanup: null,
  keyView: {
    listening: false,
    cleanup: null,
    shortcutTimer: null,
    mouseTimer: null,
    typingText: "",
    pointerX: 24,
    pointerY: 72,
  },
};

const FORCE_HTTP_STATUSES = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503];

function getTestStatusOptions() {
  const t = state.t;
  return [
    { key: "pass", label: t.statusPass, icon: ICON("pass"), color: "#179153" },
    { key: "fail", label: t.statusFail, icon: ICON("fail"), color: "#c70e0e" },
    { key: "blocked", label: t.statusBlocked, icon: ICON("blocked"), color: "#a34b05" },
    { key: "limitation", label: t.statusLimitation, icon: ICON("warning"), color: "#5b21b6" },
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

function findById(collection, id) {
  return (collection || []).find((item) => item.id === id) ?? null;
}

// Environments no longer own a product/URL directly (see storage.js's normalizeUrlBindings for
// why) — matching now goes through the binding that owns the concrete pattern, then resolves
// product/project/client from *that* binding's productId. The returned object keeps the same
// shape every existing consumer (buildBreadcrumb, resolveEnvironmentUrl, test account/payment
// filters) already expects — id/name/color plus computed productId/projectId/clientId/
// urlPatterns/primaryUrl — so only this function and the active-binding-aware filters below need
// to change, not every place that reads `state.environment`.
function findActiveEnvironment(workspace) {
  const href = window.location.href;
  const binding = (workspace.urlBindings || []).find((candidate) => candidate.active !== false && matchesAnyPattern(candidate.patterns || [], href));
  if (!binding) return null;
  const environment = findById(workspace.environments, binding.environmentIds[0]);
  const product = findById(workspace.products, binding.productId);
  if (!environment || environment.active === false || !product) return null;
  const project = findById(workspace.projects, product.projectId);
  return {
    ...environment,
    productId: product.id,
    projectId: project?.id ?? null,
    clientId: project?.clientId ?? null,
    urlPatterns: binding.patterns || [],
    primaryUrl: binding.primaryUrl || "",
  };
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

const HEADER_OFFSET_ATTR = "data-qts-header-offset";
// Above this, a site header's own z-index is fighting our bar for the top stacking slot instead
// of just sitting fixed at its natural position — matches tampermonkey.js's threshold
// (qaCnkOffsetSiteFixedElements), which clamps anything this high back down.
const HEADER_ZINDEX_CONTEST_THRESHOLD = 2_147_483_646;

function clearSiteFixedHeaderOffsets() {
  document.querySelectorAll(`[${HEADER_OFFSET_ATTR}]`).forEach((element) => {
    element.style.setProperty("top", element.getAttribute(`${HEADER_OFFSET_ATTR}-original-top`) || "");
    element.style.setProperty("z-index", element.getAttribute(`${HEADER_OFFSET_ATTR}-original-zindex`) || "");
    element.removeAttribute(HEADER_OFFSET_ATTR);
    element.removeAttribute(`${HEADER_OFFSET_ATTR}-original-top`);
    element.removeAttribute(`${HEADER_OFFSET_ATTR}-original-zindex`);
  });
}

/**
 * The spacer div pushes normal-flow content down, but a site's own position:fixed/sticky header
 * (common on real QA targets) ignores document flow entirely and stays glued under our bar
 * instead of below it. Ported from tampermonkey.js's proven `offsetSiteFixedElements` /
 * `keepSiteFixedElementsBelowWindowsill` (the reference this extension is a rewrite of) after
 * confirming it handles cases this port's original point-sampling approach missed: it walks
 * every element under <body> (not just a few elementsFromPoint samples), matches `sticky` too
 * (not just `fixed`), nudges the real `top` property instead of `margin-top` (which is a no-op
 * for a fixed element that already declares its own `top`), and — separately, see
 * installHeaderOffsetMonitor() — re-runs continuously instead of only on toolbar render.
 */
function offsetSiteFixedHeaders() {
  // The monitor below watches style/class mutations to catch a site header that moves or
  // appears after our last render — but this function itself mutates style/class on matching
  // elements, so without disconnecting first, applying an offset would immediately re-trigger
  // the same observer and loop forever (confirmed live: an earlier version of this function hung
  // the page solid).
  state.headerOffsetObserver?.disconnect();
  clearSiteFixedHeaderOffsets();
  const height = getCurrentHeight();
  if (!height) {
    state.headerOffsetObserver?.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    return;
  }
  const host = document.getElementById(HOST_ID);
  document.body?.querySelectorAll("*").forEach((element) => {
    if (element === host || host?.contains(element)) return;
    if (element.id === SPACER_ID || element.hasAttribute(HEADER_OFFSET_ATTR)) return;
    const computed = getComputedStyle(element);
    if (computed.position !== "fixed" && computed.position !== "sticky") return;
    const currentTop = Number.parseFloat(computed.top);
    if (!Number.isFinite(currentTop) || currentTop > height + 8) return;
    const rect = element.getBoundingClientRect();
    if (rect.height === 0) return;
    element.setAttribute(HEADER_OFFSET_ATTR, "true");
    element.setAttribute(`${HEADER_OFFSET_ATTR}-original-top`, element.style.top || "");
    element.setAttribute(`${HEADER_OFFSET_ATTR}-original-zindex`, element.style.zIndex || "");
    element.style.setProperty("top", `${currentTop + height}px`, "important");
    const currentZIndex = Number.parseInt(computed.zIndex, 10);
    if (Number.isFinite(currentZIndex) && currentZIndex >= HEADER_ZINDEX_CONTEST_THRESHOLD) {
      element.style.setProperty("z-index", "2147483600", "important");
    }
  });
  state.headerOffsetObserver?.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
}

// Wildcard urlPatterns (e.g. "https://*.example.com/*") aren't real navigable addresses — this
// only resolves the common single-trailing-wildcard case (strip it, use the rest verbatim) so
// simple environments are clickable without requiring the explicit primaryUrl field; anything
// with an embedded wildcard just fails URL parsing and stays non-clickable, which is the correct
// fallback (primaryUrl exists precisely for that case).
function resolveEnvironmentUrl(environment) {
  if (environment?.primaryUrl) return environment.primaryUrl;
  const pattern = (environment?.urlPatterns || []).find((value) => typeof value === "string" && value.length);
  if (!pattern) return null;
  try { return new URL(pattern.replace(/\*+$/, "")).href; } catch { return null; }
}

/**
 * White-label breadcrumb: by default Client renders as a small, de-emphasized corner
 * label (logo/initials only by default), while Project → Product → Environment
 * form the main sequence — but preferences.breadcrumbOrder can move Client into the main
 * sequence too (it only stays in the corner slot when it's first in that order), each entity
 * rendering as a logo image, or — when no logo is set — an auto-generated colored initials
 * badge, so a brand-new client/project/product is never a blank space. Per-entity `showLabel`
 * controls whether the name is spelled out next to the badge. Each visible tier is
 * independently toggleable via preferences.breadcrumbVisibility, and (when the environment
 * resolves to a real URL) clickable to jump back to it — wired via event delegation in
 * buildShadowHost(), since this only ever returns markup, not listeners.
 */
function buildBreadcrumb(workspace, environment) {
  if (!environment) {
    return { clientHtml: "", mainHtml: "", color: "#3a3a3a", text: "#ffffff" };
  }
  const entityFor = {
    client: findById(workspace.clients, environment.clientId),
    project: findById(workspace.projects, environment.projectId),
    product: findById(workspace.products, environment.productId),
  };
  const color = environment.color || "#ef3340";
  const visibility = workspace.preferences?.breadcrumbVisibility || {};
  const navUrl = resolveEnvironmentUrl(environment);

  const wrapCrumb = (html) => (navUrl
    ? `<button type="button" class="qts-crumb-link" data-crumb-nav="${escapeHtml(navUrl)}">${html}</button>`
    : html);

  const legacyCompact = workspace.preferences?.compactMode === true;
  const compactEntities = workspace.preferences?.compactEntities || { project: legacyCompact, product: legacyCompact };
  const badge = (key, size, maxChars) => {
    if (key === "environment") return wrapCrumb(`<strong class="qts-environment-name">${escapeHtml(environment.name)}</strong>`);
    const entity = entityFor[key];
    if (!entity) return "";
    return wrapCrumb(window.QTS_AVATAR.buildEntityHtml({ ...entity, showLabel: compactEntities[key] === true ? false : entity.showLabel !== false }, { size, maxChars }));
  };

  const order = workspace.preferences?.breadcrumbOrder || ["client", "project", "product"];
  const clientIsFirst = order[0] === "client";
  const clientHtml = clientIsFirst && visibility.client !== false ? badge("client", 14, 18) : "";
  const mainKeys = clientIsFirst ? order.slice(1) : order;
  const segments = mainKeys
    .filter((key) => visibility[key] !== false)
    .map((key) => badge(key, 18, 16))
    .filter(Boolean);
  if (visibility.environment !== false) segments.push(badge("environment"));

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

// Sound effects: short cues for test status results, HTTP errors captured by the network
// inspector, and macro playback starting. Disabled entirely via preferences.soundEffects.
const SOUND_FILES = {
  pass: "src/assets/sounds/test-pass.mp3",
  fail: "src/assets/sounds/test-fail.mp3",
  blocked: "src/assets/sounds/test-block.mp3",
  limitation: "src/assets/sounds/test-block.mp3",
  httpError: "src/assets/sounds/http-error.mp3",
  macroPlay: "src/assets/sounds/play-macro.mp3",
};

function soundEffectsEnabled() {
  return state.workspace?.preferences?.soundEffects !== false;
}

function playSound(key) {
  if (!soundEffectsEnabled()) return;
  const path = SOUND_FILES[key];
  if (!path) return;
  try {
    const audio = new Audio(chrome.runtime.getURL(path));
    audio.volume = 0.6;
    void audio.play().catch(() => {});
  } catch {
    // Ignore playback failures (e.g. autoplay policy) — sound is a nicety, never blocking.
  }
}

// Tools gated by the account's plan (via access-status' `features` map), on top of the
// per-user "which menu items are enabled" preference. Keys here match the Supabase
// `features.key` rows exactly (see supabase/migrations/20260717080000_new_qa_tools_feature_flags.sql).
const PLAN_GATED_TOOLS = {
  characterCounter: "characterCounter.enabled",
  macroStudio: "macroStudio.enabled",
  multiClick: "multiClick.enabled",
  inputLab: "inputLab.enabled",
  fakerFill: "fakerFill.enabled",
  keyView: "keyView.enabled",
  elementCapture: "elementCapture.enabled",
};

function hasPlanFeature(toolKey) {
  const featureKey = PLAN_GATED_TOOLS[toolKey];
  if (!featureKey) return true;
  return state.features?.[featureKey] === true;
}

function requirePlanFeature(toolKey) {
  if (hasPlanFeature(toolKey)) return true;
  showQaToast("Este recurso não está disponível no seu plano atual.", "error");
  return false;
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
    errorMonitor: "errorMonitorMenuItem",
    inspectors: "inspectorsMenuItem", jsonStudio: "jsonStudioMenuItem", breakpoints: "breakpointMenuItem",
    testAccounts: "testAccountsMenuItem", paymentMethods: "paymentMethodsMenuItem", resources: "resourcesMenuItem",
    characterCounter: "characterCounterMenuItem", macroStudio: "macroStudioMenuItem", multiClick: "multiClickMenuItem",
    inputLab: "inputLabMenuItem", fakerFill: "fakerFillMenuItem", keyView: "keyViewMenuItem",
    elementCapture: "elementCaptureMenuItem",
  };
  for (const [key, id] of Object.entries(menuItems)) {
    root.getElementById(id)?.classList.toggle("isPreferenceHidden", !enabledTools.has(key) || !hasPlanFeature(key));
  }
  // Re-append each menu item in the founder's chosen order (preferences.toolsMenuOrder) —
  // appendChild on an already-attached node *moves* it, so iterating in order and re-appending
  // sequentially reorders the whole menu without rebuilding it. #pinnedMacrosMenu (a separate,
  // dynamically rendered list of pinned macros) is intentionally left alone at the top.
  const menu = root.getElementById("toolsMenu");
  const toolsMenuOrder = state.workspace?.preferences?.toolsMenuOrder || window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS;
  if (menu) for (const key of toolsMenuOrder) { const item = menuItems[key] && root.getElementById(menuItems[key]); if (item) menu.appendChild(item); }
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
  syncKeyView();
  setSpacerHeight();
  offsetSiteFixedHeaders();
  updateHttpErrorSurfaces();
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
        min-height: ${TOOLBAR_HEIGHT}px; display: flex; align-items: center; justify-content: space-between;
        gap: 10px; padding: 2px 12px; background: var(--qts-bg, #ef3340); color: var(--qts-text, #fff);
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 2px 10px rgba(0,0,0,.25); transition: transform 160ms ease;
      }
      #bar.isMinimized { transform: translateY(-110%); }
      #left { min-width: 0; flex: 1 1 auto; height: 100%; display: flex; flex-direction: row; align-items: center; gap: 8px; }
      #right { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 0 0 auto; }
      #textStack { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 1px; }
      #breadcrumb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 28vw; display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
      .qts-crumb-sep { opacity: .55; }
      .qts-crumb-link { all: unset; cursor: pointer; display: inline-flex; align-items: center; }
      .qts-crumb-link:hover { opacity: .8; text-decoration: underline; }
      .qts-client-label {
        display: inline-flex; align-items: center; gap: 4px; width: max-content; max-width: 220px;
        font-size: 9px; line-height: 14px; font-weight: 700; opacity: .74; overflow: hidden;
      }
      .qts-client-label.isHidden { display: none; }
      .qts-badge-avatar {
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: ${state.workspace?.preferences?.avatarShape === "round" ? "50%" : "5px"};
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
      #macroRecordingBar { position: relative; display: flex; align-items: center; gap: 3px; padding: 3px; border-radius: 9px; background: #8f0909; border: 1px solid #fff; animation: qts-rec-pulse 1.3s ease-in-out infinite; }
      #macroRecordingBar.isPaused { background: #7a5b00; animation: none; }
      #macroRecHistoryPanel { position: absolute; top: 30px; right: 0; width: 260px; max-height: 260px; overflow: auto; padding: 6px; display: grid; gap: 4px; border-radius: 10px; background: #0c0c0c; border: 1px solid rgba(255,255,255,.18); box-shadow: 0 16px 40px rgba(0,0,0,.45); z-index: 10; }
      .qts-macro-hist-row { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 6px; background: #171717; font-size: 11px; color: #fff; }
      .qts-macro-hist-row span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .qts-macro-hist-row button { all: unset; cursor: pointer; color: #ff7078; font-weight: 800; padding: 0 4px; }
      .qts-mini-empty { padding: 8px; color: #999; font-size: 11px; text-align: center; }
      #notificationBellWrapper { position: relative; }
      #notificationBellButton { position: relative; }
      .qts-bell-badge { position: absolute; top: -4px; right: -4px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 999px; background: #b20808; color: #fff; font-size: 9px; font-weight: 800; display: none; align-items: center; justify-content: center; line-height: 1; }
      .qts-bell-badge.isVisible { display: flex; }
      #notificationBellPanel { position: absolute; top: 30px; right: 0; width: 300px; max-height: 320px; overflow: auto; padding: 6px; display: grid; gap: 4px; border-radius: 10px; background: #0c0c0c; border: 1px solid rgba(255,255,255,.18); box-shadow: 0 16px 40px rgba(0,0,0,.45); z-index: 10; color: #fff; }
      .qts-bell-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 4px 6px; border-bottom: 1px solid #292929; margin-bottom: 2px; }
      .qts-bell-head b { font-size: 12px; }
      .qts-bell-head button { all: unset; cursor: pointer; color: #ffb0b0; font-size: 11px; font-weight: 700; }
      .qts-bell-head button:disabled { color: #555; cursor: default; }
      .qts-bell-row { all: unset; display: block; box-sizing: border-box; width: 100%; padding: 7px; border-radius: 7px; background: #171717; cursor: pointer; font-size: 11px; }
      .qts-bell-row:hover { background: #232323; }
      .qts-bell-row span { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ddd; }
      .qts-bell-row small { display: block; margin-top: 2px; color: #777; }
      #pinnedMacrosMenu:empty { display: none; }
      #pinnedMacrosMenu { display: grid; gap: 4px; padding-bottom: 5px; margin-bottom: 2px; border-bottom: 1px solid #292929; }
      #mobileActionsMenu { display: none; }
      /* On a real phone width, #right's pinned quick-action buttons (flex:0 0 auto, never
         shrink) add up to wider than the whole bar, which squeezes #left (breadcrumb) down to
         zero width — client/project/product don't just get cramped, they vanish entirely, and
         buttons past the overflow (settings, sometimes even Tools) get pushed off-screen with no
         way back. Below this width those pinned buttons hide and the same actions move into the
         Tools menu instead (#mobileActionsMenu), which stays reachable regardless of width. */
      @media (max-width: 560px) {
        #testStatusButton, #passButton, #failButton, #noteButton, #shapeButton, #clearAllButton,
        #screenshotButton, #recordToggleButton, #recordStopButton, #recordTimer { display: none !important; }
        #mobileActionsMenu { display: grid; gap: 4px; padding-bottom: 5px; margin-bottom: 2px; border-bottom: 1px solid #292929; }
      }
    </style>
    <div id="bar" role="toolbar" aria-label="Ferramentas de QA">
      <div id="left">
        <div id="textStack">
          <span id="clientLabel" class="qts-client-label isHidden"></span>
          <span id="breadcrumb"></span>
        </div>
        <span id="currentUrl"></span>
      </div>
      <div id="right">
        <button id="testStatusButton" type="button" title="${escapeHtml(t.testStatusTitle)}">${escapeHtml(t.testStatus)}</button>
        <button id="passButton" class="iconOnly" type="button" title="${escapeHtml(t.pass)}">${ICON("pass")}</button>
        <button id="failButton" class="iconOnly" type="button" title="${escapeHtml(t.fail)}">${ICON("fail")}</button>
        <button id="noteButton" class="iconOnly" type="button" title="${escapeHtml(t.note)}">T</button>
        <button id="shapeButton" class="iconOnly" type="button" title="${escapeHtml(t.shape)}">${ICON("square")}</button>
        <button id="clearAllButton" class="isHidden" type="button" title="${escapeHtml(t.clearAllTitle)}">${escapeHtml(t.clearAll)}</button>
        <button id="hideAllButton" class="iconOnly isHidden" type="button" title="${escapeHtml(t.hideAllTitle)}">${ICON("eye")}</button>
        <button id="screenshotButton" class="iconOnly" type="button" title="${escapeHtml(t.screenshot)}">${ICON("camera")}</button>
        <button id="recordToggleButton" class="iconOnly" type="button" title="${escapeHtml(t.recordStart)}">${ICON("recordStart")}</button>
        <button id="recordStopButton" class="iconOnly isHidden" type="button" title="${escapeHtml(t.recordStop)}">${ICON("recordStop")}</button>
        <span id="recordTimer" class="isHidden">00:00</span>
        <div id="macroRecordingBar" class="isHidden">
          <button id="macroRecHistoryButton" type="button" title="Ver ações gravadas">${ICON("dot")} <span id="macroStepCount">0</span></button>
          <button id="macroRecPauseButton" class="iconOnly" type="button" title="Pausar gravação">${ICON("pause")}</button>
          <button id="macroRecUndoButton" class="iconOnly" type="button" title="Desfazer última ação">${ICON("undo")}</button>
          <button id="macroRecCancelButton" class="iconOnly" type="button" title="Cancelar gravação">${ICON("fail")}</button>
          <button id="macroRecDoneButton" class="iconOnly" type="button" title="Concluir e editar">${ICON("pass")}</button>
          <div id="macroRecHistoryPanel" class="isHidden"></div>
        </div>
        <div id="notificationBellWrapper">
          <button id="notificationBellButton" class="iconOnly" type="button" title="Notificações">${ICON("bell")}<span id="notificationBellBadge" class="qts-bell-badge">0</span></button>
          <div id="notificationBellPanel" class="isHidden"></div>
        </div>
        <div id="toolsWrapper">
          <button id="toolsButton" type="button" title="${escapeHtml(t.tools)}">${escapeHtml(t.tools)} ${ICON("chevronDown")}</button>
          <div id="toolsMenu" role="menu">
            <div id="mobileActionsMenu">
              <button type="button" id="mobileTestStatusItem" role="menuitem">${escapeHtml(t.testStatus)}</button>
              <button type="button" id="mobilePassItem" role="menuitem">${ICON("pass")} ${escapeHtml(t.pass)}</button>
              <button type="button" id="mobileFailItem" role="menuitem">${ICON("fail")} ${escapeHtml(t.fail)}</button>
              <button type="button" id="mobileNoteItem" role="menuitem">${escapeHtml(t.note)}</button>
              <button type="button" id="mobileShapeItem" role="menuitem">${ICON("square")} ${escapeHtml(t.shape)}</button>
              <button type="button" id="mobileScreenshotItem" role="menuitem">${ICON("camera")} ${escapeHtml(t.screenshot)}</button>
              <button type="button" id="mobileRecordItem" role="menuitem">${ICON("recordStart")} ${escapeHtml(t.recordStart)}</button>
            </div>
            <div id="pinnedMacrosMenu"></div>
            <button type="button" id="macroStudioMenuItem" role="menuitem">${ICON("macroStudio")} ${escapeHtml(t.macroStudioMenuLabel)}</button>
            <button type="button" id="characterCounterMenuItem" role="menuitem">${ICON("characterCounter")} ${escapeHtml(t.characterCounterMenuLabel)}</button>
            <button type="button" id="multiClickMenuItem" role="menuitem">${ICON("multiClick")} ${escapeHtml(t.multiClickMenuLabel)}</button>
            <button type="button" id="inputLabMenuItem" role="menuitem">${ICON("inputLab")} ${escapeHtml(t.inputLabMenuLabel)}</button>
            <button type="button" id="fakerFillMenuItem" role="menuitem">${ICON("fakerFill")} ${escapeHtml(t.fakerFillMenuLabel)}</button>
            <button type="button" id="keyViewMenuItem" role="menuitem">${ICON("keyView")} ${escapeHtml(t.keyViewMenuLabel || "Key View")}</button>
            <button type="button" id="clickSpyMenuItem" role="menuitem">${ICON("mouse")} Click Spy</button>
            <button type="button" id="freezeClockMenuItem" role="menuitem">${ICON("freezeClock")} Freeze Clock</button>
            <button type="button" id="forceHttpMenuItem" role="menuitem">${ICON("warning")} Force HTTP</button>
            <button type="button" id="errorMonitorMenuItem" role="menuitem">${ICON("errorMonitor")} ${escapeHtml(t.errorMonitorTitle)}<span id="errorMonitorBadge" class="qts-badge" style="display:none">0</span></button>
            <button type="button" id="inspectorsMenuItem" role="menuitem">{ } ${escapeHtml(t.inspectorsTitle)}<span id="inspectorsBadge" class="qts-badge" style="display:none">0</span></button>
            <button type="button" id="jsonStudioMenuItem" role="menuitem">${ICON("braces")} ${escapeHtml(t.jsonStudioTitle)}</button>
            <button type="button" id="breakpointMenuItem" role="menuitem">${ICON("breakpointViewer")} Breakpoint Viewer</button>
            <button type="button" id="testAccountsMenuItem" role="menuitem">${ICON("key")} ${escapeHtml(t.testAccountsMenuLabel)}</button>
            <button type="button" id="paymentMethodsMenuItem" role="menuitem">${ICON("paymentMethods")} ${escapeHtml(t.paymentMethodsMenuLabel)}</button>
            <button type="button" id="resourcesMenuItem" role="menuitem">${ICON("resources")} ${escapeHtml(t.resourcesMenuLabel)}</button>
            <button type="button" id="elementCaptureMenuItem" role="menuitem">${ICON("elementCapture")} ${escapeHtml(t.elementCaptureMenuLabel || "Capturar elementos")}</button>
          </div>
        </div>
        <button id="settingsButton" class="iconOnly" type="button" title="${escapeHtml(t.settings)}">${ICON("settings")}</button>
        <button id="minimizeButton" class="iconOnly" type="button" title="${escapeHtml(t.minimize)}">${ICON("chevronUp")}</button>
      </div>
    </div>
    <button id="restoreButton" type="button" title="${escapeHtml(t.restore)}">${ICON("chevronDown")}</button>
  `;

  // A plain mousedown on any element outside the current text selection collapses it by
  // browser default (the same reason rich-text-editor toolbars preventDefault their own
  // buttons' mousedown) — without this, clicking Tools → a menu item → "Usar seleção da
  // página" always saw an empty selection, because the first click (on the Tools button
  // itself) had already destroyed it. Scoped to <button> only so real drawer inputs/textareas
  // keep normal focus/caret behavior.
  shadow.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  shadow.getElementById("settingsButton").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "qts:open-options" });
  });
  // Delegated on #left (stable across renders) rather than #clientLabel/#breadcrumb directly,
  // since render() replaces those two elements' innerHTML every time — a listener attached
  // straight to a breadcrumb segment would be destroyed along with it on the next render.
  shadow.getElementById("left").addEventListener("click", (event) => {
    const link = event.target.closest("[data-crumb-nav]");
    if (link) window.location.href = link.dataset.crumbNav;
  });
  shadow.getElementById("minimizeButton").addEventListener("click", () => setMinimized(true));
  shadow.getElementById("restoreButton").addEventListener("click", () => setMinimized(false));
  shadow.getElementById("testStatusButton").addEventListener("click", () => openTestStatusModal());
  shadow.getElementById("passButton").addEventListener("click", (event) => enablePlacementMode("pass", event.currentTarget));
  shadow.getElementById("failButton").addEventListener("click", (event) => enablePlacementMode("fail", event.currentTarget));
  shadow.getElementById("noteButton").addEventListener("click", () => addFloatingTextNote());
  shadow.getElementById("shapeButton").addEventListener("click", (event) => enablePlacementMode("shape", event.currentTarget));
  shadow.getElementById("clearAllButton").addEventListener("click", () => clearAllFloatingItems());
  shadow.getElementById("hideAllButton").addEventListener("click", () => toggleAllFloatingItemsVisibility());
  shadow.getElementById("screenshotButton").addEventListener("click", () => captureScreenshot());
  shadow.getElementById("recordToggleButton").addEventListener("click", () => handleRecordToggle());
  shadow.getElementById("recordStopButton").addEventListener("click", () => stopEvidenceRecording());
  shadow.getElementById("macroRecHistoryButton").addEventListener("click", () => toggleMacroHistoryPanel());
  shadow.getElementById("macroRecPauseButton").addEventListener("click", () => toggleMacroRecordingPause());
  shadow.getElementById("macroRecUndoButton").addEventListener("click", () => undoLastMacroStep());
  shadow.getElementById("macroRecCancelButton").addEventListener("click", () => cancelMacroRecording());
  shadow.getElementById("macroRecDoneButton").addEventListener("click", () => stopMacroRecording());

  // Same handlers as the pinned bar buttons above — this is the narrow-viewport fallback path
  // for them (see the #mobileActionsMenu media query), not a separate feature.
  shadow.getElementById("mobileTestStatusItem").addEventListener("click", () => { openTestStatusModal(); closeToolsMenu(); });
  shadow.getElementById("mobilePassItem").addEventListener("click", (event) => { enablePlacementMode("pass", shadow.getElementById("passButton")); closeToolsMenu(); });
  shadow.getElementById("mobileFailItem").addEventListener("click", () => { enablePlacementMode("fail", shadow.getElementById("failButton")); closeToolsMenu(); });
  shadow.getElementById("mobileNoteItem").addEventListener("click", () => { addFloatingTextNote(); closeToolsMenu(); });
  shadow.getElementById("mobileShapeItem").addEventListener("click", () => { enablePlacementMode("shape", shadow.getElementById("shapeButton")); closeToolsMenu(); });
  shadow.getElementById("mobileScreenshotItem").addEventListener("click", () => { captureScreenshot(); closeToolsMenu(); });
  shadow.getElementById("mobileRecordItem").addEventListener("click", () => { handleRecordToggle(); closeToolsMenu(); });

  shadow.getElementById("toolsButton").addEventListener("click", (event) => {
    event.stopPropagation();
    shadow.getElementById("toolsMenu").classList.toggle("isOpen");
  });
  shadow.getElementById("notificationBellButton").addEventListener("click", (event) => { event.stopPropagation(); toggleNotificationBellPanel(); });
  shadow.addEventListener("click", () => {
    shadow.getElementById("toolsMenu").classList.remove("isOpen");
    shadow.getElementById("notificationBellPanel")?.classList.add("isHidden");
  });
  shadow.getElementById("toolsMenu").addEventListener("click", (event) => event.stopPropagation());
  shadow.getElementById("notificationBellPanel").addEventListener("click", (event) => event.stopPropagation());

  shadow.getElementById("clickSpyMenuItem").addEventListener("click", () => { toggleClickSpy(); closeToolsMenu(); });
  shadow.getElementById("freezeClockMenuItem").addEventListener("click", () => { toggleFreezeClock(); closeToolsMenu(); });
  shadow.getElementById("forceHttpMenuItem").addEventListener("click", () => { openForceHttpDialog(); closeToolsMenu(); });
  shadow.getElementById("errorMonitorMenuItem").addEventListener("click", () => { openErrorMonitorDrawer(); closeToolsMenu(); });
  shadow.getElementById("inspectorsMenuItem").addEventListener("click", () => { openInspectorsDrawer(); closeToolsMenu(); });
  shadow.getElementById("jsonStudioMenuItem").addEventListener("click", () => { openJsonStudio(); closeToolsMenu(); });
  shadow.getElementById("breakpointMenuItem").addEventListener("click", () => { openBreakpointViewer(); closeToolsMenu(); });
  shadow.getElementById("testAccountsMenuItem").addEventListener("click", () => { openTestAccountsDrawer(); closeToolsMenu(); });
  shadow.getElementById("paymentMethodsMenuItem").addEventListener("click", () => { openPaymentMethodsDrawer(); closeToolsMenu(); });
  shadow.getElementById("resourcesMenuItem").addEventListener("click", () => { openResourcesDrawer(); closeToolsMenu(); });
  shadow.getElementById("elementCaptureMenuItem").addEventListener("click", () => { openElementCapture(); closeToolsMenu(); });
  shadow.getElementById("characterCounterMenuItem").addEventListener("click", () => { openCharacterCounter(); closeToolsMenu(); });
  shadow.getElementById("macroStudioMenuItem").addEventListener("click", () => { openMacroStudio(); closeToolsMenu(); });
  shadow.getElementById("multiClickMenuItem").addEventListener("click", () => { openMultiClick(); closeToolsMenu(); });
  shadow.getElementById("inputLabMenuItem").addEventListener("click", () => { openInputLab(); closeToolsMenu(); });
  shadow.getElementById("fakerFillMenuItem").addEventListener("click", () => { openFakerFill(); closeToolsMenu(); });
  shadow.getElementById("keyViewMenuItem").addEventListener("click", () => { openKeyView(); closeToolsMenu(); });

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
  void maybeShowFirstRunIntro();
}

// One-time callout the very first time the bar ever mounts on any authorized site — after
// that, chrome.storage.local remembers it was seen and it never shows again. Lives inside the
// shadow root (not document.body) since it only ever needs to point at our own bar, not overlay
// arbitrary page content.
async function maybeShowFirstRunIntro() {
  if (!state.shadowRoot) return;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.uiState);
  if (stored[STORAGE_KEYS.uiState]?.hasSeenToolbarIntro) return;
  if (state.shadowRoot.getElementById("firstRunIntro")) return;
  const t = state.t;
  const host = document.createElement("div");
  host.id = "firstRunIntro";
  host.innerHTML = `
    <style>
      #firstRunIntroCard {
        position: fixed; bottom: 20px; left: 50%; z-index: 2147483647; transform: translateX(-50%);
        width: min(320px, calc(100vw - 24px)); padding: 14px; border-radius: 12px;
        background: #0b0b0b; border: 1px solid #333; box-shadow: 0 16px 34px rgba(0,0,0,.45);
        color: #fff; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        animation: qts-intro-in 180ms ease;
      }
      /* Bottom-center, matching showQaToast's proven-safe spot — anywhere near the bar itself
         risks sitting on top of the tools dropdown (it did, and blocked clicking menu items).
         The "to" state must match the base transform exactly, or it snaps sideways once the
         (non-forwards) animation ends and the base rule's transform takes back over. */
      @keyframes qts-intro-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translateX(-50%); } }
      #firstRunIntroCard .qts-intro-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      #firstRunIntroCard b { color: #ffd700; font-size: 13px; }
      #firstRunIntroCard p { margin: 0 0 10px; color: #ccc; }
      #firstRunIntroCard button.qts-intro-close { flex: none; width: 22px; height: 22px; border: 0; border-radius: 999px; background: #b20808; color: #fff; cursor: pointer; }
      #firstRunIntroCard button.qts-intro-cta { width: 100%; height: 32px; border: 0; border-radius: 8px; background: #ffd700; color: #111; font-weight: 800; cursor: pointer; }
    </style>
    <div id="firstRunIntroCard">
      <div class="qts-intro-head"><b>${escapeHtml(t.firstRunTitle)}</b><button type="button" class="qts-intro-close" title="${escapeHtml(t.close)}">×</button></div>
      <p>${escapeHtml(t.firstRunBody)}</p>
      <button type="button" class="qts-intro-cta">${escapeHtml(t.firstRunCta)}</button>
    </div>
  `;
  state.shadowRoot.appendChild(host);
  const dismiss = async () => {
    host.remove();
    const current = await chrome.storage.local.get(STORAGE_KEYS.uiState);
    await chrome.storage.local.set({ [STORAGE_KEYS.uiState]: { ...(current[STORAGE_KEYS.uiState] || {}), hasSeenToolbarIntro: true } });
  };
  host.querySelector(".qts-intro-close").addEventListener("click", dismiss);
  host.querySelector(".qts-intro-cta").addEventListener("click", dismiss);
}

function removeToolbar({ disableBridge = false } = {}) {
  cancelElementSelection();
  stopKeyView();
  state.macroRecording?.cleanup?.();
  state.macroRecording = null;
  state.integrityObserver?.disconnect();
  state.integrityObserver = null;
  if (state.integrityInterval) window.clearInterval(state.integrityInterval);
  state.integrityInterval = null;
  stopHeaderOffsetMonitor();
  document.getElementById(HOST_ID)?.remove();
  document.getElementById(SPACER_ID)?.remove();
  document.querySelectorAll(".qts-modal-backdrop,.qts-result-overlay,.qts-floating-item,.qts-shape-preview").forEach((element) => element.remove());
  closeClickSpyTooltip();
  clearSiteFixedHeaderOffsets();
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
  installHeaderOffsetMonitor();
}

/**
 * Matches tampermonkey.js's keepSiteFixedElementsBelowWindowsill: a site's own fixed/sticky
 * header can appear or move well after our last render() (a cookie-banner dismissal, a delayed
 * SPA route render, a scroll-triggered header) — re-running offsetSiteFixedHeaders() only from
 * render() misses those. MutationObserver + scroll + resize covers the common triggers; the
 * interval is a deliberate belt-and-suspenders fallback for whatever those three don't catch.
 */
function installHeaderOffsetMonitor() {
  if (state.headerOffsetObserver) return;
  // Coalesces bursty triggers (a scroll fires many times a second, a MutationObserver batches
  // but can still arrive frequently during a busy SPA render) into at most one walk per frame.
  let scheduled = false;
  const rerun = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      offsetSiteFixedHeaders();
    });
  };
  const observer = new MutationObserver(rerun);
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  window.addEventListener("scroll", rerun, { passive: true });
  window.addEventListener("resize", rerun);
  state.headerOffsetObserver = observer;
  state.headerOffsetScrollHandler = rerun;
  state.headerOffsetInterval = window.setInterval(rerun, 1_000);
}

function stopHeaderOffsetMonitor() {
  state.headerOffsetObserver?.disconnect();
  state.headerOffsetObserver = null;
  if (state.headerOffsetScrollHandler) {
    window.removeEventListener("scroll", state.headerOffsetScrollHandler);
    window.removeEventListener("resize", state.headerOffsetScrollHandler);
  }
  state.headerOffsetScrollHandler = null;
  if (state.headerOffsetInterval) window.clearInterval(state.headerOffsetInterval);
  state.headerOffsetInterval = null;
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
      playSound(key);
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
  return Boolean(target.closest?.(`#${HOST_ID}, .qts-floating-item, .qts-modal-backdrop, .qts-clickspy-tooltip`));
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

// Founder feedback (requested earlier, never shipped): edit/remove/resize used to sit exposed on
// every marker/note/shape at all times, cluttering the page and getting in the way of screenshots.
// Now only this small eye toggle is always visible; it reveals the rest of the controls — plus a
// "hide element" button that blanks the annotation's own content (not the controls) so a clean
// screenshot can be taken without deleting the annotation — on demand.
function visibilityControlsHtml() {
  const t = state.t;
  return `<button type="button" class="qts-visibility-btn" data-visibility-toggle title="${escapeHtml(t.showControls)}">${ICON("eye")}</button>
    <button type="button" class="qts-hide-content-btn" data-hide-content-toggle title="${escapeHtml(t.hideElement)}">${ICON("eyeSlash")}</button>`;
}

function wireVisibilityControls(item) {
  const t = state.t;
  const visibilityBtn = item.querySelector("[data-visibility-toggle]");
  const hideBtn = item.querySelector("[data-hide-content-toggle]");
  visibilityBtn.addEventListener("click", () => {
    const visible = item.classList.toggle("isControlsVisible");
    visibilityBtn.innerHTML = ICON(visible ? "eyeSlash" : "eye");
    visibilityBtn.title = visible ? t.hideControls : t.showControls;
  });
  hideBtn.addEventListener("click", () => {
    const hidden = item.classList.toggle("isContentHidden");
    hideBtn.innerHTML = ICON(hidden ? "eye" : "eyeSlash");
    hideBtn.title = hidden ? t.showElement : t.hideElement;
    // Keeps the "hide/show all" master button's own icon (eye vs eyeSlash) truthful even when
    // items are toggled one at a time instead of all at once.
    updateClearAllVisibility();
  });
}

function placeMarker(kind, clientX, clientY) {
  const size = 52;
  const marker = document.createElement("div");
  marker.className = "qts-floating-item qts-marker";
  marker.style.left = `${Math.max(4, clientX - size / 2)}px`;
  marker.style.top = `${Math.max(getCurrentHeight() + 4, clientY - size / 2)}px`;
  marker.style.width = `${size}px`;
  marker.style.height = `${size}px`;
  marker.innerHTML = `
    <div class="qts-marker-body ${kind === "fail" ? "isFail" : "isPass"}" data-drag-handle>${kind === "fail" ? ICON("fail") : ICON("pass")}</div>
    ${visibilityControlsHtml()}
    <button type="button" class="qts-remove-btn" title="${escapeHtml(state.t.remove)}">×</button>
    <div class="qts-resize-handle" data-resize-handle title="${escapeHtml(state.t.resize)}">${ICON("resize")}</div>
  `;
  document.body.appendChild(marker);
  wireVisibilityControls(marker);
  makeDraggable(marker, marker.querySelector("[data-drag-handle]"));
  makeResizable(marker, marker.querySelector("[data-resize-handle]"), { minWidth: 28, minHeight: 28, lockAspectRatio: true });
  marker.querySelector(".qts-remove-btn").addEventListener("click", () => { marker.remove(); updateClearAllVisibility(); });
  updateClearAllVisibility();
}

const DEFAULT_NOTE_STYLE = { color: "#ffffff", fontSize: 14, background: "translucent" };

function noteBackgroundValue(background) {
  if (background === "solid") return "#000000";
  if (background === "none") return "transparent";
  return "rgba(0,0,0,.6)";
}

function renderSavedNote(note, text, style) {
  const t = state.t;
  note.className = "qts-floating-item qts-note isSaved";
  note.innerHTML = `
    <div class="qts-note-content" data-drag-handle>${escapeHtml(text)}</div>
    ${visibilityControlsHtml()}
    <button type="button" class="qts-edit-btn" title="${escapeHtml(t.edit)}">${ICON("edit")}</button>
    <button type="button" class="qts-remove-btn" title="${escapeHtml(t.remove)}">×</button>
    <div class="qts-resize-handle hasEditButton" data-resize-handle title="${escapeHtml(t.resize)}">${ICON("resize")}</div>
  `;
  const content = note.querySelector(".qts-note-content");
  content.style.setProperty("--qts-note-color", style.color);
  content.style.setProperty("--qts-note-font-size", `${style.fontSize}px`);
  content.style.setProperty("--qts-note-bg", noteBackgroundValue(style.background));
  wireVisibilityControls(note);
  makeDraggable(note, note.querySelector("[data-drag-handle]"));
  makeResizable(note, note.querySelector("[data-resize-handle]"), { minWidth: 100, minHeight: 40 });
  note.querySelector(".qts-remove-btn").addEventListener("click", () => { note.remove(); updateClearAllVisibility(); });
  note.querySelector(".qts-edit-btn").addEventListener("click", () => renderEditingNote(note, text, style));
}

function renderEditingNote(note, currentText, currentStyle) {
  const t = state.t;
  const safeColor = /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(String(currentStyle.color || "").trim())
    ? String(currentStyle.color).trim()
    : DEFAULT_NOTE_STYLE.color;
  const parsedFontSize = Number(currentStyle.fontSize);
  const safeFontSize = Number.isFinite(parsedFontSize)
    ? Math.min(28, Math.max(11, parsedFontSize))
    : DEFAULT_NOTE_STYLE.fontSize;
  const safeBackground = ["translucent", "solid", "none"].includes(currentStyle.background)
    ? currentStyle.background
    : DEFAULT_NOTE_STYLE.background;
  note.className = "qts-floating-item qts-note isEditing";
  note.style.height = "";
  note.innerHTML = `
    <div class="qts-editor-head" data-drag-handle><span>${escapeHtml(t.noteHeader)}</span><button type="button" class="qts-remove-btn" title="${escapeHtml(t.remove)}">×</button></div>
    <div class="qts-editor-body">
      <textarea placeholder="${escapeHtml(t.notePlaceholder)}">${escapeHtml(currentText)}</textarea>
      <div class="qts-note-style-row">
        <label>${escapeHtml(t.noteColor)}<input type="color" data-note-color value="${safeColor}" /></label>
        <label>${escapeHtml(t.noteFontSize)}<input type="range" min="11" max="28" value="${safeFontSize}" data-note-size /></label>
        <label>${escapeHtml(t.noteBackground)}<select data-note-bg>
          <option value="translucent" ${safeBackground === "translucent" ? "selected" : ""}>${escapeHtml(t.noteBackgroundTranslucent)}</option>
          <option value="solid" ${safeBackground === "solid" ? "selected" : ""}>${escapeHtml(t.noteBackgroundSolid)}</option>
          <option value="none" ${safeBackground === "none" ? "selected" : ""}>${escapeHtml(t.noteBackgroundNone)}</option>
        </select></label>
      </div>
      <div class="qts-editor-actions"><button type="button" data-save>${escapeHtml(t.save)}</button></div>
    </div>
  `;
  makeDraggable(note, note.querySelector("[data-drag-handle]"));
  note.querySelector(".qts-remove-btn").addEventListener("click", () => { note.remove(); updateClearAllVisibility(); });
  note.querySelector("[data-save]").addEventListener("click", () => {
    const text = note.querySelector("textarea").value.trim() || t.noteDefault;
    const style = {
      color: note.querySelector("[data-note-color]").value,
      fontSize: Number(note.querySelector("[data-note-size]").value),
      background: note.querySelector("[data-note-bg]").value,
    };
    renderSavedNote(note, text, style);
  });
}

function addFloatingTextNote() {
  const note = document.createElement("div");
  note.className = "qts-floating-item qts-note isEditing";
  note.style.left = `${Math.max(12, window.innerWidth - 320)}px`;
  note.style.top = `${getCurrentHeight() + 24}px`;
  document.body.appendChild(note);
  renderEditingNote(note, "", { ...DEFAULT_NOTE_STYLE });
  updateClearAllVisibility();
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
    ${visibilityControlsHtml()}
    <button type="button" class="qts-edit-btn" title="${escapeHtml(state.t.edit)}">${ICON("edit")}</button>
    <button type="button" class="qts-remove-btn" title="${escapeHtml(state.t.remove)}">×</button>
    <div class="qts-resize-handle hasEditButton" data-resize-handle title="${escapeHtml(state.t.resize)}">${ICON("resize")}</div>
  `;
  document.body.appendChild(shape);
  wireVisibilityControls(shape);
  makeDraggable(shape, shape.querySelector("[data-drag-handle]"));
  makeResizable(shape, shape.querySelector("[data-resize-handle]"), { minWidth: 30, minHeight: 30 });
  shape.querySelector(".qts-remove-btn").addEventListener("click", () => { shape.remove(); updateClearAllVisibility(); });
  shape.querySelector(".qts-edit-btn").addEventListener("click", () => toggleShapeStyleEditor(shape));
  updateClearAllVisibility();
}

function toggleShapeStyleEditor(shape) {
  const existing = shape.querySelector(".qts-shape-editor");
  if (existing) { existing.remove(); return; }
  const t = state.t;
  const box = shape.querySelector(".qts-shape-box");
  const editor = document.createElement("div");
  editor.className = "qts-shape-editor";
  editor.innerHTML = `
    <label>${escapeHtml(t.shapeEditorBorderColor)}<input type="color" data-shape-border value="#ef3340" /></label>
    <label>${escapeHtml(t.shapeEditorFillColor)}<input type="color" data-shape-fill value="#ef3340" /></label>
    <label>${escapeHtml(t.shapeEditorOpacity)}<input type="range" min="20" max="100" value="100" data-shape-opacity /></label>
    <label>${escapeHtml(t.shapeEditorRadius)}<input type="range" min="0" max="48" value="8" data-shape-radius /></label>
  `;
  shape.appendChild(editor);
  const apply = () => {
    const borderColor = editor.querySelector("[data-shape-border]").value;
    const fillColor = editor.querySelector("[data-shape-fill]").value;
    const opacity = Number(editor.querySelector("[data-shape-opacity]").value) / 100;
    const radius = Number(editor.querySelector("[data-shape-radius]").value);
    box.style.setProperty("--qts-shape-border", `3px solid ${borderColor}`);
    box.style.setProperty("--qts-shape-bg", hexToRgba(fillColor, 0.15));
    box.style.setProperty("--qts-shape-opacity", String(opacity));
    box.style.setProperty("--qts-shape-radius", `${radius}px`);
  };
  editor.querySelectorAll("input").forEach((input) => input.addEventListener("input", apply));
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16) || 0;
  const g = parseInt(normalized.slice(2, 4), 16) || 0;
  const b = parseInt(normalized.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

function makeDraggable(element, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  handle.addEventListener("mousedown", (event) => {
    // Excludes anything interactive that can legitimately sit on top of/inside the drag handle
    // (the shape style editor's inputs, in particular) — a mousedown that starts on a real
    // control should never also start a drag.
    if (event.button !== 0 || event.target.closest("button,input,textarea,select,label,[data-resize-handle]")) return;
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

// Shared SE-corner drag-resize for markers/shapes/notes — one consistent resize gesture across
// every annotation type instead of a different interaction per tool.
function makeResizable(element, handle, { minWidth = 24, minHeight = 24, lockAspectRatio = false, onResize } = {}) {
  let resizing = false;
  let startWidth = 0;
  let startHeight = 0;
  let startX = 0;
  let startY = 0;
  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    resizing = true;
    const rect = element.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    startX = event.clientX;
    startY = event.clientY;
    event.preventDefault();
    event.stopPropagation();
  });
  document.addEventListener("mousemove", (event) => {
    if (!resizing) return;
    let width = Math.max(minWidth, startWidth + (event.clientX - startX));
    let height = Math.max(minHeight, startHeight + (event.clientY - startY));
    // Markers are circular (border-radius:999px on a possibly non-square box just renders a
    // stadium/oval) — locking width===height here is what keeps the shape an actual circle
    // instead of distorting as soon as a single SE-corner drag lets the two axes diverge.
    if (lockAspectRatio) {
      const size = Math.max(width, height);
      width = size;
      height = size;
    }
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    onResize?.(width, height);
  });
  document.addEventListener("mouseup", () => { resizing = false; });
}

function clearAllFloatingItems() {
  document.querySelectorAll(".qts-floating-item").forEach((item) => item.remove());
  updateClearAllVisibility();
}

// Founder feedback: the per-item eye toggle (which reveals edit/remove/resize/hide-content on one
// marker/note/shape at a time) was welcome, but there was no quick way to blank every annotation's
// content at once before a screenshot — this mirrors "Limpar" (remove all) with a non-destructive
// "hide/show all" sibling, toggling every item's own isContentHidden class in one click.
function toggleAllFloatingItemsVisibility() {
  const items = [...document.querySelectorAll(".qts-floating-item")];
  if (!items.length) return;
  const shouldHide = items.some((item) => !item.classList.contains("isContentHidden"));
  for (const item of items) {
    item.classList.toggle("isContentHidden", shouldHide);
    const hideButton = item.querySelector("[data-hide-content-toggle]");
    if (hideButton) {
      hideButton.innerHTML = ICON(shouldHide ? "eye" : "eyeSlash");
      hideButton.title = shouldHide ? state.t.showElement : state.t.hideElement;
    }
  }
  updateClearAllVisibility();
}

function updateClearAllVisibility() {
  const items = document.querySelectorAll(".qts-floating-item");
  const hasItems = items.length > 0;
  const notesPinned = (state.workspace?.preferences?.pinnedTools || []).includes("notes");
  state.shadowRoot?.getElementById("clearAllButton")?.classList.toggle("isHidden", !hasItems || !notesPinned);
  const hideAllButton = state.shadowRoot?.getElementById("hideAllButton");
  if (hideAllButton) {
    hideAllButton.classList.toggle("isHidden", !hasItems || !notesPinned);
    const allHidden = hasItems && [...items].every((item) => item.classList.contains("isContentHidden"));
    hideAllButton.innerHTML = ICON(allHidden ? "eyeSlash" : "eye");
    hideAllButton.title = allHidden ? state.t.showAllTitle : state.t.hideAllTitle;
  }
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
      width: min(400px, 92vw); height: 100%; background: #0b0b0b; color: #fff; border-left: 2px solid #b20808;
      display: flex; flex-direction: column; box-shadow: -18px 0 40px rgba(0,0,0,.4);
    }
    /* Macro Studio's founder feedback: a right-edge sidebar felt cramped/ugly for something with
       a palette + flow builder + code view — this variant centers the same #drawerBody markup in
       a proper modal instead, reusing every existing style/handler inside it unchanged. */
    .qts-drawer-backdrop.isModal { justify-content: center; align-items: center; padding: 16px; }
    .qts-drawer-backdrop.isModal .qts-drawer {
      width: min(920px, 94vw); height: min(760px, 90vh); border-left: 0; border-radius: 16px;
      border: 1px solid #292929; box-shadow: 0 30px 80px rgba(0,0,0,.55);
    }
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
    .qts-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: #1c1c1c; border: 1px solid #292929; font-size: 10px; color: #ccc; }
    .qts-chip b { color: #ffd700; font-weight: 800; }

    /* Toolbar shared by every data-listing drawer: search + smart filters + collapse-to-minimal. */
    .qts-toolbar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .qts-toolbar-row input[type="search"] { flex: 1 1 160px; min-width: 0; }
    .qts-icon-btn { width: 32px; height: 32px; padding: 0; border: 1px solid #333; border-radius: 8px; background: #1c1c1c; color: #fff; cursor: pointer; flex: 0 0 auto; }
    .qts-icon-btn:hover { border-color: #ffd700; }
    .qts-filter-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .qts-filter-bar.isCollapsed { display: none; }
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
    .qts-friendly-field .qts-field-value { word-break: break-word; display: flex; align-items: center; gap: 6px; }
    .qts-locate-btn { flex: none; width: 22px; height: 22px; padding: 0; border: 1px solid #333; border-radius: 6px; background: #171717; color: #aaa; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .qts-locate-btn:hover { border-color: #ffd700; color: #ffd700; }
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
    .qts-key-view-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .qts-key-view-status div { display: grid; gap: 2px; }
    .qts-key-view-status small, .qts-switch-row small { display: block; color: #999; font-weight: 500; }
    .qts-switch-row { display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: start; padding: 11px; margin-bottom: 8px; border: 1px solid #292929; border-radius: 10px; background: #121212; cursor: pointer; }
    .qts-switch-row input { width: 17px !important; height: 17px; margin: 2px 0 0; accent-color: #ef3340; }
    .qts-field-label { display: grid; gap: 7px; margin: 12px 0; color: #ddd; font-weight: 750; }
    .qts-position-grid { width: 132px; display: grid; grid-template-columns: repeat(3, 40px); gap: 6px; }
    .qts-position-grid button { width: 40px; height: 36px; border: 1px solid #393939; border-radius: 8px; background: #171717; color: #aaa; cursor: pointer; font-size: 16px; }
    .qts-position-grid button.isSelected { border-color: #ffd700; background: #b20808; color: #fff; box-shadow: 0 0 0 2px rgba(255,215,0,.18); }
    .qts-key-view-size-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
    .qts-key-view-preview { min-height: 82px; display: flex; align-items: center; justify-content: center; gap: 6px; margin: 12px 0; border: 1px dashed #3b3b3b; border-radius: 12px; background: #080808; color: #aaa; }
    .qts-key-view-preview .qts-keycap { flex: 0 0 auto; overflow: visible; }
    .qts-key-view-preview .qts-keycap-shadow { fill: #000; }
    .qts-key-view-preview .qts-keycap-face { fill: #1d2028; stroke: #4c5260; stroke-width: 2; }
    .qts-key-view-preview .qts-keycap-shine { fill: none; stroke: rgba(255,255,255,.26); stroke-width: 2; stroke-linecap: round; }
    .qts-key-view-preview .qts-keycap text { fill: #fff; font: 800 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .qts-key-view-preview[data-theme="light"] { background: #dedede; color: #444; }
    .qts-key-view-preview[data-theme="light"] .qts-keycap-shadow { fill: #858585; }
    .qts-key-view-preview[data-theme="light"] .qts-keycap-face { fill: #fff; stroke: #d1d1d1; }
    .qts-key-view-preview[data-theme="light"] .qts-keycap-shine { stroke: rgba(255,255,255,.9); }
    .qts-key-view-preview[data-theme="light"] .qts-keycap text { fill: #111; }
    .qts-privacy-note p { margin: 5px 0 0; color: #aaa; }
    @media (max-width: 680px) { .qts-macro-layout, .qts-key-view-size-grid { grid-template-columns: 1fr; } .qts-palette { grid-template-columns: repeat(2,minmax(0,1fr)); } .qts-step { grid-template-columns: 28px 95px minmax(0,1fr) 32px; } }
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

Object.assign(QA_SURFACE_TRANSLATIONS.es, {
  "Mostre atalhos e ações do mouse durante demonstrações, testes e gravações.": "Muestra atajos y acciones del ratón durante demostraciones, pruebas y grabaciones.",
  "Ativo nesta página": "Activo en esta página", "Desativado": "Desactivado", "Desativar": "Desactivar", "Ativar": "Activar",
  "Modo Typing": "Modo escritura", "Mantém o texto digitado na tela até você clicar em Limpar.": "Mantiene el texto escrito en pantalla hasta que hagas clic en Limpiar.",
  "Visualizar mouse": "Visualizar ratón", "Destaca clique esquerdo, direito, meio e direção do scroll ao lado do ponteiro.": "Resalta los clics izquierdo, derecho y central, y la dirección del desplazamiento junto al puntero.",
  "Aparência das teclas": "Apariencia de las teclas", "Tecla preta · texto branco": "Tecla negra · texto blanco", "Tecla branca · texto preto": "Tecla blanca · texto negro",
  "Tamanho das teclas": "Tamaño de las teclas", "Tamanho do mouse": "Tamaño del ratón", "Pequeno": "Pequeño", "Médio": "Mediano", "Grande": "Grande",
  "Posição na tela": "Posición en pantalla", "Privacidade local": "Privacidad local", "O texto não é salvo nem enviado. Campos de senha, cartão, CVV, token e segredo nunca são capturados.": "El texto no se guarda ni se envía. Nunca se capturan campos de contraseña, tarjeta, CVV, token o secreto.",
  "Salvar configurações": "Guardar configuración", "Limpar texto": "Limpiar texto", "Configurações salvas.": "Configuración guardada.", "Texto limpo.": "Texto borrado.",
});
Object.assign(QA_SURFACE_TRANSLATIONS.en, {
  "Mostre atalhos e ações do mouse durante demonstrações, testes e gravações.": "Show shortcuts and mouse actions during demos, tests, and recordings.",
  "Ativo nesta página": "Active on this page", "Desativado": "Disabled", "Desativar": "Disable", "Ativar": "Enable",
  "Modo Typing": "Typing mode", "Mantém o texto digitado na tela até você clicar em Limpar.": "Keeps typed text on screen until you click Clear.",
  "Visualizar mouse": "Show mouse", "Destaca clique esquerdo, direito, meio e direção do scroll ao lado do ponteiro.": "Highlights left, right, and middle clicks, plus scroll direction beside the pointer.",
  "Aparência das teclas": "Key appearance", "Tecla preta · texto branco": "Black key · white text", "Tecla branca · texto preto": "White key · black text",
  "Tamanho das teclas": "Key size", "Tamanho do mouse": "Mouse size", "Pequeno": "Small", "Médio": "Medium", "Grande": "Large",
  "Posição na tela": "Screen position", "Privacidade local": "Local privacy", "O texto não é salvo nem enviado. Campos de senha, cartão, CVV, token e segredo nunca são capturados.": "Text is neither saved nor sent. Password, card, CVV, token, and secret fields are never captured.",
  "Salvar configurações": "Save settings", "Limpar texto": "Clear text", "Configurações salvas.": "Settings saved.", "Texto limpo.": "Text cleared.",
});

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
  if (state.t.locale === "en") translated = translated.replace(/^(\d+) requisição\(ões\) capturada\(s\) não corresponderam a nenhum padrão configurado nos Inspectors — confira as rotas\/endpoints cadastrados\.$/, "$1 captured request(s) matched none of the configured Inspectors patterns — check the routes/endpoints you registered.");
  if (state.t.locale === "es") translated = translated.replace(/^(\d+) requisição\(ões\) capturada\(s\) não corresponderam a nenhum padrão configurado nos Inspectors — confira as rotas\/endpoints cadastrados\.$/, "$1 solicitud(es) capturada(s) no coincidieron con ningún patrón configurado en Inspectors — revisa las rutas/endpoints registrados.");
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

function openDrawer({ title, bodyHtml, onReady, view = "", variant = "" }) {
  cleanupBreakpointViewer();
  const drawerHost = ensureDrawerHost();
  // Every open must reset (or set) this flag — handleNetworkCaptured() checks it to decide
  // whether to live-refresh the Inspectors list. Leaving a stale "inspectors" value here after
  // switching to a different panel made Inspectors content silently overwrite other drawers.
  drawerHost.dataset.view = view;
  drawerHost.innerHTML = `<style>${drawerStyles()}</style>
    <div class="qts-drawer-backdrop${variant === "modal" ? " isModal" : ""}" id="drawerBackdrop">
      <div class="qts-drawer">
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
    const locatable = value !== null && value !== undefined && String(value).trim().length > 0;
    return `<div class="qts-friendly-field" data-friendly-key="${escapeHtml(keyLabel)}" data-friendly-value="${escapeHtml(String(value))}">
      <div class="qts-field-label">${escapeHtml(humanizeKey(keyLabel))}</div>
      <div class="qts-field-value">${formatPrimitive(value)}${locatable ? `<button type="button" class="qts-locate-btn" data-locate-value="${escapeHtml(String(value))}" title="${escapeHtml(state.t.inspectorsLocateOnPage)}">${ICON("cursor")}</button>` : ""}</div>
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

// "Page locator": click a value in the inspector and jump to the matching element on the real
// page. Generic on purpose (plain text-content matching, not tied to any product's DOM
// structure) — this only ever looks at leaf elements so a whole-page container never wins
// just because some deeply nested descendant happens to contain the same text.
function locateValueOnPage(rawValue) {
  const needle = String(rawValue ?? "").trim();
  if (!needle) return;
  const match = [...document.body.querySelectorAll("*")].find((element) => (
    element.children.length === 0 && !isInsideToolbarUi(element) && element.textContent?.trim() === needle
  ));
  if (!match) { showQaToast(state.t.inspectorsLocateNotFound, "error"); return; }
  match.scrollIntoView({ behavior: "smooth", block: "center" });
  match.classList.add("qts-locate-highlight");
  window.setTimeout(() => match.classList.remove("qts-locate-highlight"), 2200);
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
      <button type="button" class="qts-icon-btn" data-json-minimize title="${escapeHtml(t.minimizeTitle)}">${ICON("collapse")}</button>
    </div>
    <div data-json-content></div>
  `;
  const content = container.querySelector("[data-json-content]");
  const searchInput = container.querySelector("[data-json-search]");
  content.addEventListener("click", (event) => {
    const button = event.target.closest("[data-locate-value]");
    if (button) locateValueOnPage(button.dataset.locateValue);
  });
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

const CLICK_SPY_SELECTOR = "a,button,[role=button],input,select,textarea,[onclick],[data-testid]";

function toggleClickSpy() {
  if (state.clickSpyActive) { deactivateClickSpy(); return; }
  state.clickSpyActive = true;
  state.shadowRoot.getElementById("clickSpyMenuItem").classList.add("isActive");
  let hovered = null;
  const overHandler = (event) => {
    const target = event.target.closest(CLICK_SPY_SELECTOR);
    if (target === hovered || isInsideToolbarUi(event.target)) return;
    hovered?.classList.remove("qts-spy-hover");
    hovered = target;
    hovered?.classList.add("qts-spy-hover");
  };
  const clickHandler = (event) => {
    if (isInsideToolbarUi(event.target)) return;
    const target = event.target.closest(CLICK_SPY_SELECTOR) || event.target;
    event.preventDefault();
    // stopImmediatePropagation (not just stopPropagation) so no other capture-phase listener on
    // the same target — a site's own analytics/handlers — fires from this pick click.
    event.stopImmediatePropagation();
    showClickSpyTooltip(target, event.clientX, event.clientY);
    deactivateClickSpy();
  };
  const escHandler = (event) => {
    if (event.key !== "Escape") return;
    deactivateClickSpy();
    showQaToast(state.t.clickSpyCancelled);
  };
  document.addEventListener("pointerover", overHandler, true);
  document.addEventListener("click", clickHandler, true);
  document.addEventListener("keydown", escHandler, true);
  clickSpyCleanup = () => {
    hovered?.classList.remove("qts-spy-hover");
    document.removeEventListener("pointerover", overHandler, true);
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

function describeClickSpyTarget(target) {
  const t = state.t;
  const anchor = target.closest?.("a[href]");
  return [
    [t.clickSpyElement, target.tagName.toLowerCase()],
    [t.clickSpyText, target.textContent?.trim().slice(0, 80) || "—"],
    [t.clickSpyDestination, anchor ? new URL(anchor.getAttribute("href"), window.location.href).href : "—"],
    [t.clickSpyType, anchor ? t.clickSpyNavigation : target.tagName === "BUTTON" || target.getAttribute("type") === "submit" ? t.clickSpyActionSubmit : t.clickSpyFormControl],
  ];
}

let clickSpyTooltipEl = null;

function closeClickSpyTooltip() {
  clickSpyTooltipEl?.remove();
  clickSpyTooltipEl = null;
}

// A small tooltip anchored near the picked element (not the full openDrawer side panel) — lets
// the tester keep seeing the element they picked while reading the result, matching how a
// real inspector would surface this instead of yanking focus to a side drawer.
function showClickSpyTooltip(target, clientX, clientY) {
  closeClickSpyTooltip();
  const t = state.t;
  const description = describeClickSpyTarget(target);
  const tooltip = document.createElement("div");
  tooltip.className = "qts-clickspy-tooltip";
  tooltip.innerHTML = `
    <div class="qts-clickspy-head"><span>${escapeHtml(t.clickSpyResultTitle)}</span><button type="button" class="qts-remove-btn" data-clickspy-close title="${escapeHtml(t.remove)}">×</button></div>
    <div class="qts-clickspy-body">${description.map(([label, value]) => `
      <div><div class="qts-clickspy-label">${escapeHtml(label)}</div><div class="qts-clickspy-value">${escapeHtml(value)}</div></div>
    `).join("")}</div>
    <div class="qts-clickspy-actions">
      <button type="button" class="action" data-clickspy-copy>${ICON("copy")} ${escapeHtml(t.clickSpyCopy)}</button>
      <button type="button" class="action primary" data-clickspy-execute>${ICON("play")} ${escapeHtml(t.clickSpyExecute)}</button>
    </div>
    <div class="qts-clickspy-trace" data-clickspy-trace hidden></div>
  `;
  const width = 320;
  tooltip.style.left = `${Math.min(Math.max(8, clientX - width / 2), window.innerWidth - width - 8)}px`;
  tooltip.style.top = `${Math.min(Math.max(getCurrentHeight() + 8, clientY + 12), window.innerHeight - 60)}px`;
  document.body.appendChild(tooltip);
  clickSpyTooltipEl = tooltip;

  tooltip.querySelector("[data-clickspy-close]").addEventListener("click", closeClickSpyTooltip);
  tooltip.querySelector("[data-clickspy-copy]").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(description.map(([label, value]) => `${label}: ${value}`).join("\n")).catch(() => {});
    const button = event.currentTarget;
    const original = button.innerHTML;
    button.innerHTML = `${ICON("pass")} ${escapeHtml(t.clickSpyCopied)}`;
    window.setTimeout(() => { if (button.isConnected) button.innerHTML = original; }, 1500);
  });
  tooltip.querySelector("[data-clickspy-execute]").addEventListener("click", (event) => executeAndObserveClickSpy(target, tooltip, event.currentTarget));

  let dismissTimer = window.setTimeout(closeClickSpyTooltip, 30_000);
  tooltip.addEventListener("mouseenter", () => window.clearTimeout(dismissTimer));
  tooltip.addEventListener("mouseleave", () => { dismissTimer = window.setTimeout(closeClickSpyTooltip, 30_000); });
}

// toolbar.js runs in the content script's ISOLATED world, which has its own separate copy of
// window — patching window.fetch/history.pushState/etc. from here would only ever touch that
// isolated copy, invisible to the page's real code (this is exactly why pagebridge.js exists as
// a MAIN-world script for Freeze Clock/Force HTTP). Rather than duplicating that split for this
// one feature, this reuses what's already observable from here: qts:network-captured (fetch/XHR,
// dispatched by pagebridge.js) and qts:location-change (pushState/replaceState/popstate/
// hashchange, also pagebridge.js) are both real DOM CustomEvents, and `submit` is a real DOM
// event too — none of those need MAIN-world access to observe. Only window.open is a bare
// function call with no such event, so that alone is bridged via a dedicated pagebridge command.
function installTemporaryActionTrace(onEvent) {
  const networkHandler = (event) => onEvent(state.t.clickSpyEventNetwork, `${event.detail?.method || "GET"} ${event.detail?.url || ""}`);
  const locationHandler = (event) => onEvent(state.t.clickSpyEventNavigation, event.detail?.href || window.location.href);
  const submitHandler = (event) => onEvent(state.t.clickSpyEventFormSubmit, event.target?.getAttribute?.("action") || window.location.href);
  const openHandler = (event) => onEvent(state.t.clickSpyEventNewWindow, event.detail?.url || "");
  document.addEventListener("qts:network-captured", networkHandler);
  document.addEventListener("qts:location-change", locationHandler);
  document.addEventListener("submit", submitHandler, true);
  document.addEventListener("qts:action-trace-event", openHandler);
  document.dispatchEvent(new CustomEvent("qts:action-trace-command", { detail: { active: true } }));

  return function restore() {
    document.dispatchEvent(new CustomEvent("qts:action-trace-command", { detail: { active: false } }));
    document.removeEventListener("qts:network-captured", networkHandler);
    document.removeEventListener("qts:location-change", locationHandler);
    document.removeEventListener("submit", submitHandler, true);
    document.removeEventListener("qts:action-trace-event", openHandler);
  };
}

function executeAndObserveClickSpy(target, tooltip, button) {
  const t = state.t;
  const traceLog = tooltip.querySelector("[data-clickspy-trace]");
  traceLog.hidden = false;
  traceLog.innerHTML = `<div class="qts-clickspy-event">${escapeHtml(t.clickSpyObserving)}</div>`;
  button.disabled = true;
  const seen = [];
  const renderTrace = () => { traceLog.innerHTML = seen.map(([label, detail]) => `<div class="qts-clickspy-event"><b>${escapeHtml(label)}</b><span>${escapeHtml(detail)}</span></div>`).join(""); };
  const restore = installTemporaryActionTrace((label, detail) => { seen.push([label, detail]); renderTrace(); });

  if (typeof target.click === "function") target.click();
  else target.dispatchEvent?.(new MouseEvent("click", { bubbles: true, cancelable: true }));

  window.setTimeout(() => {
    restore();
    if (!tooltip.isConnected) return;
    if (!seen.length) traceLog.innerHTML = `<div class="qts-clickspy-event qts-empty">${escapeHtml(t.clickSpyNoEffectsObserved)}</div>`;
    button.disabled = false;
    button.innerHTML = `${ICON("play")} ${escapeHtml(t.clickSpyExecuteAgain)}`;
  }, 3_500);
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

function inspectorMatchesUrl(inspector, url) {
  return (inspector.patterns || []).some((pattern) => {
    const candidate = String(pattern || "").trim();
    if (!candidate) return false;
    try { return candidate.includes("*") ? wildcardToRegExp(candidate).test(String(url || "")) : String(url || "").toLowerCase().includes(candidate.toLowerCase()); } catch { return false; }
  });
}

function configuredInspectors() {
  return (state.workspace.inspectors || []).filter((inspector) => inspector.active !== false && Array.isArray(inspector.patterns) && inspector.patterns.length);
}

// Everything captured is always kept now (previously a non-matching entry was dropped before it
// ever reached state.networkHistory, which made "see everything" impossible even for founders who
// just wanted a quick look — the "Todos"/"Meus Inspectors" toggle in renderInspectorsList() is a
// soft filter over matchedInspectorIds instead of a hard capture-time drop).
function handleNetworkCaptured(entry) {
  entry.matchedInspectorIds = configuredInspectors().filter((inspector) => inspectorMatchesUrl(inspector, entry?.url)).map((inspector) => inspector.id);
  state.networkHistory.unshift(entry);
  if (state.networkHistory.length > 150) state.networkHistory.length = 150;
  if (Number(entry?.status) >= 400) playSound("httpError");
  const badge = state.shadowRoot?.getElementById("inspectorsBadge");
  if (badge) {
    badge.textContent = String(state.networkHistory.length);
    badge.style.display = state.networkHistory.length ? "inline-flex" : "none";
  }
  if (state.shadowRoot?.getElementById("drawerHost")?.dataset.view === "inspectors") renderInspectorsList();
}

// "auto" means "not yet manually chosen" — resolved once per drawer session by
// inspectorsEffectiveScope() (mine if the founder already has configured inspectors, since that
// preserves the pre-existing filtered experience; all otherwise, since there'd be nothing to see).
const inspectorsFilterState = { query: "", method: new Set(), status: new Set(), source: new Set(), inspector: new Set(), collapsed: false, scope: "auto" };

function inspectorsEffectiveScope() {
  if (inspectorsFilterState.scope !== "auto") return inspectorsFilterState.scope;
  return configuredInspectors().length ? "mine" : "all";
}

async function markEntryAsInspector(entry) {
  let pattern = entry.url;
  try { pattern = new URL(entry.url).pathname || entry.url; } catch { /* relative/unparseable URL: fall back to the raw string */ }
  if (!state.workspace.inspectors) state.workspace.inspectors = [];
  const inspectors = state.workspace.inspectors;
  if (inspectors.some((inspector) => (inspector.patterns || []).includes(pattern))) {
    showQaToast("Esse endpoint já está entre seus Inspectors.");
    return;
  }
  const inspector = { id: crypto.randomUUID(), label: pattern.length > 40 ? `${pattern.slice(0, 40)}…` : pattern, patterns: [pattern], active: true };
  inspectors.push(inspector);
  await persistWorkspaceState();
  // Re-tag already-captured entries immediately — otherwise "Meus Inspectors" would stay empty
  // for this exact endpoint until the next real network call re-runs handleNetworkCaptured.
  for (const item of state.networkHistory) {
    if (inspectorMatchesUrl(inspector, item.url) && !(item.matchedInspectorIds || []).includes(inspector.id)) {
      item.matchedInspectorIds = [...(item.matchedInspectorIds || []), inspector.id];
    }
  }
  renderInspectorsList();
  showQaToast(`Adicionado aos Inspectors: ${inspector.label}`);
}

function statusBucket(status) {
  if (!status) return "—";
  return `${String(status)[0]}xx`;
}

function buildInspectorFilterFields() {
  const methods = [...new Set(state.networkHistory.map((entry) => entry.method))].sort();
  const statuses = [...new Set(state.networkHistory.map((entry) => statusBucket(entry.status)))].sort();
  const sources = [...new Set(state.networkHistory.map((entry) => entry.source))].sort();
  const fields = [
    { key: "method", label: state.t.filterMethod, options: methods.map((value) => ({ value, label: value })) },
    { key: "status", label: state.t.filterStatus, options: statuses.map((value) => ({ value, label: value })) },
    { key: "source", label: state.t.filterSource, options: sources.map((value) => ({ value, label: value })) },
  ];
  const configured = configuredInspectors();
  // Each configured inspector is also its own filter chip — lets the founder narrow down to
  // "just what Inspector X caught" regardless of whether they're viewing Todos or Meus Inspectors.
  if (configured.length) fields.push({ key: "inspector", label: "Inspector", options: configured.map((inspector) => ({ value: inspector.id, label: inspector.label || inspector.id })) });
  return fields;
}

// Only ever called for the "Todos" scope now — "Meus Inspectors" is a per-inspector dashboard
// (renderInspectorDashboard) rather than a filtered slice of this same capture list.
function matchesInspectorFilters(entry) {
  const query = inspectorsFilterState.query.trim().toLowerCase();
  if (query) {
    const haystack = `${entry.url} ${entry.method} ${entry.status} ${JSON.stringify(entry.payload)}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (inspectorsFilterState.inspector.size && !(entry.matchedInspectorIds || []).some((id) => inspectorsFilterState.inspector.has(id))) return false;
  if (inspectorsFilterState.method.size && !inspectorsFilterState.method.has(entry.method)) return false;
  if (inspectorsFilterState.status.size && !inspectorsFilterState.status.has(statusBucket(entry.status))) return false;
  if (inspectorsFilterState.source.size && !inspectorsFilterState.source.has(entry.source)) return false;
  return true;
}

// "Meus Inspectors" is a per-inspector status dashboard (one row per *configured* inspector, most
// recent matching capture or a waiting state), not a filtered capture list — this is what the
// founder compared against the tampermonkey.js reference's own API Inspector drawers: list the
// endpoints you care about, show a plain "still waiting" state with a retry when nothing matched
// yet, and open straight to the response once something did. Retrying doesn't (and can't safely)
// force a new request — it just re-checks whatever's already in state.networkHistory, the same
// non-reloading semantics the reference's own retry had.
function renderInspectorDashboard(listBody) {
  const configured = configuredInspectors();
  if (!configured.length) {
    listBody.innerHTML = `<div class="qts-empty">${escapeHtml(translateQaSurfaceText("Nenhum Inspector configurado ainda. Marque uma resposta capturada em \"Todos\" ou cadastre um em Configurações."))}</div>`;
    return;
  }
  listBody.innerHTML = configured.map((inspector) => {
    const entry = state.networkHistory.find((item) => (item.matchedInspectorIds || []).includes(inspector.id));
    return `
      <div class="qts-net-item" data-inspector-id="${escapeHtml(inspector.id)}" style="cursor:${entry ? "pointer" : "default"}">
        <b>${escapeHtml(inspector.label || inspector.id)}</b>
        <small>${escapeHtml((inspector.patterns || []).join(", "))}</small>
        ${entry
          ? `<small style="display:block;margin-top:3px;color:#42d5c2">✓ ${escapeHtml(entry.method)} ${entry.status || "—"} · ${new Date(entry.capturedAt).toLocaleTimeString()}</small>`
          : `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
              <small style="color:#ffb020">Aguardando resposta...</small>
              <button type="button" class="qts-icon-btn" data-retry-inspector="${escapeHtml(inspector.id)}" title="Tentar novamente">${ICON("undo")}</button>
            </div>`}
      </div>
    `;
  }).join("");
  listBody.querySelectorAll("[data-inspector-id]").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("[data-retry-inspector]")) return;
    const entry = state.networkHistory.find((item) => (item.matchedInspectorIds || []).includes(row.dataset.inspectorId));
    if (!entry) return;
    openDrawer({ title: `${entry.method} ${entry.status}`, bodyHtml: "", onReady: (drawerBody) => renderJsonDetail(drawerBody, entry.payload) });
  }));
  listBody.querySelectorAll("[data-retry-inspector]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    renderInspectorsList();
  }));
}

function renderInspectorsList() {
  const t = state.t;
  const body = state.shadowRoot.getElementById("drawerBody");
  if (!body) return;
  const scope = inspectorsEffectiveScope();
  const fields = scope === "mine" ? [] : buildInspectorFilterFields();
  const filtered = scope === "mine" ? [] : state.networkHistory.filter(matchesInspectorFilters);

  body.innerHTML = `
    <div class="qts-tabs">
      <button type="button" class="${scope === "all" ? "isSelected" : ""}" data-inspector-scope="all">Todos</button>
      <button type="button" class="${scope === "mine" ? "isSelected" : ""}" data-inspector-scope="mine">Meus Inspectors</button>
    </div>
    ${scope === "mine" ? "" : `
    <div class="qts-toolbar-row">
      <input type="search" placeholder="${escapeHtml(t.inspectorsSearchPlaceholder)}" id="inspectorsSearch" value="${escapeHtml(inspectorsFilterState.query)}" class="qts-toolbar-search" />
      <button type="button" class="qts-icon-btn ${inspectorsFilterState.collapsed ? "isActive" : ""}" id="inspectorsCollapseToggle" title="${escapeHtml(t.toggleFilters)}">${ICON("collapse")}</button>
    </div>
    <div class="qts-filter-bar ${inspectorsFilterState.collapsed ? "isCollapsed" : ""}" id="inspectorsFilterBar">
      ${fields.map((field) => renderSmartFilter(field, inspectorsFilterState[field.key], null)).join("")}
    </div>
    `}
    <div id="inspectorsListBody"></div>
  `;

  const listBody = body.querySelector("#inspectorsListBody");
  if (scope === "mine") {
    renderInspectorDashboard(listBody);
    body.querySelectorAll("[data-inspector-scope]").forEach((button) => button.addEventListener("click", () => {
      inspectorsFilterState.scope = button.dataset.inspectorScope;
      renderInspectorsList();
    }));
    return;
  }
  const emptyMessage = !state.networkHistory.length ? t.noResponsesYet : t.noFilterResults;
  listBody.innerHTML = filtered.length
    ? filtered.map((entry) => `
        <div class="qts-net-item" data-id="${escapeHtml(entry.id)}" style="display:flex;align-items:center;gap:8px;justify-content:space-between">
          <div style="min-width:0;flex:1">
            <b>${entry.status || "—"}</b> ${escapeHtml(entry.method)} <small>${escapeHtml(entry.url)}</small>
            ${entry.matchedInspectorIds?.length ? `<small style="color:#42d5c2">★ ${entry.matchedInspectorIds.length} inspector(es)</small>` : ""}
          </div>
          <button type="button" class="qts-icon-btn" data-mark-inspector="${escapeHtml(entry.id)}" title="Marcar como meu inspector" style="width:26px;height:26px;flex:0 0 auto">${ICON("pin")}</button>
        </div>
      `).join("")
    : `<div class="qts-empty">${escapeHtml(emptyMessage)}</div>`;

  listBody.querySelectorAll("[data-id]").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("[data-mark-inspector]")) return;
    const entry = state.networkHistory.find((item) => item.id === row.dataset.id);
    openDrawer({ title: `${entry.method} ${entry.status}`, bodyHtml: "", onReady: (drawerBody) => renderJsonDetail(drawerBody, entry.payload) });
  }));
  listBody.querySelectorAll("[data-mark-inspector]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const entry = state.networkHistory.find((item) => item.id === button.dataset.markInspector);
    if (entry) void markEntryAsInspector(entry);
  }));

  body.querySelectorAll("[data-inspector-scope]").forEach((button) => button.addEventListener("click", () => {
    inspectorsFilterState.scope = button.dataset.inspectorScope;
    renderInspectorsList();
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
  openDrawer({ title: state.t.inspectorsTitle, bodyHtml: "", view: "inspectors" });
  renderInspectorsList();
}

// ---------------------------------------------------------------------------
// Error Monitor: a passive, always-on watch for HTTP errors (>=400), separate from both
// Inspectors (JSON-only, in-memory, resets on navigation) and Force HTTP (deliberate
// simulation, not a real error). Persisted to sessionStorage so it survives SPA navigation
// within the same tab, unlike the in-memory-only Inspectors history.
// ---------------------------------------------------------------------------

const HTTP_ERRORS_SESSION_KEY = "qtsHttpErrorsV1";

function loadHttpErrorsFromSession() {
  try {
    const raw = window.sessionStorage.getItem(HTTP_ERRORS_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 150) : [];
  } catch {
    return [];
  }
}

function persistHttpErrors() {
  try { window.sessionStorage.setItem(HTTP_ERRORS_SESSION_KEY, JSON.stringify(state.httpErrors)); } catch {}
}

// Single place that keeps every HTTP-error surface in sync — the Tools-menu badge, the
// standalone notification bell (badge + its own dropdown list), and the Error Monitor drawer if
// it happens to be open — so none of them can drift out of sync with `state.httpErrors`.
function updateHttpErrorSurfaces() {
  const root = state.shadowRoot;
  if (!root) return;
  const count = state.httpErrors.length;
  const menuBadge = root.getElementById("errorMonitorBadge");
  if (menuBadge) { menuBadge.textContent = String(count); menuBadge.style.display = count ? "inline-flex" : "none"; }
  const bellBadge = root.getElementById("notificationBellBadge");
  if (bellBadge) { bellBadge.textContent = count > 99 ? "99+" : String(count); bellBadge.classList.toggle("isVisible", count > 0); }
  if (!root.getElementById("notificationBellPanel")?.classList.contains("isHidden")) renderNotificationBellPanel();
  if (root.getElementById("drawerHost")?.dataset.view === "errorMonitor") renderErrorMonitorList();
}

function clearHttpErrors() {
  state.httpErrors = [];
  persistHttpErrors();
  updateHttpErrorSurfaces();
}

function handleHttpErrorCaptured(entry) {
  state.httpErrors.unshift(entry);
  if (state.httpErrors.length > 150) state.httpErrors.length = 150;
  persistHttpErrors();
  updateHttpErrorSurfaces();
}

function renderNotificationBellPanel() {
  const panel = state.shadowRoot?.getElementById("notificationBellPanel");
  if (!panel) return;
  const entries = state.httpErrors.slice(0, 20);
  panel.innerHTML = `
    <div class="qts-bell-head"><b>Notificações</b><button type="button" id="notificationBellClear" ${state.httpErrors.length ? "" : "disabled"}>Limpar</button></div>
    ${entries.length ? entries.map((entry) => `
      <button type="button" class="qts-bell-row" data-open-notification>
        <b style="color:${entry.status >= 500 ? "#ff6767" : "#ffb020"}">${entry.status || "—"}</b> ${escapeHtml(entry.method)}
        <span>${escapeHtml(entry.url)}</span>
        <small>${escapeHtml(entry.source)} · ${new Date(entry.capturedAt).toLocaleTimeString()}</small>
      </button>
    `).join("") : `<div class="qts-mini-empty">Nenhuma notificação.</div>`}
  `;
  panel.querySelector("#notificationBellClear")?.addEventListener("click", () => clearHttpErrors());
  panel.querySelectorAll("[data-open-notification]").forEach((row) => row.addEventListener("click", () => {
    toggleNotificationBellPanel(false);
    openErrorMonitorDrawer();
  }));
}

function toggleNotificationBellPanel(force) {
  const panel = state.shadowRoot?.getElementById("notificationBellPanel");
  if (!panel) return;
  const willShow = force !== undefined ? force : panel.classList.contains("isHidden");
  panel.classList.toggle("isHidden", !willShow);
  if (willShow) renderNotificationBellPanel();
}

const errorMonitorFilterState = { query: "", status: new Set(), source: new Set(), collapsed: false };

function buildErrorMonitorFilterFields() {
  const statuses = [...new Set(state.httpErrors.map((entry) => statusBucket(entry.status)))].sort();
  const sources = [...new Set(state.httpErrors.map((entry) => entry.source))].sort();
  return [
    { key: "status", label: state.t.filterStatus, options: statuses.map((value) => ({ value, label: value })) },
    { key: "source", label: state.t.filterSource, options: sources.map((value) => ({ value, label: value })) },
  ];
}

function matchesErrorMonitorFilters(entry) {
  const query = errorMonitorFilterState.query.trim().toLowerCase();
  if (query && !`${entry.url} ${entry.method} ${entry.status}`.toLowerCase().includes(query)) return false;
  if (errorMonitorFilterState.status.size && !errorMonitorFilterState.status.has(statusBucket(entry.status))) return false;
  if (errorMonitorFilterState.source.size && !errorMonitorFilterState.source.has(entry.source)) return false;
  return true;
}

// Same message-extraction fallback chain the tampermonkey.js reference used — a plain status
// code told a QA tester almost nothing; the actual message (when the API returns one) is what
// makes a captured error useful at a glance, before ever opening the raw JSON.
function errorMonitorMessageFor(entry) {
  const payload = entry.payload;
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload.message || payload.error?.message || payload.error || payload.title;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, 300) : null;
}

function renderErrorMonitorList() {
  const t = state.t;
  const body = state.shadowRoot.getElementById("drawerBody");
  if (!body) return;
  const fields = buildErrorMonitorFilterFields();
  const filtered = state.httpErrors.filter(matchesErrorMonitorFilters);

  body.innerHTML = `
    <div class="qts-toolbar-row">
      <input type="search" placeholder="${escapeHtml(t.inspectorsSearchPlaceholder)}" id="errorMonitorSearch" value="${escapeHtml(errorMonitorFilterState.query)}" class="qts-toolbar-search" />
      <button type="button" class="qts-icon-btn ${errorMonitorFilterState.collapsed ? "isActive" : ""}" id="errorMonitorCollapseToggle" title="${escapeHtml(t.toggleFilters)}">${ICON("collapse")}</button>
      <button type="button" class="qts-icon-btn" id="errorMonitorClear" title="${escapeHtml(t.clearAll)}">${ICON("fail")}</button>
    </div>
    <div class="qts-filter-bar ${errorMonitorFilterState.collapsed ? "isCollapsed" : ""}" id="errorMonitorFilterBar">
      ${fields.map((field) => renderSmartFilter(field, errorMonitorFilterState[field.key], null)).join("")}
    </div>
    <div>${filtered.length ? filtered.map((entry) => {
      const message = errorMonitorMessageFor(entry);
      return `
      <div class="qts-net-item" data-id="${escapeHtml(entry.id)}" style="${entry.payload ? "" : "cursor:default"}">
        <b style="color:${entry.status >= 500 ? "#ff6767" : "#ffb020"}">${entry.status || "—"}</b> ${escapeHtml(entry.method)} <small>${escapeHtml(entry.url)}</small>
        ${message ? `<small style="display:block;margin-top:3px;color:#ddd">${escapeHtml(message)}</small>` : ""}
        <small style="display:block;margin-top:2px;color:#666">${escapeHtml(entry.source)} · ${new Date(entry.capturedAt).toLocaleTimeString()}</small>
      </div>
    `;
    }).join("") : `<div class="qts-empty">${state.httpErrors.length ? t.noFilterResults : t.errorMonitorEmpty}</div>`}</div>
  `;
  body.querySelectorAll("[data-id]").forEach((row) => row.addEventListener("click", () => {
    const entry = state.httpErrors.find((item) => item.id === row.dataset.id);
    if (!entry?.payload) return;
    openDrawer({ title: `${entry.method} ${entry.status}`, bodyHtml: "", onReady: (drawerBody) => renderJsonDetail(drawerBody, entry.payload) });
  }));
  body.querySelector("#errorMonitorSearch").addEventListener("input", (event) => { errorMonitorFilterState.query = event.target.value; renderErrorMonitorList(); });
  body.querySelector("#errorMonitorCollapseToggle").addEventListener("click", () => { errorMonitorFilterState.collapsed = !errorMonitorFilterState.collapsed; renderErrorMonitorList(); });
  body.querySelector("#errorMonitorClear").addEventListener("click", () => clearHttpErrors());
  wireSmartFilter(body.querySelector("#errorMonitorFilterBar"), (key, value, isSelected) => {
    if (isSelected) errorMonitorFilterState[key].add(value); else errorMonitorFilterState[key].delete(value);
    renderErrorMonitorList();
  });
}

function openErrorMonitorDrawer() {
  openDrawer({ title: state.t.errorMonitorTitle, bodyHtml: "", view: "errorMonitor" });
  renderErrorMonitorList();
}

// ---------------------------------------------------------------------------
// Test accounts: read-only view of the accounts registered (from Settings)
// for the environment matching the current URL. Sandbox-only by design —
// passwords are masked by default and never leave this drawer; managing
// (creating/removing) accounts happens on the options page, not here.
// ---------------------------------------------------------------------------

const revealedTestAccountIds = new Set();
const testAccountsFilterState = { query: "", accountType: new Set(), collapsed: false };

function buildTestAccountFilterFields(accounts) {
  const typeImages = new Map();
  accounts.forEach((account) => { if (account.accountType && account.accountTypeImage) typeImages.set(account.accountType, account.accountTypeImage); });
  const types = [...new Set(accounts.map((account) => account.accountType).filter(Boolean))].sort();
  return [
    { key: "accountType", label: state.t.filterAccountType, options: types.map((value) => ({ value, label: value, image: typeImages.get(value) })) },
  ];
}

function matchesTestAccountFilters(account) {
  const query = testAccountsFilterState.query.trim().toLowerCase();
  if (query) {
    const customText = (account.customFields || []).map((field) => `${field.key} ${field.value}`).join(" ");
    const haystack = `${account.label} ${account.username} ${account.notes} ${account.accountType} ${customText}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (testAccountsFilterState.accountType.size && !testAccountsFilterState.accountType.has(account.accountType)) return false;
  return true;
}

function renderCustomFieldChips(customFields) {
  if (!customFields?.length) return "";
  return `<div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">${customFields.map((field) => {
    const value = field.type === "boolean" ? (field.value ? ICON("pass") : ICON("fail")) : escapeHtml(String(field.value ?? "—"));
    return `<span class="qts-chip"><b>${escapeHtml(field.key)}</b> ${value}</span>`;
  }).join("")}</div>`;
}

// Founder feedback: payment methods already had a one-click "Copiar tudo" per row (every visible
// field, formatted as text) — test accounts only ever copied the username. This brings accounts up
// to the same parity.
function formatTestAccountForCopy(account) {
  const lines = [
    [state.t.testAccountsDrawerTitle, account.label],
    ["Tipo", account.accountType],
    ["Usuário", account.username],
    ["Senha", account.password],
    ["Notas", account.notes],
  ];
  for (const field of account.customFields || []) lines.push([field.key, field.type === "boolean" ? (field.value ? "Sim" : "Não") : field.value]);
  return lines.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => `${label}: ${value}`).join("\n");
}

function renderTestAccountsList() {
  const t = state.t;
  const body = state.shadowRoot.getElementById("drawerBody");
  if (!body) return;

  if (!state.environment) {
    body.innerHTML = `<div class="qts-empty">${escapeHtml(t.testAccountsNoEnvironment)}</div>`;
    return;
  }

  const allAccounts = (state.workspace.testAccounts || []).filter((account) => (account.environmentIds || []).includes(state.environment.id) && (!account.productIds?.length || account.productIds.includes(state.environment.productId)));
  if (!allAccounts.length) {
    body.innerHTML = `<div class="qts-empty">${escapeHtml(t.testAccountsEmptyForEnv)}</div>`;
    return;
  }
  const fields = buildTestAccountFilterFields(allAccounts);
  const accounts = allAccounts.filter(matchesTestAccountFilters);

  body.innerHTML = `
    <div class="qts-toolbar-row">
      <input type="search" placeholder="${escapeHtml(t.testAccountsSearchPlaceholder)}" id="testAccountsSearch" value="${escapeHtml(testAccountsFilterState.query)}" class="qts-toolbar-search" />
      <button type="button" class="qts-icon-btn ${testAccountsFilterState.collapsed ? "isActive" : ""}" id="testAccountsCollapseToggle" title="${escapeHtml(t.toggleFilters)}">${ICON("collapse")}</button>
    </div>
    <div class="qts-filter-bar ${testAccountsFilterState.collapsed ? "isCollapsed" : ""}" id="testAccountsFilterBar">
      ${fields.map((field) => renderSmartFilter(field, testAccountsFilterState[field.key], null)).join("")}
    </div>
    <div id="testAccountsListBody" style="display:grid;gap:10px">${accounts.length ? accounts.map((account) => {
      const revealed = revealedTestAccountIds.has(account.id);
      const passwordDisplay = account.password ? (revealed ? escapeHtml(account.password) : "•".repeat(Math.min(10, account.password.length))) : "—";
      return `
        <div class="qts-net-item" data-account-id="${escapeHtml(account.id)}" style="cursor:default">
          <div style="display:flex;align-items:center;gap:6px">
            ${account.accountTypeImage ? `<img src="${escapeHtml(account.accountTypeImage)}" alt="" style="width:18px;height:18px;border-radius:4px;object-fit:cover" />` : ""}
            <b>${escapeHtml(account.label)}</b>${account.accountType ? ` <span style="color:#ffd700">${escapeHtml(account.accountType)}</span>` : ""}
          </div>
          <div style="margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <small>${escapeHtml(account.username || "—")}</small>
            <small>${passwordDisplay}</small>
            ${account.password ? `<button type="button" class="action" data-reveal-account="${escapeHtml(account.id)}" style="height:22px;padding:0 8px;font-size:10px">${revealed ? ICON("eyeSlash") : ICON("eye")}</button>` : ""}
            ${account.username ? `<button type="button" class="action" data-copy-account="${escapeHtml(account.id)}" style="height:22px;padding:0 8px;font-size:10px" title="Copiar usuário">${ICON("copy")}</button>` : ""}
            <button type="button" class="action" data-copy-account-all="${escapeHtml(account.id)}" style="height:22px;padding:0 8px;font-size:10px">${ICON("copy")} Copiar tudo</button>
          </div>
          ${renderCustomFieldChips(account.customFields)}
          ${account.notes ? `<small style="display:block;margin-top:4px;color:#888">${escapeHtml(account.notes)}</small>` : ""}
        </div>
      `;
    }).join("") : `<div class="qts-empty">${escapeHtml(t.noFilterResults)}</div>`}</div>
  `;

  body.querySelector("#testAccountsSearch").addEventListener("input", (event) => {
    testAccountsFilterState.query = event.target.value;
    renderTestAccountsList();
  });
  body.querySelector("#testAccountsCollapseToggle").addEventListener("click", () => {
    testAccountsFilterState.collapsed = !testAccountsFilterState.collapsed;
    renderTestAccountsList();
  });
  wireSmartFilter(body.querySelector("#testAccountsFilterBar"), (key, value, isSelected) => {
    if (isSelected) testAccountsFilterState[key].add(value); else testAccountsFilterState[key].delete(value);
    renderTestAccountsList();
  });
  body.querySelectorAll("[data-reveal-account]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.revealAccount;
    if (revealedTestAccountIds.has(id)) revealedTestAccountIds.delete(id); else revealedTestAccountIds.add(id);
    renderTestAccountsList();
  }));
  body.querySelectorAll("[data-copy-account]").forEach((button) => button.addEventListener("click", async () => {
    const account = accounts.find((item) => item.id === button.dataset.copyAccount);
    if (!account?.username) return;
    await navigator.clipboard.writeText(account.username).catch(() => {});
    const original = button.innerHTML;
    button.innerHTML = ICON("pass");
    window.setTimeout(() => { button.innerHTML = original; }, 1200);
  }));
  body.querySelectorAll("[data-copy-account-all]").forEach((button) => button.addEventListener("click", () => {
    const account = accounts.find((item) => item.id === button.dataset.copyAccountAll);
    if (account) copyToClipboardWithFeedback(button, formatTestAccountForCopy(account));
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

async function copyToClipboardWithFeedback(button, text) {
  await navigator.clipboard.writeText(text).catch(() => {});
  const original = button.innerHTML;
  button.innerHTML = ICON("pass");
  window.setTimeout(() => { if (button.isConnected) button.innerHTML = original; }, 1200);
}

const paymentMethodsFilterState = { query: "", type: new Set(), collapsed: false };

function matchesPaymentMethodFilters(method) {
  const query = paymentMethodsFilterState.query.trim().toLowerCase();
  if (query && !`${method.label} ${method.holder || ""} ${method.notes || ""}`.toLowerCase().includes(query)) return false;
  if (paymentMethodsFilterState.type.size && !paymentMethodsFilterState.type.has(method.type || "other")) return false;
  return true;
}

function formatPaymentMethodForCopy(method) {
  const lines = [[state.t.paymentMethodFallback, method.label], ["Tipo", method.type], ["Número/token", method.value], ["Titular", method.holder], ["Validade", method.expiry], ["CVV", method.cvv]];
  return lines.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n");
}

function renderPaymentMethodsList() {
  const t = state.t;
  const body = state.shadowRoot.getElementById("drawerBody");
  if (!body) return;
  const allMethods = (state.workspace.paymentMethods || []).filter((method) => method.active !== false && (!method.environmentIds?.length || method.environmentIds.includes(state.environment?.id)) && (!method.productIds?.length || method.productIds.includes(state.environment?.productId)));
  if (!allMethods.length) {
    body.innerHTML = `<div class="qts-empty">${escapeHtml(state.t.paymentMethodsEmptyForEnv)}</div>`;
    return;
  }
  const types = [...new Set(allMethods.map((method) => method.type || "other"))].sort();
  const fields = [{ key: "type", label: "Tipo", options: types.map((value) => ({ value, label: value })) }];
  const methods = allMethods.filter(matchesPaymentMethodFilters);

  body.innerHTML = `
    <div class="qts-toolbar-row">
      <input type="search" placeholder="Buscar meio de pagamento..." id="paymentMethodsSearch" value="${escapeHtml(paymentMethodsFilterState.query)}" class="qts-toolbar-search" />
      <button type="button" class="qts-icon-btn ${paymentMethodsFilterState.collapsed ? "isActive" : ""}" id="paymentMethodsCollapseToggle" title="${escapeHtml(t.toggleFilters)}">${ICON("collapse")}</button>
    </div>
    <div class="qts-filter-bar ${paymentMethodsFilterState.collapsed ? "isCollapsed" : ""}" id="paymentMethodsFilterBar">
      ${fields.map((field) => renderSmartFilter(field, paymentMethodsFilterState[field.key], null)).join("")}
    </div>
    <div style="display:grid;gap:10px">${methods.length ? methods.map((method) => {
    const revealed = revealedPaymentMethodIds.has(method.id);
    const fieldRow = (fieldLabel, rawValue, dataAttr) => {
      if (!rawValue) return "";
      const displayValue = revealed ? escapeHtml(rawValue) : escapeHtml(dataAttr === "value" ? maskedPaymentValue(rawValue) : "•".repeat(Math.min(8, rawValue.length)));
      return `<div style="display:flex;align-items:center;gap:6px"><small style="color:#888;min-width:56px">${escapeHtml(fieldLabel)}</small><small>${displayValue}</small><button type="button" class="qts-icon-btn" data-copy-payment-field="${escapeHtml(method.id)}" data-field="${dataAttr}" style="width:22px;height:22px" title="Copiar">${ICON("copy")}</button></div>`;
    };
    return `<div class="qts-net-item" style="cursor:default">
      <div style="display:flex;align-items:center;gap:6px">
        ${method.icon ? `<img src="${escapeHtml(method.icon)}" alt="" style="width:18px;height:18px;border-radius:4px;object-fit:cover" />` : ""}
        <b>${escapeHtml(method.label || state.t.paymentMethodFallback)}</b> <span style="color:#ffd700">${escapeHtml(method.type || "other")}</span>
      </div>
      <div style="margin-top:6px;display:grid;gap:4px">
        ${fieldRow("Número", method.value, "value")}
        ${fieldRow("Titular", method.holder, "holder")}
        ${fieldRow("Validade", method.expiry, "expiry")}
        ${fieldRow("CVV", method.cvv, "cvv")}
      </div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        ${method.value ? `<button type="button" class="action" data-reveal-payment="${escapeHtml(method.id)}" style="height:24px;padding:0 8px;font-size:10px">${revealed ? ICON("eyeSlash") : ICON("eye")} ${revealed ? "Ocultar" : "Revelar"}</button>` : ""}
        <button type="button" class="action" data-copy-payment-all="${escapeHtml(method.id)}" style="height:24px;padding:0 8px;font-size:10px">${ICON("copy")} Copiar tudo</button>
      </div>
      ${method.notes ? `<small style="display:block;margin-top:4px;color:#888">${escapeHtml(method.notes)}</small>` : ""}
    </div>`;
  }).join("") : `<div class="qts-empty">${escapeHtml(t.noFilterResults)}</div>`}</div>
  `;
  body.querySelector("#paymentMethodsSearch").addEventListener("input", (event) => { paymentMethodsFilterState.query = event.target.value; renderPaymentMethodsList(); });
  body.querySelector("#paymentMethodsCollapseToggle").addEventListener("click", () => { paymentMethodsFilterState.collapsed = !paymentMethodsFilterState.collapsed; renderPaymentMethodsList(); });
  wireSmartFilter(body.querySelector("#paymentMethodsFilterBar"), (key, value, isSelected) => {
    if (isSelected) paymentMethodsFilterState[key].add(value); else paymentMethodsFilterState[key].delete(value);
    renderPaymentMethodsList();
  });
  body.querySelectorAll("[data-reveal-payment]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.revealPayment;
    if (revealedPaymentMethodIds.has(id)) revealedPaymentMethodIds.delete(id); else revealedPaymentMethodIds.add(id);
    renderPaymentMethodsList();
  }));
  body.querySelectorAll("[data-copy-payment-field]").forEach((button) => button.addEventListener("click", () => {
    const method = methods.find((item) => item.id === button.dataset.copyPaymentField);
    const value = method?.[button.dataset.field];
    if (value) copyToClipboardWithFeedback(button, value);
  }));
  body.querySelectorAll("[data-copy-payment-all]").forEach((button) => button.addEventListener("click", () => {
    const method = methods.find((item) => item.id === button.dataset.copyPaymentAll);
    if (method) copyToClipboardWithFeedback(button, formatPaymentMethodForCopy(method));
  }));
}

function openPaymentMethodsDrawer() {
  openDrawer({ title: state.t.paymentMethodsDrawerTitle, bodyHtml: "", view: "paymentMethods" });
  renderPaymentMethodsList();
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

const resourcesFilterState = { query: "", category: new Set(), collapsed: false };

function matchesResourceFilters(resource) {
  const query = resourcesFilterState.query.trim().toLowerCase();
  if (query && !`${resource.label} ${resource.safeUrl} ${resource.category || ""}`.toLowerCase().includes(query)) return false;
  if (resourcesFilterState.category.size && !resourcesFilterState.category.has(resource.category || "")) return false;
  return true;
}

function renderResourcesList() {
  const t = state.t;
  const body = state.shadowRoot.getElementById("drawerBody");
  if (!body) return;
  const allResources = (state.workspace.resources || []).filter((resource) => resource.active !== false).map((resource) => ({ ...resource, safeUrl: safeExternalUrl(resource.url) })).filter((resource) => resource.safeUrl);
  if (!allResources.length) {
    body.innerHTML = `<div class="qts-empty">${escapeHtml(t.resourcesEmpty)}</div>`;
    return;
  }
  const categories = [...new Set(allResources.map((resource) => resource.category).filter(Boolean))].sort();
  const fields = categories.length ? [{ key: "category", label: t.filterCategory, options: categories.map((value) => ({ value, label: value })) }] : [];
  const resources = allResources.filter(matchesResourceFilters);

  body.innerHTML = `
    <div class="qts-toolbar-row">
      <input type="search" placeholder="${escapeHtml(t.resourcesSearchPlaceholder)}" id="resourcesSearch" value="${escapeHtml(resourcesFilterState.query)}" class="qts-toolbar-search" />
      <button type="button" class="qts-icon-btn ${resourcesFilterState.collapsed ? "isActive" : ""}" id="resourcesCollapseToggle" title="${escapeHtml(t.toggleFilters)}">${ICON("collapse")}</button>
    </div>
    <div class="qts-filter-bar ${resourcesFilterState.collapsed ? "isCollapsed" : ""}" id="resourcesFilterBar">
      ${fields.map((field) => renderSmartFilter(field, resourcesFilterState[field.key], null)).join("")}
    </div>
    <div style="display:grid;gap:10px">${resources.length ? resources.map((resource) => `
      <a class="qts-net-item" href="${escapeHtml(resource.safeUrl)}" target="_blank" rel="noopener noreferrer" style="display:block;color:#fff;text-decoration:none">
        ${resource.icon ? `<img src="${escapeHtml(resource.icon)}" alt="" style="width:16px;height:16px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:4px" />` : ""}<b>${escapeHtml(resource.label || resource.safeUrl)}</b>${resource.category ? ` <span style="color:#ffd700">${escapeHtml(resource.category)}</span>` : ""}
        <small style="display:block;margin-top:4px;color:#888">${escapeHtml(resource.safeUrl)}</small>
      </a>
    `).join("") : `<div class="qts-empty">${escapeHtml(t.noFilterResults)}</div>`}</div>
  `;
  body.querySelector("#resourcesSearch").addEventListener("input", (event) => { resourcesFilterState.query = event.target.value; renderResourcesList(); });
  body.querySelector("#resourcesCollapseToggle").addEventListener("click", () => { resourcesFilterState.collapsed = !resourcesFilterState.collapsed; renderResourcesList(); });
  wireSmartFilter(body.querySelector("#resourcesFilterBar"), (key, value, isSelected) => {
    if (isSelected) resourcesFilterState[key].add(value); else resourcesFilterState[key].delete(value);
    renderResourcesList();
  });
}

function openResourcesDrawer() {
  openDrawer({ title: state.t.resourcesDrawerTitle, bodyHtml: "" });
  renderResourcesList();
}

// ---------------------------------------------------------------------------
// JSON Studio: format/compact/copy any pasted JSON.
// ---------------------------------------------------------------------------

// Recursive structural diff between two parsed JSON values — the original spec (see
// docs/handoff/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md's jsonDiff.enabled capability) called for real
// comparison, not just reformatting; this is the founder-facing shipment of that, kept dependency-
// free (no bundled JSON-diff/schema library) to match this content script's zero-runtime-deps
// convention. Object/array structural mismatches (e.g. a field that was an object and became an
// array) fall through to the final branch and report as a single "changed" at that path.
function diffJsonValues(a, b, path = "") {
  const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (isPlainObject(a) && isPlainObject(b)) {
    const diffs = [];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const nextPath = path ? `${path}.${key}` : key;
      if (!(key in a)) diffs.push({ path: nextPath, type: "added", after: b[key] });
      else if (!(key in b)) diffs.push({ path: nextPath, type: "removed", before: a[key] });
      else diffs.push(...diffJsonValues(a[key], b[key], nextPath));
    }
    return diffs;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const diffs = [];
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const nextPath = `${path}[${index}]`;
      if (index >= a.length) diffs.push({ path: nextPath, type: "added", after: b[index] });
      else if (index >= b.length) diffs.push({ path: nextPath, type: "removed", before: a[index] });
      else diffs.push(...diffJsonValues(a[index], b[index], nextPath));
    }
    return diffs;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ path: path || "(raiz)", type: "changed", before: a, after: b }];
}

function renderJsonDiff(diffs) {
  if (!diffs.length) return `<div class="qts-empty">Nenhuma diferença — os dois JSONs são equivalentes.</div>`;
  const label = { added: "+ adicionado", removed: "− removido", changed: "~ alterado" };
  const color = { added: "#42d5c2", removed: "#ff6767", changed: "#ffb020" };
  const rows = diffs.slice(0, 300).map((diff) => `
    <div class="qts-net-item" style="cursor:default">
      <b style="color:${color[diff.type]}">${label[diff.type]}</b> <small>${escapeHtml(diff.path)}</small>
      ${diff.type !== "added" ? `<small style="display:block;color:#888">antes: ${escapeHtml(JSON.stringify(diff.before))}</small>` : ""}
      ${diff.type !== "removed" ? `<small style="display:block;color:#ccc">depois: ${escapeHtml(JSON.stringify(diff.after))}</small>` : ""}
    </div>
  `).join("");
  const truncatedNote = diffs.length > 300 ? `<p class="qts-tool-lead">Mostrando as primeiras 300 diferenças de ${diffs.length}.</p>` : "";
  return rows + truncatedNote;
}

function openJsonStudio() {
  const t = state.t;
  openDrawer({
    title: t.jsonStudioTitle,
    bodyHtml: `
      <div class="qts-tabs"><button type="button" class="isSelected" data-json-mode="format">Formatar</button><button type="button" data-json-mode="diff">Comparar</button></div>
      <section id="jsonFormatMode">
        <textarea id="jsonInput" rows="14" placeholder="${escapeHtml(t.jsonStudioPlaceholder)}" style="font:12px ui-monospace,Consolas,monospace"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button type="button" class="action primary" id="jsonFormat">${escapeHtml(t.jsonStudioFormat)}</button>
          <button type="button" class="action" id="jsonCompact">${escapeHtml(t.jsonStudioCompact)}</button>
          <button type="button" class="action" id="jsonCopy">${escapeHtml(t.jsonStudioCopy)}</button>
        </div>
        <p id="jsonError" style="color:#ff6b6b"></p>
      </section>
      <section id="jsonDiffMode" hidden>
        <p class="qts-tool-lead">Cole dois JSONs (ex.: resposta esperada vs. real) para ver o que mudou entre eles.</p>
        <label class="qts-field-label">JSON A<textarea id="jsonDiffA" rows="6" style="font:12px ui-monospace,Consolas,monospace"></textarea></label>
        <label class="qts-field-label">JSON B<textarea id="jsonDiffB" rows="6" style="font:12px ui-monospace,Consolas,monospace"></textarea></label>
        <button type="button" class="action primary" id="jsonDiffRun">Comparar</button>
        <p id="jsonDiffError" style="color:#ff6b6b"></p>
        <div id="jsonDiffResult"></div>
      </section>
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

      body.querySelectorAll("[data-json-mode]").forEach((button) => button.addEventListener("click", () => {
        body.querySelectorAll("[data-json-mode]").forEach((item) => item.classList.toggle("isSelected", item === button));
        body.querySelector("#jsonFormatMode").hidden = button.dataset.jsonMode !== "format";
        body.querySelector("#jsonDiffMode").hidden = button.dataset.jsonMode !== "diff";
      }));

      body.querySelector("#jsonDiffRun").addEventListener("click", () => {
        const diffErrorEl = body.querySelector("#jsonDiffError");
        const resultEl = body.querySelector("#jsonDiffResult");
        try {
          const a = JSON.parse(body.querySelector("#jsonDiffA").value);
          const b = JSON.parse(body.querySelector("#jsonDiffB").value);
          diffErrorEl.textContent = "";
          resultEl.innerHTML = renderJsonDiff(diffJsonValues(a, b));
        } catch (error) {
          diffErrorEl.textContent = t.jsonStudioInvalid(error.message);
          resultEl.innerHTML = "";
        }
      });
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

const breakpointViewerState = { syncScroll: false, syncClick: false, zoomMultiplier: 1, resizeObserver: null, cleanupFns: [] };

function buildDeviceFrameHtml(pane, device) {
  const chrome = device.kind === "phone"
    ? `<div class="qts-bp-phone-status"><span>${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><span>${ICON("battery")}</span></div>`
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
    .qts-bp-zoom { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px; border: 1px solid #333; border-radius: 8px; background: #1a1a1a; }
    .qts-bp-zoom-btn { all: unset; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 5px; background: #262626; color: #fff; cursor: pointer; font-weight: 900; }
    .qts-bp-zoom-btn:hover { background: #333; }
    .qts-bp-zoom input[type="range"] { width: 90px; }
    #bpZoomLabel { min-width: 38px; text-align: center; color: #ccc; font-variant-numeric: tabular-nums; }
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
  breakpointViewerState.zoomMultiplier = 1;
  const drawerHost = ensureDrawerHost();
  const initialUrl = /^https?:\/\//i.test(window.location.href) ? window.location.href : "https://example.com";
  drawerHost.innerHTML = `<style>${breakpointStyles()}</style>
    <div class="qts-bp-overlay">
      <div class="qts-bp-topbar">
        <input type="url" id="bpUrl" value="${escapeHtml(initialUrl)}" placeholder="https://..." />
        <select id="bpDeviceA">${DEVICE_PRESETS.map((device, index) => `<option value="${device.id}" ${index === 0 ? "selected" : ""}>${escapeHtml(device.label)}</option>`).join("")}</select>
        <select id="bpDeviceB">${DEVICE_PRESETS.map((device, index) => `<option value="${device.id}" ${index === 3 ? "selected" : ""}>${escapeHtml(device.label)}</option>`).join("")}</select>
        <div class="qts-bp-zoom">
          <button type="button" class="qts-bp-zoom-btn" id="bpZoomOut" title="Reduzir zoom">−</button>
          <input type="range" id="bpZoom" min="50" max="200" step="10" value="100" title="Zoom" />
          <span id="bpZoomLabel">100%</span>
          <button type="button" class="qts-bp-zoom-btn" id="bpZoomIn" title="Aumentar zoom">+</button>
        </div>
        <button type="button" class="qts-bp-toggle" id="bpSyncScroll">${escapeHtml(t.syncScroll)}</button>
        <button type="button" class="qts-bp-toggle" id="bpSyncClick">${escapeHtml(t.syncClick)}</button>
        <button type="button" class="qts-bp-close" id="bpClose">×</button>
      </div>
      <div class="qts-bp-stage" id="bpStage"></div>
    </div>`;

  const zoomSlider = drawerHost.querySelector("#bpZoom");
  const zoomLabel = drawerHost.querySelector("#bpZoomLabel");
  const applyZoom = (percent) => {
    const clamped = Math.min(200, Math.max(50, percent));
    zoomSlider.value = String(clamped);
    zoomLabel.textContent = `${clamped}%`;
    breakpointViewerState.zoomMultiplier = clamped / 100;
    fitAndLoad();
  };
  zoomSlider.addEventListener("input", () => applyZoom(Number(zoomSlider.value)));
  drawerHost.querySelector("#bpZoomOut").addEventListener("click", () => applyZoom(Number(zoomSlider.value) - 10));
  drawerHost.querySelector("#bpZoomIn").addEventListener("click", () => applyZoom(Number(zoomSlider.value) + 10));

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
    // The zoom control (breakpointViewerState.zoomMultiplier) is a separate, user-driven
    // multiplier layered on top of the auto-fit base scale, applied identically to both panes —
    // it's the only way to see a device above its real pixel size, which the auto-fit scale
    // deliberately never does on its own (see the comment above).
    const baseScale = Math.min(1, paneWidthBudget / widestDevice, paneHeightBudget / tallestDevice);
    const scale = baseScale * breakpointViewerState.zoomMultiplier;

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

const KEY_VIEW_POSITIONS = [
  ["top-left", "↖", "Superior esquerdo"], ["top-center", "↑", "Superior centro"], ["top-right", "↗", "Superior direito"],
  ["middle-left", "←", "Centro esquerdo"], ["middle-center", "•", "Centro"], ["middle-right", "→", "Centro direito"],
  ["bottom-left", "↙", "Inferior esquerdo"], ["bottom-center", "↓", "Inferior centro"], ["bottom-right", "↘", "Inferior direito"],
];
const KEY_VIEW_SIZE_SCALE = Object.freeze({ small: 0.78, medium: 1, large: 1.3 });
const KEY_VIEW_SENSITIVE_HINT = /(?:passw(?:or)?d|senha|secret|token|authorization|auth[_-]?key|api[_-]?key|card|cart[aã]o|credit|debit|cc(?:num|number)?|cvv|cvc|security[_-]?code)/i;
const KEY_VIEW_MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);

function getKeyViewPreferences() {
  return state.workspace?.preferences?.keyView || { enabled: false, typingMode: false, theme: "dark", position: "bottom-center", mouseEffects: true, keySize: "medium", mouseSize: "medium" };
}

function isKeyViewOwnSurface(event) {
  return event.composedPath?.().some((node) => node?.id === HOST_ID || node?.id === "qts-key-view-overlay" || node?.id === "qts-mouse-view-overlay") === true;
}

function editableTypingTarget(target) {
  return target instanceof Element ? target.closest("input,textarea,[contenteditable='true'],[contenteditable='plaintext-only']") : null;
}

function isSensitiveTypingTarget(target) {
  const editable = editableTypingTarget(target);
  if (!editable) return false;
  if (editable instanceof HTMLInputElement && ["password", "hidden"].includes(editable.type)) return true;
  const hints = [editable.id, editable.getAttribute("name"), editable.getAttribute("autocomplete"), editable.getAttribute("aria-label"), editable.getAttribute("placeholder")].filter(Boolean).join(" ");
  return KEY_VIEW_SENSITIVE_HINT.test(hints);
}

function keyViewLabel(key) {
  const labels = {
    Control: "Ctrl", Meta: "Meta", Alt: "Alt", AltGraph: "AltGr", Shift: "Shift",
    Escape: "Esc", " ": "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", PageUp: "Page Up", PageDown: "Page Down",
  };
  return labels[key] || String(key || "").slice(0, 18);
}

function shortcutLabels(event) {
  if (!event.key || event.key === "Dead" || KEY_VIEW_MODIFIER_KEYS.has(event.key)) return [];
  const labels = [];
  if (event.ctrlKey) labels.push("Ctrl");
  if (event.altKey) labels.push(event.getModifierState?.("AltGraph") ? "AltGr" : "Alt");
  if (event.shiftKey) labels.push("Shift");
  if (event.metaKey) labels.push("Meta");
  const primary = keyViewLabel(event.key);
  if (!labels.includes(primary)) labels.push(event.key.length === 1 && (event.ctrlKey || event.altKey || event.metaKey) ? primary.toUpperCase() : primary);
  return labels;
}

function keycapSvg(label, size = "medium") {
  const baseWidth = Math.min(142, Math.max(46, 22 + Array.from(label).length * 9));
  const scale = KEY_VIEW_SIZE_SCALE[size] || KEY_VIEW_SIZE_SCALE.medium;
  const renderedWidth = Number((baseWidth * scale).toFixed(1));
  const renderedHeight = Number((54 * scale).toFixed(1));
  return `<svg class="qts-keycap" viewBox="0 0 ${baseWidth} 54" width="${renderedWidth}" height="${renderedHeight}" role="img" aria-label="${escapeHtml(label)}">
    <rect class="qts-keycap-shadow" x="3" y="8" width="${baseWidth - 6}" height="42" rx="9" />
    <rect class="qts-keycap-face" x="3" y="3" width="${baseWidth - 6}" height="42" rx="9" />
    <path class="qts-keycap-shine" d="M11 7h${Math.max(10, baseWidth - 22)}a5 5 0 0 1 5 5" />
    <text x="${baseWidth / 2}" y="29" text-anchor="middle">${escapeHtml(label)}</text>
  </svg>`;
}

function updateKeyViewOverlayAppearance(overlay) {
  if (!overlay) return;
  const preferences = getKeyViewPreferences();
  overlay.dataset.theme = preferences.theme;
  overlay.dataset.position = preferences.position;
  overlay.dataset.keySize = preferences.keySize;
}

function ensureKeyViewOverlay() {
  let overlay = document.getElementById("qts-key-view-overlay");
  if (overlay) { updateKeyViewOverlayAppearance(overlay); return overlay; }
  overlay = document.createElement("div");
  overlay.id = "qts-key-view-overlay";
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `<div class="qts-key-view-shortcut" data-key-view-shortcut hidden></div>
    <div class="qts-key-view-typing" data-key-view-typing hidden>
      <pre data-key-view-text></pre><button type="button" data-key-view-clear>Limpar</button>
    </div>`;
  overlay.querySelector("[data-key-view-clear]").addEventListener("click", (event) => {
    event.stopPropagation();
    clearKeyViewTyping();
  });
  document.documentElement.appendChild(overlay);
  updateKeyViewOverlayAppearance(overlay);
  return overlay;
}

function removeKeyViewOverlayIfEmpty() {
  const overlay = document.getElementById("qts-key-view-overlay");
  if (!overlay) return;
  if (overlay.querySelector("[data-key-view-shortcut]")?.hidden && overlay.querySelector("[data-key-view-typing]")?.hidden) overlay.remove();
}

function showKeyViewShortcut(labels) {
  if (!labels.length) return;
  const overlay = ensureKeyViewOverlay();
  const shortcut = overlay.querySelector("[data-key-view-shortcut]");
  const preferences = getKeyViewPreferences();
  shortcut.innerHTML = labels.map((label) => keycapSvg(label, preferences.keySize)).join('<span class="qts-key-plus">+</span>');
  shortcut.hidden = false;
  shortcut.classList.remove("isFading");
  void shortcut.offsetWidth;
  shortcut.classList.add("isFading");
  window.clearTimeout(state.keyView.shortcutTimer);
  state.keyView.shortcutTimer = window.setTimeout(() => {
    shortcut.hidden = true;
    shortcut.classList.remove("isFading");
    removeKeyViewOverlayIfEmpty();
  }, 3_000);
}

function renderKeyViewTyping() {
  const overlay = ensureKeyViewOverlay();
  const panel = overlay.querySelector("[data-key-view-typing]");
  const content = overlay.querySelector("[data-key-view-text]");
  panel.hidden = !state.keyView.typingText;
  content.textContent = state.keyView.typingText;
  content.dataset.length = String(Array.from(state.keyView.typingText).length);
  if (!state.keyView.typingText) removeKeyViewOverlayIfEmpty();
}

function appendKeyViewTyping(value) {
  if (!getKeyViewPreferences().typingMode || !value) return;
  const characters = Array.from(`${state.keyView.typingText}${value}`);
  state.keyView.typingText = characters.slice(-2_000).join("");
  renderKeyViewTyping();
}

function deleteKeyViewTypingCharacter() {
  const characters = Array.from(state.keyView.typingText);
  characters.pop();
  state.keyView.typingText = characters.join("");
  renderKeyViewTyping();
}

function clearKeyViewTyping() {
  state.keyView.typingText = "";
  renderKeyViewTyping();
}

function positionMouseView(overlay) {
  const width = overlay.offsetWidth || 52;
  const height = overlay.offsetHeight || 68;
  let left = state.keyView.pointerX - width - 12;
  let top = state.keyView.pointerY + 16;
  if (left < 8) left = Math.min(window.innerWidth - width - 8, state.keyView.pointerX + 18);
  if (top + height > window.innerHeight - 8) top = Math.max(56, state.keyView.pointerY - height - 18);
  overlay.style.left = `${Math.max(8, left)}px`;
  overlay.style.top = `${Math.max(56, top)}px`;
}

function ensureMouseViewOverlay() {
  let overlay = document.getElementById("qts-mouse-view-overlay");
  if (overlay) {
    updateMouseViewOverlayAppearance(overlay);
    return overlay;
  }
  overlay = document.createElement("div");
  overlay.id = "qts-mouse-view-overlay";
  overlay.innerHTML = `<svg viewBox="0 0 52 68" role="img" aria-label="Ação do mouse">
    <path class="qts-mouse-shadow" d="M26 4C13 4 5 13 5 27v14c0 15 8 23 21 23s21-8 21-23V27C47 13 39 4 26 4Z" />
    <path class="qts-mouse-body" d="M26 2C13 2 5 11 5 25v14c0 15 8 23 21 23s21-8 21-23V25C47 11 39 2 26 2Z" />
    <path class="qts-mouse-left" d="M24 5C14 6 9 13 9 25v3h15V5Z" />
    <path class="qts-mouse-right" d="M28 5c10 1 15 8 15 20v3H28V5Z" />
    <path class="qts-mouse-divider" d="M26 4v25M8 30h36" />
    <rect class="qts-mouse-wheel" x="22" y="11" width="8" height="15" rx="4" />
    <path class="qts-mouse-arrow qts-mouse-arrow-up" d="m26 13-3 4h6Z" />
    <path class="qts-mouse-arrow qts-mouse-arrow-down" d="m26 24 3-4h-6Z" />
  </svg>`;
  document.documentElement.appendChild(overlay);
  updateMouseViewOverlayAppearance(overlay);
  return overlay;
}

function updateMouseViewOverlayAppearance(overlay) {
  if (!overlay) return;
  const preferences = getKeyViewPreferences();
  overlay.dataset.theme = preferences.theme;
  overlay.dataset.mouseSize = preferences.mouseSize;
}

function showMouseView(action, duration = 650) {
  if (!getKeyViewPreferences().enabled || !getKeyViewPreferences().mouseEffects) return;
  const overlay = ensureMouseViewOverlay();
  overlay.dataset.action = action;
  updateMouseViewOverlayAppearance(overlay);
  positionMouseView(overlay);
  overlay.classList.add("isVisible");
  window.clearTimeout(state.keyView.mouseTimer);
  state.keyView.mouseTimer = window.setTimeout(() => overlay.classList.remove("isVisible"), duration);
}

function handleKeyViewKeydown(event) {
  if (isKeyViewOwnSurface(event)) return;
  const sensitive = isSensitiveTypingTarget(event.target);
  const labels = shortcutLabels(event);
  const isShortcut = event.ctrlKey || event.altKey || event.metaKey || event.key.length > 1;
  if (isShortcut && labels.length) showKeyViewShortcut(labels);
  if (!getKeyViewPreferences().typingMode || sensitive || editableTypingTarget(event.target)) return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key.length === 1) appendKeyViewTyping(event.key);
  else if (event.key === "Enter") appendKeyViewTyping("\n");
  else if (event.key === "Tab") appendKeyViewTyping("\t");
  else if (event.key === "Backspace") deleteKeyViewTypingCharacter();
}

function handleKeyViewBeforeInput(event) {
  if (!getKeyViewPreferences().typingMode || isKeyViewOwnSurface(event) || isSensitiveTypingTarget(event.target)) return;
  if (["insertText", "insertCompositionText"].includes(event.inputType) && event.data) appendKeyViewTyping(event.data);
  else if (["insertLineBreak", "insertParagraph"].includes(event.inputType)) appendKeyViewTyping("\n");
  else if (event.inputType === "deleteContentBackward") deleteKeyViewTypingCharacter();
}

function startKeyView() {
  if (state.keyView.listening) { updateKeyViewOverlayAppearance(document.getElementById("qts-key-view-overlay")); return; }
  const onPointerMove = (event) => {
    if (isKeyViewOwnSurface(event)) return;
    state.keyView.pointerX = event.clientX;
    state.keyView.pointerY = event.clientY;
    const overlay = document.getElementById("qts-mouse-view-overlay");
    if (overlay?.classList.contains("isVisible")) positionMouseView(overlay);
  };
  const onMouseDown = (event) => {
    if (isKeyViewOwnSurface(event)) return;
    state.keyView.pointerX = event.clientX; state.keyView.pointerY = event.clientY;
    showMouseView(event.button === 2 ? "right" : event.button === 1 ? "middle" : "left", 900);
  };
  const onMouseUp = () => {
    const overlay = document.getElementById("qts-mouse-view-overlay");
    if (!overlay) return;
    window.clearTimeout(state.keyView.mouseTimer);
    state.keyView.mouseTimer = window.setTimeout(() => overlay.classList.remove("isVisible"), 320);
  };
  const onWheel = (event) => {
    if (isKeyViewOwnSurface(event) || event.deltaY === 0) return;
    state.keyView.pointerX = event.clientX; state.keyView.pointerY = event.clientY;
    showMouseView(event.deltaY < 0 ? "scroll-up" : "scroll-down", 750);
  };
  document.addEventListener("keydown", handleKeyViewKeydown, true);
  document.addEventListener("beforeinput", handleKeyViewBeforeInput, true);
  document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  document.addEventListener("mousedown", onMouseDown, { capture: true, passive: true });
  document.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
  document.addEventListener("wheel", onWheel, { capture: true, passive: true });
  state.keyView.cleanup = () => {
    document.removeEventListener("keydown", handleKeyViewKeydown, true);
    document.removeEventListener("beforeinput", handleKeyViewBeforeInput, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    document.removeEventListener("wheel", onWheel, true);
  };
  state.keyView.listening = true;
}

function stopKeyView() {
  state.keyView.cleanup?.();
  state.keyView.cleanup = null;
  state.keyView.listening = false;
  state.keyView.typingText = "";
  window.clearTimeout(state.keyView.shortcutTimer);
  window.clearTimeout(state.keyView.mouseTimer);
  document.getElementById("qts-key-view-overlay")?.remove();
  document.getElementById("qts-mouse-view-overlay")?.remove();
}

function syncKeyView() {
  const preferences = getKeyViewPreferences();
  const enabled = preferences.enabled === true && hasPlanFeature("keyView");
  state.shadowRoot?.getElementById("keyViewMenuItem")?.classList.toggle("isActive", enabled);
  if (enabled) {
    if (!preferences.typingMode && state.keyView.typingText) clearKeyViewTyping();
    startKeyView();
    const mouseOverlay = document.getElementById("qts-mouse-view-overlay");
    updateMouseViewOverlayAppearance(mouseOverlay);
  } else if (state.keyView.listening || document.getElementById("qts-key-view-overlay")) stopKeyView();
}

async function saveKeyViewPreferences(next) {
  state.workspace.preferences = { ...(state.workspace.preferences || {}), keyView: { ...getKeyViewPreferences(), ...next } };
  await persistWorkspaceState();
}

function openKeyView() {
  if (!requirePlanFeature("keyView")) return;
  const preferences = getKeyViewPreferences();
  let selectedPosition = preferences.position;
  openDrawer({
    title: "Key View",
    bodyHtml: `<p class="qts-tool-lead">Mostre atalhos e ações do mouse durante demonstrações, testes e gravações.</p>
      <div class="qts-card qts-key-view-status"><div><b>Key View</b><small>${preferences.enabled ? "Ativo nesta página" : "Desativado"}</small></div><button class="action ${preferences.enabled ? "" : "primary"}" id="keyViewToggle" type="button">${preferences.enabled ? "Desativar" : "Ativar"}</button></div>
      <label class="qts-switch-row"><input id="keyViewTyping" type="checkbox" ${preferences.typingMode ? "checked" : ""} /><span><b>Modo Typing</b><small>Mantém o texto digitado na tela até você clicar em Limpar.</small></span></label>
      <label class="qts-switch-row"><input id="keyViewMouse" type="checkbox" ${preferences.mouseEffects ? "checked" : ""} /><span><b>Visualizar mouse</b><small>Destaca clique esquerdo, direito, meio e direção do scroll ao lado do ponteiro.</small></span></label>
      <label class="qts-field-label">Aparência das teclas<select id="keyViewTheme"><option value="dark" ${preferences.theme === "dark" ? "selected" : ""}>Tecla preta · texto branco</option><option value="light" ${preferences.theme === "light" ? "selected" : ""}>Tecla branca · texto preto</option></select></label>
      <div class="qts-key-view-size-grid">
        <label class="qts-field-label">Tamanho das teclas<select id="keyViewKeySize"><option value="small" ${preferences.keySize === "small" ? "selected" : ""}>Pequeno</option><option value="medium" ${preferences.keySize === "medium" ? "selected" : ""}>Médio</option><option value="large" ${preferences.keySize === "large" ? "selected" : ""}>Grande</option></select></label>
        <label class="qts-field-label">Tamanho do mouse<select id="keyViewMouseSize"><option value="small" ${preferences.mouseSize === "small" ? "selected" : ""}>Pequeno</option><option value="medium" ${preferences.mouseSize === "medium" ? "selected" : ""}>Médio</option><option value="large" ${preferences.mouseSize === "large" ? "selected" : ""}>Grande</option></select></label>
      </div>
      <div class="qts-field-label"><span>Posição na tela</span><div class="qts-position-grid">${KEY_VIEW_POSITIONS.map(([value, icon, label]) => `<button class="${value === preferences.position ? "isSelected" : ""}" type="button" data-key-view-position="${value}" title="${label}" aria-label="${label}">${icon}</button>`).join("")}</div></div>
      <div class="qts-key-view-preview" data-theme="${preferences.theme}" data-key-size="${preferences.keySize}" id="keyViewPreview">${keycapSvg("Ctrl", preferences.keySize)}<span>+</span>${keycapSvg("V", preferences.keySize)}</div>
      <div class="qts-card qts-privacy-note"><b>Privacidade local</b><p>O texto não é salvo nem enviado. Campos de senha, cartão, CVV, token e segredo nunca são capturados.</p></div>
      <div class="qts-card-actions"><button class="action primary" id="keyViewSave" type="button">Salvar configurações</button><button class="action" id="keyViewClear" type="button">Limpar texto</button></div><div class="qts-status" id="keyViewStatus"></div>`,
    onReady(body) {
      const theme = body.querySelector("#keyViewTheme");
      const keySize = body.querySelector("#keyViewKeySize");
      const mouseSize = body.querySelector("#keyViewMouseSize");
      const preview = body.querySelector("#keyViewPreview");
      const renderPreview = () => {
        preview.dataset.theme = theme.value;
        preview.dataset.keySize = keySize.value;
        preview.innerHTML = `${keycapSvg("Ctrl", keySize.value)}<span>+</span>${keycapSvg("V", keySize.value)}`;
      };
      theme.addEventListener("change", renderPreview);
      keySize.addEventListener("change", renderPreview);
      body.querySelectorAll("[data-key-view-position]").forEach((button) => button.addEventListener("click", () => {
        selectedPosition = button.dataset.keyViewPosition;
        body.querySelectorAll("[data-key-view-position]").forEach((candidate) => candidate.classList.toggle("isSelected", candidate === button));
      }));
      body.querySelector("#keyViewToggle").addEventListener("click", async () => {
        await saveKeyViewPreferences({ enabled: !getKeyViewPreferences().enabled });
        openKeyView();
      });
      body.querySelector("#keyViewSave").addEventListener("click", async () => {
        await saveKeyViewPreferences({ typingMode: body.querySelector("#keyViewTyping").checked, mouseEffects: body.querySelector("#keyViewMouse").checked, theme: theme.value, position: selectedPosition, keySize: keySize.value, mouseSize: mouseSize.value });
        body.querySelector("#keyViewStatus").textContent = translateQaSurfaceText("Configurações salvas.");
      });
      body.querySelector("#keyViewClear").addEventListener("click", () => { clearKeyViewTyping(); body.querySelector("#keyViewStatus").textContent = translateQaSurfaceText("Texto limpo."); });
    },
  });
}

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

function xpathLiteral(value) {
  const text = String(value ?? "");
  if (!text.includes('"')) return `"${text}"`;
  if (!text.includes("'")) return `'${text}'`;
  return `concat(${text.split('"').map((part, index) => `${index ? `, '\"', ` : ""}"${part}"`).join("")})`;
}

// ID-shortcut when available (short, stable); otherwise a positional path from <html> down,
// counting only same-tag siblings so it stays valid even when siblings are added/removed.
function buildXPath(element) {
  if (!(element instanceof Element)) return "";
  if (element.id) return `//*[@id=${xpathLiteral(element.id)}]`;
  const segments = [];
  let node = element;
  while (node instanceof Element && node !== document.documentElement) {
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === node.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${node.tagName.toLowerCase()}[${index}]`);
    node = node.parentElement;
  }
  return `/html/${segments.join("/")}`;
}

// Reuses CLICK_SPY_SELECTOR's definition of "interactive element" rather than inventing a second
// one. Never captures `.value` for any field (privacy) — only structural/locator data for the
// automation team, with a `sensitive` flag (reusing the same detection Macro Studio/Key View use)
// so they know which fields to handle carefully.
function captureVisibleElements() {
  return [...document.querySelectorAll(CLICK_SPY_SELECTOR)]
    .filter((element) => !isInsideToolbarUi(element))
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute("type") || "",
      name: element.getAttribute("name") || "",
      id: element.id || "",
      testId: element.getAttribute("data-testid") || "",
      cssSelector: window.QTS_QA_TOOLS.uniqueSelector(element),
      xpath: buildXPath(element),
      text: String(element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
      placeholder: element.getAttribute("placeholder") || "",
      // Icon-only buttons/links have no text at all — the closest thing to a "visible label" for
      // those is whatever image they contain (or, if the element itself is one, its own src).
      imagePreview: element.tagName === "IMG" ? element.getAttribute("src") || "" : element.querySelector("img")?.getAttribute("src") || "",
      sensitive: window.QTS_QA_TOOLS.isSensitiveElement(element),
    }));
}

// Element Capture's own "Localizar" — unlike locateValueOnPage's exact-text search (built for
// JSON leaf values), this has an actual CSS selector captured at scan time, which is a far more
// precise and reliable way to re-find the same element on the live page.
function locateElementBySelector(selector) {
  let match = null;
  try { match = selector ? document.querySelector(selector) : null; } catch { match = null; }
  if (!match) { showQaToast(state.t.inspectorsLocateNotFound, "error"); return; }
  match.scrollIntoView({ behavior: "smooth", block: "center" });
  match.classList.add("qts-locate-highlight");
  window.setTimeout(() => match.classList.remove("qts-locate-highlight"), 2200);
}

// "Estado atual" for a captured row: re-queries the live element (not the stale snapshot taken at
// scan time) so this always reflects what's true on the page right now, in the spirit of the
// founder's "like Click Spy" request without duplicating Click Spy's own click-and-observe engine.
function describeElementCurrentState(selector) {
  let element = null;
  try { element = selector ? document.querySelector(selector) : null; } catch { element = null; }
  if (!element) return null;
  const style = window.getComputedStyle(element);
  const parts = [
    ["Visível", style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null ? "Sim" : "Não"],
    ["Habilitado", !element.disabled ? "Sim" : "Não"],
  ];
  if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) parts.push(["Marcado", element.checked ? "Sim" : "Não"]);
  else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) parts.push(["Preenchido", element.value ? "Sim" : "Não"]);
  else if (element instanceof HTMLSelectElement) parts.push(["Opção selecionada", element.options[element.selectedIndex]?.text || "—"]);
  return parts;
}

function toCsvCell(value) {
  // Prevent spreadsheet formula injection when a site-controlled label/id begins with a
  // formula marker. The apostrophe is how Excel/Sheets explicitly represent literal text.
  const raw = String(value ?? "");
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadElementCaptureCsv(rows) {
  const headers = ["tag", "type", "name", "id", "test_id", "css_selector", "xpath", "text", "placeholder", "sensitive"];
  const csvKeys = ["tag", "type", "name", "id", "testId", "cssSelector", "xpath", "text", "placeholder", "sensitive"];
  const lines = [headers.join(","), ...rows.map((row) => csvKeys.map((key) => toCsvCell(row[key])).join(","))];
  // Leading BOM keeps accented pt-BR text readable when the CSV is opened directly in Excel.
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `qa-element-capture-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function elementCaptureLabel(row) {
  return row.text || row.placeholder || row.name || row.testId || row.id || "";
}

function openElementCapture() {
  if (!requirePlanFeature("elementCapture")) return;
  let rows = captureVisibleElements();
  let query = "";
  openDrawer({
    title: "Capturar elementos",
    bodyHtml: `<p class="qts-tool-lead">Captura todos os elementos interativos da página atual (links, botões, inputs, selects) com seletor CSS e XPath prontos para automação. Nenhum valor digitado é exportado.</p>
      <div class="qts-card-actions"><button class="action" id="elementCaptureRescan" type="button">Recapturar</button><button class="action primary" id="elementCaptureExport" type="button">Exportar CSV</button></div>
      <div class="qts-toolbar-row"><input type="search" id="elementCaptureSearch" class="qts-toolbar-search" placeholder="Buscar por texto, tag, test-id, CSS ou XPath..." /></div>
      <div class="qts-status" id="elementCaptureStatus"></div>
      <div style="display:grid;gap:8px;max-height:360px;overflow:auto" id="elementCapturePreview"></div>`,
    onReady(body) {
      const status = body.querySelector("#elementCaptureStatus");
      const preview = body.querySelector("#elementCapturePreview");
      const exportButton = body.querySelector("#elementCaptureExport");
      const searchInput = body.querySelector("#elementCaptureSearch");
      const matchesQuery = (row) => {
        if (!query) return true;
        const haystack = `${row.tag} ${row.type} ${row.name} ${row.id} ${row.testId} ${row.cssSelector} ${row.xpath} ${row.text} ${row.placeholder}`.toLowerCase();
        return haystack.includes(query);
      };
      const renderPreview = () => {
        const decorated = rows.map((row, index) => ({ ...row, _index: index }));
        const filtered = decorated.filter(matchesQuery);
        const capped = filtered.slice(0, 80);
        status.textContent = query
          ? `${filtered.length} de ${rows.length} elemento(s) (filtrado).`
          : `${rows.length} elemento(s) encontrado(s) na página atual.`;
        exportButton.disabled = rows.length === 0;
        preview.innerHTML = filtered.length
          ? capped.map((row) => {
              const label = elementCaptureLabel(row);
              const labelHtml = label
                ? escapeHtml(label)
                : row.imagePreview
                  ? `<img src="${escapeHtml(row.imagePreview)}" alt="" style="width:16px;height:16px;object-fit:cover;border-radius:3px;vertical-align:middle;margin-right:4px" />(sem texto)`
                  : `<span style="color:#888">(sem texto)</span>`;
              return `
                <div class="qts-net-item" style="cursor:default" data-row-index="${row._index}">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                    <div style="min-width:0"><b>${escapeHtml(row.tag)}${row.type ? `[${escapeHtml(row.type)}]` : ""}</b> ${labelHtml}${row.sensitive ? ` <span style="color:#ff6767">sensível</span>` : ""}${row.testId ? ` <span style="color:#42d5c2">test-id</span>` : ""}</div>
                    <div style="display:flex;gap:4px;flex:0 0 auto">
                      <button type="button" class="qts-icon-btn" data-locate-row title="Localizar elemento" style="width:26px;height:26px">${ICON("cursor")}</button>
                      <button type="button" class="qts-icon-btn" data-state-row title="Ver estado atual" style="width:26px;height:26px">${ICON("eye")}</button>
                    </div>
                  </div>
                  <small>${escapeHtml(row.cssSelector)}</small>
                  <div data-state-body hidden style="margin-top:4px"></div>
                </div>
              `;
            }).join("") + (filtered.length > capped.length ? `<p class="qts-tool-lead">Mostrando 80 de ${filtered.length} — refine a busca para ver outros.</p>` : "")
          : `<div class="qts-empty">${rows.length ? "Nenhum elemento corresponde à busca." : "Nenhum elemento interativo encontrado nesta página."}</div>`;

        preview.querySelectorAll("[data-locate-row]").forEach((button) => button.addEventListener("click", (event) => {
          const rowEl = event.target.closest("[data-row-index]");
          locateElementBySelector(rows[Number(rowEl.dataset.rowIndex)]?.cssSelector);
        }));
        preview.querySelectorAll("[data-state-row]").forEach((button) => button.addEventListener("click", (event) => {
          const rowEl = event.target.closest("[data-row-index]");
          const row = rows[Number(rowEl.dataset.rowIndex)];
          const stateBody = rowEl.querySelector("[data-state-body]");
          const willShow = stateBody.hidden;
          stateBody.hidden = !willShow;
          if (willShow) {
            const parts = describeElementCurrentState(row?.cssSelector);
            stateBody.innerHTML = parts
              ? parts.map(([label, value]) => `<small style="display:block">${escapeHtml(label)}: <b>${escapeHtml(value)}</b></small>`).join("")
              : `<small style="color:#ff6767">Elemento não encontrado mais na página (pode ter mudado desde a captura).</small>`;
          }
        }));
      };
      body.querySelector("#elementCaptureRescan").addEventListener("click", () => { rows = captureVisibleElements(); renderPreview(); });
      searchInput.addEventListener("input", (event) => { query = event.target.value.trim().toLowerCase(); renderPreview(); });
      exportButton.addEventListener("click", () => {
        downloadElementCaptureCsv(rows);
        showQaToast(`CSV exportado com ${rows.length} elemento(s).`);
      });
      renderPreview();
    },
  });
}

function renderPinnedMacros() {
  const container = state.shadowRoot?.getElementById("pinnedMacrosMenu");
  if (!container) return;
  if (!hasPlanFeature("macroStudio")) { container.innerHTML = ""; return; }
  const pinned = new Set(state.workspace?.preferences?.pinnedMacroIds || []);
  const macros = (state.workspace?.macros || []).filter((macro) => pinned.has(macro.id));
  container.innerHTML = macros.map((macro) => `<button type="button" data-pinned-macro="${escapeHtml(macro.id)}" title="Executar macro">${ICON("play")} ${escapeHtml(macro.name)}</button>`).join("");
  container.querySelectorAll("[data-pinned-macro]").forEach((button) => button.addEventListener("click", () => {
    const macro = (state.workspace.macros || []).find((item) => item.id === button.dataset.pinnedMacro);
    closeToolsMenu();
    if (macro) void playMacro(macro);
  }));
}

// Live badge anchored to a real page input/textarea, so a founder can watch a character limit
// (e.g. a bio field) update as they type without switching back and forth to the drawer. Tracked
// by a 200ms poll rather than scroll/resize listeners — matches this file's existing polling
// pattern (state.locationInterval) and means a badge cleans itself up for free whenever its
// target disappears (SPA re-render) or clearAllFloatingItems() sweeps every `.qts-floating-item`,
// without needing to hook into that sweep separately.
const characterCounterOverlays = new Map();

function attachCharacterCounterBadge(element) {
  const existingCleanup = characterCounterOverlays.get(element);
  if (existingCleanup) { existingCleanup(); characterCounterOverlays.delete(element); return; }
  const badge = document.createElement("div");
  badge.className = "qts-floating-item qts-char-counter-badge";
  badge.innerHTML = `<span data-count>0</span> car.<button type="button" class="qts-remove-btn" data-close aria-label="Remover">×</button>`;
  document.body.appendChild(badge);
  const reposition = () => {
    const rect = element.getBoundingClientRect();
    badge.style.left = `${Math.max(4, rect.left)}px`;
    badge.style.top = `${Math.max(4, rect.top - 30)}px`;
    const metrics = window.QTS_QA_TOOLS.countCharacters(element.value ?? "");
    badge.querySelector("[data-count]").textContent = String(metrics.withSpaces);
  };
  const timer = window.setInterval(() => {
    if (!badge.isConnected || !element.isConnected) { window.clearInterval(timer); characterCounterOverlays.delete(element); return; }
    reposition();
  }, 200);
  const cleanup = () => { badge.remove(); window.clearInterval(timer); };
  badge.querySelector("[data-close]").addEventListener("click", () => { cleanup(); characterCounterOverlays.delete(element); });
  characterCounterOverlays.set(element, cleanup);
  reposition();
}

function openCharacterCounter(initialText = null) {
  if (!requirePlanFeature("characterCounter")) return;
  const selected = initialText ?? String(document.getSelection()?.toString() || "");
  openDrawer({
    title: "Contador de caracteres",
    bodyHtml: `<p class="qts-tool-lead">Cole ou selecione um texto para medir caracteres, palavras, linhas e bytes.</p>
      <textarea id="characterCounterInput" rows="9" placeholder="Digite ou cole seu texto...">${escapeHtml(selected)}</textarea>
      <div class="qts-card-actions"><button class="action" id="useSelection" type="button">Usar seleção da página</button><button class="action" id="clearCounter" type="button">Limpar</button><button class="action" id="pickCounterField" type="button">Acompanhar campo da página</button></div>
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
      body.querySelector("#pickCounterField").addEventListener("click", () => selectPageElement({
        resolve: resolveFormControlTarget,
        accepts: (element) => (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && !window.QTS_QA_TOOLS.isSensitiveElement(element),
        instruction: "Clique num campo de texto da página para acompanhar a contagem ao lado dele.",
        onSelected: (element) => {
          attachCharacterCounterBadge(element);
          showQaToast("Contador anexado ao campo. Clique no × do badge para remover.");
        },
      }));
      update();
    },
  });
}

function cancelElementSelection() {
  state.selectionCleanup?.();
  state.selectionCleanup = null;
}

// `resolve` maps the literal click target to the element the caller actually cares about, before
// `accepts` even runs — e.g. Input Lab wants clicking anywhere on a floating-label wrapper (a
// common real-world pattern where the visible "input box" is a padded container around a
// smaller <input>) to still resolve to the real <input>, not reject it outright. Defaults to
// identity so callers that already accept the raw target (Multiclick, Faker Fill's own
// `.closest("form")` check) are unaffected.
function selectPageElement({ accepts = () => true, resolve = (target) => target, onSelected, instruction }) {
  closeDrawer();
  cancelElementSelection();
  const style = document.createElement("style");
  style.id = "qts-element-selector-style";
  style.textContent = "html.qts-selecting,html.qts-selecting *{cursor:crosshair!important}.qts-selection-candidate{outline:3px solid #ffd700!important;outline-offset:2px!important}";
  document.documentElement.appendChild(style);
  document.documentElement.classList.add("qts-selecting");
  // Reinforces that Esc cancels — the first toast (below) gets buried once a few "not
  // compatible" rejection toasts stack up, which previously left the only cancel hint invisible.
  const hint = document.createElement("div");
  hint.className = "qts-floating-item";
  hint.style.cssText = "position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2147483647;background:#0b0b0b;color:#ffd700;border:1px solid #ffd700;border-radius:999px;padding:6px 14px;font:700 11px sans-serif;pointer-events:none";
  hint.textContent = translateQaSurfaceText("Esc para cancelar a seleção");
  document.body.appendChild(hint);
  let candidate = null;
  const cleanup = () => {
    candidate?.classList.remove("qts-selection-candidate");
    document.documentElement.classList.remove("qts-selecting");
    style.remove();
    hint.remove();
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onOver = (event) => {
    if (event.target.closest?.(`#${HOST_ID}`)) return;
    candidate?.classList.remove("qts-selection-candidate");
    // Falls back to the raw hover target so *something* highlights under the cursor generally —
    // but only the resolved candidate (if any) is what onClick will actually accept/select.
    candidate = resolve(event.target) || event.target;
    candidate.classList.add("qts-selection-candidate");
  };
  const onClick = (event) => {
    if (event.target.closest?.(`#${HOST_ID}`)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const target = resolve(event.target);
    if (!target || !accepts(target)) { showQaToast("Selecione um elemento compatível.", "error"); return; }
    cleanup(); state.selectionCleanup = null; onSelected(target);
  };
  const onKey = (event) => { if (event.key === "Escape") { cleanup(); state.selectionCleanup = null; showQaToast("Seleção cancelada."); } };
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  state.selectionCleanup = cleanup;
  showQaToast(instruction || "Clique no elemento da página. Esc cancela.");
}

// Clicking anywhere on a real input resolves to itself; clicking a wrapper/label around it
// (floating-label patterns, custom-select containers) searches its descendants first — the
// common real case, since the visible "box" is usually the wrapper, not the input — falling back
// to ancestors for the rarer case of clicking a decorative child nested inside the input's own
// wrapper alongside it.
function resolveFormControlTarget(target) {
  if (!(target instanceof Element)) return null;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return target;
  return target.querySelector?.("input,textarea,select") || target.closest?.("input,textarea,select") || null;
}

// Short human-readable confirmation of what a page-picked element actually is, shown in a toast
// right after picking — the closest thing to a "visible label" without persisting a new field on
// the macro step schema just for display.
function describeElementForMacro(element) {
  const tag = element.tagName.toLowerCase();
  const label = element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("name")
    || (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40) || element.getAttribute("alt") || "";
  return label ? `${tag} "${label}"` : tag;
}

function openMultiClick(selectedElement = null) {
  if (!requirePlanFeature("multiClick")) return;
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
  if (!requirePlanFeature("inputLab")) return;
  const info = selectedElement ? window.QTS_QA_TOOLS.inspectInput(selectedElement) : null;
  const infoHtml = info ? `<div class="qts-card"><b>${escapeHtml(info.selector)}</b><div class="qts-tool-grid">${[["Tipo", info.type], ["Obrigatório", info.required ? "Sim" : "Não"], ["Mínimo", info.min ?? info.minLength ?? "—"], ["Máximo", info.max ?? info.maxLength ?? "—"], ["Pattern", info.pattern || "—"]].map(([label, value]) => `<div><small>${label}</small><br><b>${escapeHtml(value)}</b></div>`).join("")}</div></div>` : "";
  openDrawer({
    title: "Input Lab",
    bodyHtml: `<p class="qts-tool-lead">Inspecione as regras HTML e teste texto, números, caracteres especiais, Unicode, vazio e limite sem enviar o formulário. O valor original é restaurado.</p>
      <button class="action" id="inputSelect" type="button">Selecionar input na página</button>${infoHtml}
      ${info ? `<button class="action primary" id="inputRun" type="button" ${info.sensitive ? "disabled" : ""}>Rodar kit de validação</button><div id="inputResults"></div>` : ""}`,
    onReady(body) {
      body.querySelector("#inputSelect").addEventListener("click", () => selectPageElement({ resolve: resolveFormControlTarget, accepts: (element) => Boolean(element), onSelected: (element) => openInputLab(element), instruction: "Clique no input que deseja validar." }));
      body.querySelector("#inputRun")?.addEventListener("click", async (event) => {
        const runButton = event.currentTarget;
        runButton.disabled = true;
        const output = body.querySelector("#inputResults"); output.textContent = "Testando...";
        try {
          const results = await window.QTS_QA_TOOLS.runInputValidation(selectedElement);
          output.innerHTML = `<table class="qts-result-table"><thead><tr><th>Caso</th><th>Enviado</th><th>Recebido</th><th>Validade</th></tr></thead><tbody>${results.map((result) => `<tr><td>${escapeHtml(result.name)}</td><td>${result.attemptedLength}</td><td>${result.actualLength}</td><td>${result.accepted ? `${ICON("pass")} aceito` : `${ICON("fail")} ${escapeHtml(result.message || "rejeitado")}`}</td></tr>`).join("")}</tbody></table>`;
        } catch (error) { output.textContent = error.message; }
        runButton.disabled = false;
      });
    },
  });
}

function openFakerFill(selectedRoot = null) {
  if (!requirePlanFeature("fakerFill")) return;
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

// ---------------------------------------------------------------------------
// QA Sandbox right-click menu: background.js relays a chosen action here for
// whichever tab the user right-clicked in. Chrome's contextMenus API hands back
// no DOM reference for the click, so the actual element is captured by this
// content script's own `contextmenu` listener the instant before the native
// menu opens, then read back once the background script's click message
// arrives with the chosen action.
// ---------------------------------------------------------------------------
let lastContextMenuTarget = null;
let lastContextMenuPoint = { x: 16, y: 16 };

document.addEventListener("contextmenu", (event) => {
  lastContextMenuTarget = event.target instanceof Element ? event.target : null;
  lastContextMenuPoint = { x: event.clientX, y: event.clientY };
}, true);

function elementLocatorRows(element) {
  const testId = element.getAttribute("data-testid") || element.getAttribute("data-test") || element.getAttribute("data-qa") || "";
  return [
    ["Tag", element.tagName.toLowerCase()],
    ["ID", element.id || "—"],
    ["Test ID", testId || "—"],
    ["Name", element.getAttribute("name") || "—"],
    ["Seletor CSS", window.QTS_QA_TOOLS.uniqueSelector(element)],
    ["XPath", buildXPath(element)],
  ];
}

function showLocatorReveal(element, clientX, clientY) {
  document.querySelectorAll(".qts-locator-reveal").forEach((node) => node.remove());
  const panel = document.createElement("div");
  panel.className = "qts-floating-item qts-locator-reveal";
  panel.style.left = `${Math.max(4, Math.min(clientX, window.innerWidth - 336))}px`;
  panel.style.top = `${Math.max(getCurrentHeight() + 4, clientY)}px`;
  const sensitive = window.QTS_QA_TOOLS.isSensitiveElement(element);
  panel.innerHTML = `
    <div class="qts-locator-head"><span>Locators</span><button type="button" class="qts-remove-btn" data-close title="${escapeHtml(state.t.remove)}">×</button></div>
    <div class="qts-locator-body">
      ${sensitive ? `<p class="qts-locator-warning">${ICON("warning")} Campo sensível — valor não exibido.</p>` : ""}
      ${elementLocatorRows(element).map(([label, value]) => `<div class="qts-locator-row"><small>${escapeHtml(label)}</small><div class="qts-locator-value"><code>${escapeHtml(String(value))}</code><button type="button" class="qts-locator-copy" data-copy="${escapeHtml(String(value))}" title="Copiar">${ICON("copy")}</button></div></div>`).join("")}
    </div>`;
  document.body.appendChild(panel);
  panel.querySelector("[data-close]").addEventListener("click", () => panel.remove());
  panel.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => {
    navigator.clipboard?.writeText(button.dataset.copy || "").then(() => showQaToast("Copiado para a área de transferência."));
  }));
}

function handleContextAction(action) {
  const target = lastContextMenuTarget;
  const { x, y } = lastContextMenuPoint;
  if (action === "char-counter") {
    const field = resolveFormControlTarget(target);
    if (field && !window.QTS_QA_TOOLS.isSensitiveElement(field)) {
      if (!requirePlanFeature("characterCounter")) return;
      attachCharacterCounterBadge(field);
      showQaToast("Contador anexado ao campo. Clique no × do badge para remover.");
      return;
    }
    openCharacterCounter(String(target?.innerText || target?.textContent || "").trim());
    return;
  }
  if (action === "reveal-locators") {
    if (!target) { showQaToast("Nenhum elemento selecionado.", "error"); return; }
    if (!requirePlanFeature("elementCapture")) return;
    showLocatorReveal(target, x, y);
    return;
  }
  if (action === "fill-fake-data") {
    if (!requirePlanFeature("fakerFill")) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      const result = window.QTS_QA_TOOLS.fillSingleField(target);
      showQaToast(result.filled ? "Campo preenchido com dado fake." : "Campo sensível, somente leitura ou desabilitado — não preenchido.", result.filled ? "info" : "error");
      return;
    }
    const scope = target?.closest?.("form") || document;
    const result = window.QTS_QA_TOOLS.fillWithFakeData(scope);
    showQaToast(`${result.filled} campo(s) preenchido(s); ${result.protectedCount} sensível(is) protegido(s).`);
    return;
  }
  if (action === "check-limits") {
    openInputLab(resolveFormControlTarget(target));
  }
}

function appendRecordedStep(step) {
  const recording = state.macroRecording;
  if (!recording || recording.paused || recording.steps.length >= 200) return;
  const elapsed = Date.now() - recording.lastAt;
  if (recording.steps.length && elapsed > 700) recording.steps.push({ action: "wait", ms: Math.min(3_000, elapsed) });
  const previous = recording.steps.at(-1);
  if (previous && previous.action === step.action && previous.selector === step.selector && ["fill", "select", "check"].includes(step.action)) recording.steps[recording.steps.length - 1] = step;
  else recording.steps.push(step);
  recording.lastAt = Date.now();
  updateMacroRecordingUi();
}

// One-line human description for the recording history panel — mirrors the same action set
// `defaultMacroStep`/`macroStepFields` already know about, just rendered as prose instead of form
// fields.
function macroStepLabel(step) {
  if (step.action === "click") return `Clique em ${step.selector}`;
  if (step.action === "fill") return `Escrever “${step.value}” em ${step.selector}`;
  if (step.action === "select") return `Selecionar “${step.value}” em ${step.selector}`;
  if (step.action === "check") return `${step.checked === false ? "Desmarcar" : "Marcar"} ${step.selector}`;
  if (step.action === "press") return `Tecla ${step.value} em ${step.selector}`;
  if (step.action === "wait") return `Esperar ${step.ms}ms`;
  return step.action;
}

function renderMacroHistoryPanel() {
  const panel = state.shadowRoot?.getElementById("macroRecHistoryPanel");
  if (!panel) return;
  const steps = state.macroRecording?.steps || [];
  panel.innerHTML = steps.length
    ? steps.map((step, index) => `<div class="qts-macro-hist-row"><span>${index + 1}. ${escapeHtml(macroStepLabel(step))}</span><button type="button" data-remove-history-step="${index}" title="Remover esta ação">×</button></div>`).join("")
    : `<div class="qts-macro-hist-empty">Nenhuma ação gravada ainda.</div>`;
  panel.querySelectorAll("[data-remove-history-step]").forEach((button) => {
    button.addEventListener("click", () => {
      state.macroRecording?.steps.splice(Number(button.dataset.removeHistoryStep), 1);
      updateMacroRecordingUi();
    });
  });
}

function updateMacroRecordingUi() {
  const root = state.shadowRoot;
  if (!root) return;
  const recording = state.macroRecording;
  const bar = root.getElementById("macroRecordingBar");
  bar?.classList.toggle("isHidden", !recording);
  if (!recording) { root.getElementById("macroRecHistoryPanel")?.classList.add("isHidden"); return; }
  bar.classList.toggle("isPaused", recording.paused);
  const count = root.getElementById("macroStepCount");
  if (count) count.textContent = recording.steps.length;
  const pauseButton = root.getElementById("macroRecPauseButton");
  if (pauseButton) { pauseButton.innerHTML = recording.paused ? ICON("play") : ICON("pause"); pauseButton.title = recording.paused ? "Retomar gravação" : "Pausar gravação"; }
  if (!root.getElementById("macroRecHistoryPanel")?.classList.contains("isHidden")) renderMacroHistoryPanel();
}

function toggleMacroRecordingPause() {
  const recording = state.macroRecording;
  if (!recording) return;
  recording.paused = !recording.paused;
  // Resuming starts a fresh interval so the paused gap itself is never recorded as a "wait" step.
  if (!recording.paused) recording.lastAt = Date.now();
  updateMacroRecordingUi();
  showQaToast(recording.paused ? "Gravação pausada." : "Gravação retomada.");
}

function undoLastMacroStep() {
  const recording = state.macroRecording;
  if (!recording?.steps.length) return;
  recording.steps.pop();
  updateMacroRecordingUi();
}

function cancelMacroRecording() {
  const recording = state.macroRecording;
  if (!recording) return;
  recording.cleanup();
  state.macroRecording = null;
  updateMacroRecordingUi();
  showQaToast("Gravação cancelada.");
}

function toggleMacroHistoryPanel() {
  const panel = state.shadowRoot?.getElementById("macroRecHistoryPanel");
  if (!panel) return;
  const willShow = panel.classList.contains("isHidden");
  panel.classList.toggle("isHidden", !willShow);
  if (willShow) renderMacroHistoryPanel();
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
  state.macroRecording = { steps: [], lastAt: Date.now(), paused: false, cleanup: () => { document.removeEventListener("click", click, true); document.removeEventListener("change", change, true); document.removeEventListener("keydown", keydown, true); } };
  updateMacroRecordingUi();
  showQaToast("Gravação iniciada. Senhas e dados sensíveis não serão capturados.");
}

function stopMacroRecording() {
  const recording = state.macroRecording;
  if (!recording) return;
  recording.cleanup();
  state.macroRecording = null;
  updateMacroRecordingUi();
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
  if (!hasPlanFeature("macroStudio") || state.macroPlaying || !macro?.steps?.length) return;
  playSound("macroPlay");
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
  const selector = `<span style="display:flex;gap:5px;align-items:center"><input data-field="selector" value="${escapeHtml(step.selector || "")}" placeholder="Seletor CSS" aria-label="Seletor CSS" style="flex:1;min-width:0" /><button type="button" class="qts-icon-btn" data-pick-selector style="width:28px;height:28px" title="Selecionar elemento na página">${ICON("cursor")}</button></span>`;
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
  const palette = [["click", `${ICON("cursor")} Clique`], ["fill", `${ICON("keyView")} Escrever`], ["select", `${ICON("chevronDown")} Selecionar`], ["check", `${ICON("checkSquare")} Checkbox`], ["press", `${ICON("key")} Tecla`], ["wait", `${ICON("wait")} Esperar`], ["scroll", `${ICON("scroll")} Scroll`], ["multiClick", `${ICON("multiClick")} Multiclick`], ["fakerFill", `${ICON("fakerFill")} Faker Fill`]];
  openDrawer({
    title: "Macro Studio",
    variant: "modal",
    bodyHtml: `<div class="qts-toolbar-row"><button class="action" id="macroBack" type="button">${ICON("arrowLeft")} Macros</button><input id="macroName" value="${escapeHtml(macro.name)}" placeholder="Nome da macro" /><button class="action primary" id="macroSave" type="button">Salvar macro</button></div>
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
      // "Selecionar elemento na página": reuses the same click-to-pick pattern as Multiclick/Faker
      // Fill instead of forcing a hand-typed CSS selector. selectPageElement() closes this drawer
      // to let the user click the live page, so the in-progress edits (this row's other fields,
      // any unsaved name/description) are snapshotted via `current()` *before* that happens, then
      // the whole editor reopens fresh with the picked selector merged in.
      flow.addEventListener("click", (event) => {
        const pickButton = event.target.closest("[data-pick-selector]");
        if (!pickButton) return;
        const index = Number(pickButton.closest("[data-step-index]").dataset.stepIndex);
        const snapshot = current();
        selectPageElement({
          instruction: "Clique no elemento que esta etapa deve usar. Esc cancela.",
          onSelected: (element) => {
            const selector = window.QTS_QA_TOOLS.uniqueSelector(element);
            if (!selector) { showQaToast("Não foi possível gerar um seletor único para esse elemento.", "error"); return; }
            snapshot.steps[index].selector = selector;
            openMacroEditor(snapshot);
            showQaToast(`Selecionado: ${describeElementForMacro(element)}`);
          },
        });
      });
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
  if (!requirePlanFeature("macroStudio")) return;
  const macros = state.workspace?.macros || [];
  const pinned = new Set(state.workspace?.preferences?.pinnedMacroIds || []);
  openDrawer({
    title: "Macro Studio",
    variant: "modal",
    bodyHtml: `<p class="qts-tool-lead">Grave ações ou monte um fluxo visual. Tudo fica local e só ações declarativas validadas são executadas.</p>
      <div class="qts-toolbar-row"><button class="action primary" id="startMacroRecording" type="button">${ICON("recordStart")} Gravar macro</button><button class="action" id="newMacro" type="button">+ Nova no Vibe Code</button><button class="action" id="importMacros" type="button">Importar</button><button class="action" id="exportAllMacros" type="button" ${macros.length ? "" : "disabled"}>Exportar todas</button><input id="macroFile" type="file" accept="application/json,.json" hidden /></div>
      <div id="macroList">${macros.length ? macros.map((macro) => `<article class="qts-card" data-macro-id="${escapeHtml(macro.id)}"><div class="qts-card-head"><div><b>${escapeHtml(macro.name)}</b><br><small>${macro.steps.length} etapa(s)${macro.description ? ` · ${escapeHtml(macro.description)}` : ""}</small></div><span>${pinned.has(macro.id) ? ICON("pin") : ""}</span></div><div class="qts-card-actions"><button class="action primary" data-macro-action="play" type="button">${ICON("play")} Executar</button><button class="action" data-macro-action="edit" type="button">Editar</button><button class="action" data-macro-action="pin" type="button">${pinned.has(macro.id) ? "Desafixar" : "Fixar no menu"}</button><button class="action" data-macro-action="export" type="button">Exportar</button><button class="action" data-macro-action="delete" type="button">Excluir</button></div></article>`).join("") : `<div class="qts-empty">Nenhuma macro salva. Grave suas ações ou comece no Vibe Code.</div>`}</div><div class="qts-status" id="macroStatus"></div>`,
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
document.addEventListener("qts:http-error-captured", (event) => handleHttpErrorCaptured(event.detail));
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
  toggle.innerHTML = recordingState.status === "recording" ? ICON("pause") : recordingState.status === "paused" ? ICON("play") : ICON("recordStart");
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function refreshAuthorization(force = false) {
  const access = await requestAccessState(force);
  state.authorized = access.active === true;
  state.features = isPlainObject(access.features) ? access.features : {};
  if (!state.authorized) removeToolbar({ disableBridge: true });
  else syncToolbarForCurrentLocation();
  return state.authorized;
}

async function boot() {
  // Registered with allFrames:true so the bar can render inside the Breakpoint Viewer's own
  // device-preview iframes (matching the same URL patterns as the top-level page) — but that
  // also means any small embedded same-origin iframe on a normal page (a widget, an SSO frame)
  // matches too. Skipping tiny frames is a cheap guard: every real device preset we offer is
  // well above this size, while incidental embedded widgets rarely are.
  if (window.self !== window.top && (window.innerWidth < 250 || window.innerHeight < 150)) return;
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    return;
  }

  state.t = await window.QTS_I18N.load();
  state.workspace = await getWorkspace();
  state.httpErrors = loadHttpErrorsFromSession();
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
  if (message?.type === "qts:context-action") {
    if (state.authorized) handleContextAction(message.action);
    sendResponse({ handled: state.authorized === true });
    return undefined;
  }
  return undefined;
});

void boot();
