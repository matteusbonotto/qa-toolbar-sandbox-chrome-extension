const { getWorkspace, getSiteScope, saveWorkspace, onStorageChanged, STORAGE_KEYS } = window.QTS_STORAGE;
const ICON = window.QTS_ICONS.svg;

// The real measured height of #bar with its actual content (buttons, #currentUrl) plus a tight
// 2px top/bottom padding - founder feedback: the old fixed 48px box centered that same content
// with ~11px of empty space above and below it, reading as unnecessarily thick. CSS below uses
// min-height (not height) so a locale whose button labels run longer never gets clipped; this
// constant is the *measured* real-world value for that CSS at today's content (confirmed against
// the real-Chrome smoke test), used everywhere else that needs the bar's height in JS (spacer,
// marker placement floor, header-offset math) since those can't just ask the DOM before it exists.
const TOOLBAR_HEIGHT = 37;
// Matches #bar's fixed `width:58px` when docked left/right (see the <style> block in render()) -
// the horizontal equivalent of TOOLBAR_HEIGHT for push-mode math on a vertical dock.
const VERTICAL_TOOLBAR_WIDTH = 58;
const HOST_ID = "qts-toolbar-host";
const SPACER_ID = "qts-toolbar-spacer";
const IS_TEST_BUILD = chrome.runtime.getManifest().name.includes("[TESTE]");

// Preset data (nine color families with light and dark variants) lives in lib/theme-presets-content.js, shared
// with options.js so both surfaces read the exact same source instead of two data sets drifting.
const THEME_PRESETS = window.QTS_THEME_PRESETS.presets;
const COLOR_THEME_SEMANTICS = window.QTS_THEME_PRESETS.semantics;

// Sets the chosen preset's tokens on <html> (not the shadow host) so both the shadow-DOM toolbar/
// drawers/toasts AND the light-DOM overlays that live directly in the page (Key View, mouse view --
// see ensureKeyViewOverlay/ensureMouseViewOverlay, which append to document.body, not shadowRoot) can
// both read the same custom properties through normal inheritance. Custom properties aren't reset by
// the shadow host's `all: initial` (only the `all` shorthand's non-custom longhands are), so this one
// :root write reaches every consumer. No preset selected -> remove the properties and let each CSS
// rule's own `var(--qts-ui-primary, #b20808)`-style fallback reproduce today's exact default look.
function applyColorTheme() {
  const preset = THEME_PRESETS.find((item) => item.id === state.workspace?.preferences?.colorTheme);
  const root = document.documentElement.style;
  const semantics = COLOR_THEME_SEMANTICS[preset?.mode || "dark"];
  const tokens = preset ? {
    "--qts-ui-primary": preset.primary,
    "--qts-ui-primary-contrast": preset.primaryContrast,
    "--qts-ui-highlight": preset.primary,
    "--qts-ui-secondary": preset.secondary || semantics.secondary,
    "--qts-ui-success": preset.success || semantics.success,
    "--qts-ui-warning": preset.warning || semantics.warning,
    "--qts-ui-danger": preset.danger || semantics.danger,
    "--qts-ui-info": preset.info || semantics.info,
  } : null;
  const keys = ["--qts-ui-primary", "--qts-ui-primary-contrast", "--qts-ui-highlight", "--qts-ui-secondary", "--qts-ui-success", "--qts-ui-warning", "--qts-ui-danger", "--qts-ui-info"];
  for (const key of keys) { if (tokens?.[key]) root.setProperty(key, tokens[key]); else root.removeProperty(key); }
}

const state = {
  workspace: null,
  siteScope: null,
  detachedToolKey: new URL(window.location.href).searchParams.get("qtsDetachedTool") || "",
  environment: null,
  minimized: false,
  shadowRoot: null,
  placementMode: null, // null | "pass" | "fail" | "shape"
  minimizedDrawer: null,
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
  stepsRecording: null,
  testSession: null, // null | { startedAt, context, statusPicks: [], evidenceCount, httpErrorsAtStart }
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
    heldKeys: new Map(), // event.code -> display label, while physically down
    keyRepeat: { signature: null, count: 0, resetTimer: null },
    mouseRepeat: { action: null, count: 0, resetTimer: null },
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

// A small preview of what the option looks like (a highlighted edge on a little rectangle)
// instead of a plain word - matches the equivalent picker in options.js (positionPickerIcon),
// just smaller since this one lives inside a drawer header among other icon-only buttons.
function drawerPositionIcon(side) {
  const x = 1, y = 1, w = 14, h = 10, thickness = 3.2;
  const strip = side === "top" ? `x="${x}" y="${y}" width="${w}" height="${thickness}"`
    : side === "bottom" ? `x="${x}" y="${y + h - thickness}" width="${w}" height="${thickness}"`
      : side === "left" ? `x="${x}" y="${y}" width="${thickness}" height="${h}"`
        : `x="${x + w - thickness}" y="${y}" width="${thickness}" height="${h}"`;
  return `<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".5"></rect><rect ${strip} rx=".8" fill="currentColor"></rect></svg>`;
}

// These list views rebuild body.innerHTML from scratch on every search keystroke, which destroys
// and recreates the <input> element - without this, focus (and the caret) is lost after each
// character, forcing the user to click back into the field to type the next one.
function captureListFocus(body) {
  const active = state.shadowRoot?.activeElement;
  if (!active || !body?.contains(active)) return null;
  return { id: active.id, selStart: active.selectionStart, selEnd: active.selectionEnd };
}

function restoreListFocus(body, focus) {
  if (!focus?.id) return;
  const restored = body.querySelector(`#${focus.id}`);
  if (!restored) return;
  restored.focus();
  if (typeof focus.selStart === "number" && restored.setSelectionRange) {
    try { restored.setSelectionRange(focus.selStart, focus.selEnd); } catch { /* not a text-selectable input */ }
  }
}

function urlPathFor(rawUrl) {
  try { return new URL(rawUrl).pathname || rawUrl; } catch { return rawUrl || "-"; }
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
// why) - matching now goes through the binding that owns the concrete pattern, then resolves
// product/project/client from *that* binding's productId. The returned object keeps the same
// shape every existing consumer (buildBreadcrumb, resolveEnvironmentUrl, test account/payment
// filters) already expects - id/name/color plus computed productId/projectId/clientId/
// urlPatterns/primaryUrl - so only this function and the active-binding-aware filters below need
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

function pushSiteContentEnabled() {
  return !state.minimized && state.workspace?.preferences?.pushSiteContent !== false;
}

function getCurrentHeight() {
  if (!pushSiteContentEnabled()) return 0;
  const position = effectiveToolbarPosition();
  return position === "top" || position === "bottom" ? TOOLBAR_HEIGHT : 0;
}

function getCurrentPushWidth() {
  if (!pushSiteContentEnabled()) return 0;
  const position = effectiveToolbarPosition();
  return position === "left" || position === "right" ? VERTICAL_TOOLBAR_WIDTH : 0;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 560px)").matches;
}

function effectiveToolbarPosition() {
  const preferences = state.workspace?.preferences || {};
  return isMobileViewport() ? (preferences.mobileToolbarPosition || "top") : (preferences.toolbarPosition || "top");
}

function effectiveDrawerPosition() {
  const preferences = state.workspace?.preferences || {};
  return isMobileViewport() ? (preferences.mobileDrawerPosition || "bottom") : (preferences.drawerPosition || "right");
}

function setSpacerHeight() {
  document.documentElement.style.setProperty("--qts-toolbar-height", `${getCurrentHeight()}px`);
  if (!document.body) return;
  const position = effectiveToolbarPosition();
  // A spacer as the *first* child of body pushes content down (top dock); as the *last* child it
  // only grows the document so content isn't hidden behind a bottom-fixed bar when you scroll all
  // the way down. Left/right docks can't push via a block spacer at all (block layout doesn't
  // reflow horizontally around a sibling's width) - those push via body margin instead, below.
  const spacer = document.getElementById(SPACER_ID);
  if (spacer) {
    if (position === "bottom") {
      if (document.body.lastElementChild !== spacer) document.body.appendChild(spacer);
    } else if (document.body.firstChild !== spacer) {
      document.body.insertBefore(spacer, document.body.firstChild);
    }
  }
  const pushWidth = getCurrentPushWidth();
  document.body.style.marginLeft = position === "left" && pushWidth ? `${pushWidth}px` : "";
  document.body.style.marginRight = position === "right" && pushWidth ? `${pushWidth}px` : "";
}

const HEADER_OFFSET_ATTR = "data-qts-header-offset";
// Above this, a site header's own z-index is fighting our bar for the top stacking slot instead
// of just sitting fixed at its natural position - matches tampermonkey.js's threshold
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
 * for a fixed element that already declares its own `top`), and - separately, see
 * installHeaderOffsetMonitor() - re-runs continuously instead of only on toolbar render.
 */
function offsetSiteFixedHeaders() {
  // The monitor below watches style/class mutations to catch a site header that moves or
  // appears after our last render - but this function itself mutates style/class on matching
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
    // Our own light-DOM overlays (Pixel Perfect's crosshair/measure line, Holofote's spotlight,
    // markers/notes/shapes/lines...) are also position:fixed and can sit close to the top of the
    // viewport, which made this scanner mistake them for a site header fighting for the same
    // space and start rewriting their top/z-index -- fighting with these tools' own positioning
    // logic instead of a real host-page header. None of them are ever the thing this offset exists
    // to fix, so they're excluded outright.
    if (element.closest(".qts-floating-item")) return;
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

// Wildcard urlPatterns (e.g. "https://*.example.com/*") aren't real navigable addresses - this
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
 * form the main sequence - but preferences.breadcrumbOrder can move Client into the main
 * sequence too (it only stays in the corner slot when it's first in that order), each entity
 * rendering as a logo image, or - when no logo is set - an auto-generated colored initials
 * badge, so a brand-new client/project/product is never a blank space. Per-entity `showLabel`
 * controls whether the name is spelled out next to the badge. Each visible tier is
 * independently toggleable via preferences.breadcrumbVisibility, and (when the environment
 * resolves to a real URL) clickable to jump back to it - wired via event delegation in
 * buildShadowHost(), since this only ever returns markup, not listeners.
 */
const CRUMB_TOOLTIP_KEYS = { client: "crumbTooltipClient", project: "crumbTooltipProject", product: "crumbTooltipProduct", environment: "crumbTooltipEnvironment" };

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
  // A layperson landing on this bar for the first time has no way to know what these four words
  // mean in this product specifically (they're generic business terms otherwise) - a native title
  // tooltip on hover explains each one right where it's actually used, instead of only in a help
  // doc nobody reads before their first click.
  const badge = (key, size, maxChars) => {
    const tooltip = escapeHtml(state.t[CRUMB_TOOLTIP_KEYS[key]] || "");
    if (key === "environment") return wrapCrumb(`<strong class="qts-environment-name" title="${tooltip}">${escapeHtml(environment.name)}</strong>`);
    const entity = entityFor[key];
    if (!entity) return "";
    return wrapCrumb(`<span class="qts-crumb-tooltip" title="${tooltip}">${window.QTS_AVATAR.buildEntityHtml({ ...entity, showLabel: compactEntities[key] === true ? false : entity.showLabel !== false }, { size, maxChars })}</span>`);
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

// Sound effects (SOUND_FILES/playSound) now live in lib/sound-content.js, shared with the
// options page's Tutorial panel. Thin wrapper keeps every existing call site in this file
// (playSound(key)) unchanged, implicitly passing the toolbar's current workspace for the
// preferences.soundEffects check.
function playSound(key) {
  window.QTS_SOUND.playSound(key, state.workspace);
}

// Tools gated by the account's plan (via access-status' `features` map), on top of the
// per-user "which menu items are enabled" preference. Keys here match the Supabase
// `features.key` rows exactly (see supabase/migrations/20260717080000_new_qa_tools_feature_flags.sql).
const PLAN_GATED_TOOLS = Object.fromEntries(window.QTS_STORAGE.FEATURE_REGISTRY.filter((feature) => feature.planFeature).map((feature) => [feature.key, feature.planFeature]));

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

const TOOLS_MENU_ITEM_IDS = Object.fromEntries(window.QTS_STORAGE.FEATURE_REGISTRY.map((feature) => [feature.key, feature.menuItemId]));
const TOOLS_MENU_LABELS = Object.fromEntries(window.QTS_STORAGE.FEATURE_REGISTRY.map((feature) => [feature.key, feature.label]));
const TOOLS_MENU_ITEM_KEY_BY_ID = Object.fromEntries(Object.entries(TOOLS_MENU_ITEM_IDS).map(([key, id]) => [id, key]));

function customShortcutFromEvent(event) {
  const key = event.key.length === 1 ? event.key.toLocaleUpperCase() : event.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  return [...parts, key].join("+");
}

function handleCustomToolShortcut(event) {
  if (event.defaultPrevented || editableTypingTarget(event.target) || isKeyViewOwnSurface(event)) return;
  const shortcut = customShortcutFromEvent(event);
  if (!shortcut) return;
  const entry = Object.entries(state.workspace?.preferences?.customShortcuts || {}).find(([, value]) => value === shortcut);
  if (!entry) return;
  const [toolKey] = entry;
  const menuId = TOOLS_MENU_ITEM_IDS[toolKey];
  const menuItem = state.shadowRoot?.getElementById(menuId);
  if (!menuItem || menuItem.classList.contains("isPreferenceHidden")) return;
  event.preventDefault();
  menuItem.click();
}

// "Mais usados" sort needs a click count per tool; recorded on every menu-item activation
// regardless of the active sort mode (so switching into "mais usados" later already has real
// history instead of starting from zero) but only triggers a re-render when that count could
// actually change what's currently visible.
async function recordToolMenuUsage(key) {
  if (!key) return;
  const counts = { ...(state.workspace.preferences.toolUsageCounts || {}) };
  counts[key] = (counts[key] || 0) + 1;
  state.workspace.preferences = { ...state.workspace.preferences, toolUsageCounts: counts };
  state.workspace = await saveWorkspace(state.workspace);
  if (state.workspace.preferences.toolsSortMode === "mostUsed") applyPinnedTools();
}

function sortedToolsMenuOrder(baseOrder) {
  const preferences = state.workspace?.preferences || {};
  const mode = preferences.toolsSortMode || "custom";
  if (mode === "custom") return baseOrder;
  if (mode === "az" || mode === "za") {
    const collator = new Intl.Collator(preferences.language || "pt-BR", { sensitivity: "base" });
    const sorted = [...baseOrder].sort((a, b) => collator.compare(TOOLS_MENU_LABELS[a] || a, TOOLS_MENU_LABELS[b] || b));
    return mode === "za" ? sorted.reverse() : sorted;
  }
  if (mode === "mostUsed") {
    const counts = preferences.toolUsageCounts || {};
    const originalIndex = new Map(baseOrder.map((key, index) => [key, index]));
    return [...baseOrder].sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || originalIndex.get(a) - originalIndex.get(b));
  }
  return baseOrder;
}

function applyPinnedTools() {
  const root = state.shadowRoot;
  if (!root) return;
  const pinned = [...new Set(state.workspace?.preferences?.pinnedTools || [])].slice(0, 4);
  const enabledTools = new Set(state.workspace?.preferences?.enabledTools || window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS);
  ["passButton", "failButton", "screenshotButton", "recordToggleButton"].forEach((id) => root.getElementById(id)?.classList.remove("isPreferenceHidden"));
  ["testStatusButton", "noteButton", "shapeWrapper", "blurQuickButton", "holofoteQuickButton"].forEach((id) => root.getElementById(id)?.classList.add("isPreferenceHidden"));
  const menuItems = TOOLS_MENU_ITEM_IDS;
  for (const [key, id] of Object.entries(menuItems)) {
    const element = root.getElementById(id);
    if (!element) continue;
    const preferenceHidden = !enabledTools.has(key);
    element.classList.toggle("isPreferenceHidden", preferenceHidden);
    // A plan-gated tool the user still wants in their menu (enabledTools) stays visible but
    // locked, so "why isn't this here" reads as "not on my plan" instead of looking like a
    // vanished/broken feature -- see requirePlanFeature() for the click-time toast.
    const planLocked = !preferenceHidden && !hasPlanFeature(key);
    element.classList.toggle("isPlanLocked", planLocked);
    element.setAttribute("aria-disabled", String(planLocked));
    let lockBadge = element.querySelector(".qts-lock-badge");
    if (planLocked && !lockBadge) {
      lockBadge = document.createElement("span");
      lockBadge.className = "qts-lock-badge";
      lockBadge.innerHTML = ICON("lock");
      element.appendChild(lockBadge);
    } else if (!planLocked && lockBadge) {
      lockBadge.remove();
    }
  }
  const labels = TOOLS_MENU_LABELS;
  const icons = Object.fromEntries(window.QTS_STORAGE.FEATURE_REGISTRY.map((feature) => [feature.key, feature.icon]));
  const quickContainer = root.getElementById("extraPinnedTools");
  if (quickContainer) {
    // Small pin badge in the corner distinguishes a tool the user chose to pin from the fixed
    // default shortcuts (Pass/Fail/Screenshot/Gravação, which always show and never carry it) --
    // otherwise both look identical and there's no visual cue which ones are user customization.
    quickContainer.innerHTML = pinned.filter((key) => menuItems[key] && enabledTools.has(key) && hasPlanFeature(key)).map((key) => `<button class="iconOnly qts-user-pinned" type="button" data-pinned-tool="${escapeHtml(key)}" title="${escapeHtml(labels[key] || key)}" aria-label="${escapeHtml(labels[key] || key)}">${ICON(icons[key] || "pin")}<span class="qts-pin-badge">${ICON("pin")}</span></button>`).join("");
    quickContainer.querySelectorAll("[data-pinned-tool]").forEach((button) => button.addEventListener("click", () => root.getElementById(menuItems[button.dataset.pinnedTool])?.click()));
    renderMinimizedDrawerShortcut();
  }
  // Re-append each menu item in the effective order -- appendChild on an already-attached node
  // *moves* it, so iterating in order and re-appending sequentially reorders the whole menu
  // without rebuilding it. #pinnedMacrosMenu (a separate, dynamically rendered list of pinned
  // macros) is intentionally left alone at the top. The base order is always the founder's
  // manually dragged preferences.toolsMenuOrder; A-Z/Z-A/"mais usados" (preferences.toolsSortMode)
  // are a display-time re-sort of that same list, so switching back to "Personalizado" instantly
  // restores the exact manual order without losing it.
  const menu = root.getElementById("toolsMenu");
  const toolsMenuOrder = state.workspace?.preferences?.toolsMenuOrder || window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS;
  const effectiveOrder = sortedToolsMenuOrder(toolsMenuOrder);
  if (menu) for (const key of effectiveOrder) { const item = menuItems[key] && root.getElementById(menuItems[key]); if (item) menu.appendChild(item); }
  renderPinnedMacros();
}

function render() {
  const host = document.getElementById(HOST_ID);
  if (host) {
    host.dataset.theme = state.workspace?.preferences?.appearanceTheme || "system";
    host.dataset.toolbarPosition = effectiveToolbarPosition();
    host.dataset.detachedWindow = String(Boolean(state.detachedToolKey));
  }
  applyColorTheme();
  const root = state.shadowRoot;
  if (!root) return;

  const breadcrumb = buildBreadcrumb(state.workspace, state.environment);
  const bar = root.getElementById("bar");
  bar.style.setProperty("--qts-bg", breadcrumb.color);
  bar.style.setProperty("--qts-text", breadcrumb.text);
  bar.classList.toggle("isMinimized", state.minimized);
  bar.classList.toggle("isLoggedOut", !state.authorized);
  const toolbarPosition = effectiveToolbarPosition();
  const minimizeIcon = { top: "chevronUp", bottom: "chevronDown", left: "chevronLeft", right: "chevronRight" }[toolbarPosition];
  const restoreIcon = { top: "chevronDown", bottom: "chevronUp", left: "chevronRight", right: "chevronLeft" }[toolbarPosition];
  root.getElementById("minimizeButton").innerHTML = ICON(minimizeIcon);
  root.getElementById("restoreButton").innerHTML = ICON(restoreIcon);
  root.getElementById("restoreButton").classList.toggle("isVisible", state.minimized);
  if (!state.authorized) { setSpacerHeight(); offsetSiteFixedHeaders(); return; }

  const clientLabel = root.getElementById("clientLabel");
  clientLabel.innerHTML = breadcrumb.clientHtml;
  clientLabel.classList.toggle("isHidden", !breadcrumb.clientHtml);
  root.getElementById("breadcrumb").innerHTML = breadcrumb.mainHtml;
  const currentUrl = safeCurrentUrl();
  const urlElement = root.getElementById("currentUrl");
  urlElement.textContent = currentUrl;
  urlElement.title = currentUrl;
  const verticalUrlText = root.getElementById("verticalUrlText");
  if (verticalUrlText) verticalUrlText.textContent = currentUrl;
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
  host.dataset.theme = state.workspace?.preferences?.appearanceTheme || "system";
  host.dataset.toolbarPosition = effectiveToolbarPosition();
  host.dataset.detachedWindow = String(Boolean(state.detachedToolKey));
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; --qts-ui-surface:#0c0c0c; --qts-ui-surface-2:#171717; --qts-ui-border:#343434; --qts-ui-text:#fff; --qts-ui-muted:#aaa; --qts-ui-shadow:rgba(0,0,0,.48); }
      :host([data-theme="light"]) { --qts-ui-surface:#fff; --qts-ui-surface-2:#f0f3f8; --qts-ui-border:#b8c2d3; --qts-ui-text:#171a24; --qts-ui-muted:#58647a; --qts-ui-shadow:rgba(30,43,67,.22); }
      @media (prefers-color-scheme:light) { :host([data-theme="system"]) { --qts-ui-surface:#fff; --qts-ui-surface-2:#f0f3f8; --qts-ui-border:#b8c2d3; --qts-ui-text:#171a24; --qts-ui-muted:#58647a; --qts-ui-shadow:rgba(30,43,67,.22); } }
      * { box-sizing: border-box; }
      input[type="checkbox"], input[type="radio"] { accent-color: var(--qts-ui-primary, #ef3340); }
      #bar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
        min-height: ${TOOLBAR_HEIGHT}px; display: flex; align-items: center; justify-content: space-between;
        gap: 10px; padding: 2px 12px; background: var(--qts-bg, #ef3340); color: var(--qts-text, #fff);
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 2px 10px rgba(0,0,0,.25); transition: transform 160ms ease;
      }
      #bar.isMinimized { transform: translateY(-110%); }
      :host([data-toolbar-position="bottom"]) #bar { top:auto; bottom:0; }
      :host([data-toolbar-position="bottom"]) #bar.isMinimized { transform:translateY(110%); }
      :host([data-toolbar-position="left"]) #bar,
      :host([data-toolbar-position="right"]) #bar {
        top:0; bottom:0; width:58px; min-height:100vh; right:auto; padding:8px 7px;
        flex-direction:column; justify-content:flex-start; overflow:visible;
      }
      :host([data-toolbar-position="right"]) #bar { left:auto; right:0; }
      :host([data-toolbar-position="left"]) #bar.isMinimized { transform:translateX(-110%); }
      :host([data-toolbar-position="right"]) #bar.isMinimized { transform:translateX(110%); }
      :host([data-toolbar-position="left"]) #left,
      :host([data-toolbar-position="right"]) #left { display:none; }
      :host([data-toolbar-position="left"]) #right,
      :host([data-toolbar-position="right"]) #right,
      :host([data-toolbar-position="left"]) #extraPinnedTools,
      :host([data-toolbar-position="right"]) #extraPinnedTools { flex-direction:column; width:100%; }
      :host([data-toolbar-position="left"]) #right,
      :host([data-toolbar-position="right"]) #right { align-items:center; }
      :host([data-toolbar-position="left"]) #right > *,
      :host([data-toolbar-position="right"]) #right > * { flex:0 0 auto; margin-inline:auto; }
      :host([data-toolbar-position="left"]) #right button,
      :host([data-toolbar-position="right"]) #right button { width:38px; min-width:38px; height:30px; padding:5px; overflow:visible; }
      :host([data-toolbar-position="left"]) #minimizeButton,
      :host([data-toolbar-position="right"]) #minimizeButton { order:-1; }
      :host([data-toolbar-position="left"]) #testStatusButton,
      :host([data-toolbar-position="right"]) #testStatusButton { font-size:0; }
      :host([data-toolbar-position="left"]) #testStatusButton::before,
      :host([data-toolbar-position="right"]) #testStatusButton::before { content:"✓"; font-size:14px; }
      :host([data-toolbar-position="left"]) #toolsButton,
      :host([data-toolbar-position="right"]) #toolsButton { font-size:0; justify-content:center; }
      :host([data-toolbar-position="left"]) #toolsButton svg,
      :host([data-toolbar-position="right"]) #toolsButton svg { display:block; margin:auto; }
      :host([data-toolbar-position="left"]) #toolsButton::before,
      :host([data-toolbar-position="right"]) #toolsButton::before { content:none; }
      :host([data-toolbar-position="left"]) #toolsMenu,
      :host([data-toolbar-position="right"]) #toolsMenu {
        position:fixed; top:8px; bottom:auto; width:min(278px,calc(100vw - 78px));
        max-height:min(320px,calc(100vh - 16px)); transform:translateX(-6px); scrollbar-gutter:auto;
      }
      :host([data-toolbar-position="left"]) #toolsMenu { left:66px; right:auto; }
      :host([data-toolbar-position="right"]) #toolsMenu { left:auto; right:66px; }
      #urlToggleWrapper { display:none; position:relative; }
      :host([data-toolbar-position="left"]) #urlToggleWrapper,
      :host([data-toolbar-position="right"]) #urlToggleWrapper { display:block; }
      :host([data-toolbar-position="left"]) #urlToggleButton,
      :host([data-toolbar-position="right"]) #urlToggleButton {
        width:38px; min-width:38px; max-width:38px; height:38px; min-height:38px; aspect-ratio:1; flex:0 0 38px; box-sizing:border-box; padding:0; border-radius:50%; justify-content:center;
        background:color-mix(in srgb,var(--qts-ui-primary,#2563eb) 24%,rgba(0,0,0,.22));
      }
      #verticalUrlPanel {
        position:fixed; top:8px; width:min(430px,calc(100vw - 82px)); padding:10px;
        display:flex; align-items:center; gap:8px; border:1px solid var(--qts-ui-border);
        border-radius:12px; background:var(--qts-ui-surface); color:var(--qts-ui-text);
        box-shadow:0 16px 40px var(--qts-ui-shadow); z-index:20;
      }
      :host([data-toolbar-position="left"]) #verticalUrlPanel { left:68px; }
      :host([data-toolbar-position="right"]) #verticalUrlPanel { right:68px; }
      #verticalUrlText { min-width:0; flex:1; overflow-wrap:anywhere; font:650 11px/1.45 ui-monospace,Consolas,monospace; }
      #verticalUrlCopy { width:34px !important; min-width:34px !important; height:34px !important; padding:0 !important; justify-content:center; }
      :host([data-toolbar-position="left"]) #toolsMenu.isOpen,
      :host([data-toolbar-position="right"]) #toolsMenu.isOpen { transform:translateX(0); }
      :host([data-toolbar-position="left"]) .qts-bell-badge,
      :host([data-toolbar-position="right"]) .qts-bell-badge {
        top:-3px; right:-3px; min-width:13px; width:auto; height:13px; padding:0 3px; font-size:8px;
      }
      :host([data-toolbar-position="left"]) #notificationBellPanel,
      :host([data-toolbar-position="right"]) #notificationBellPanel {
        position:fixed; top:8px; width:min(300px,calc(100vw - 70px)); max-height:calc(100vh - 16px);
      }
      :host([data-toolbar-position="left"]) #notificationBellPanel { left:60px; right:auto; }
      :host([data-toolbar-position="right"]) #notificationBellPanel { left:auto; right:60px; }
      :host([data-toolbar-position="left"]) #notificationBellPanel .qts-bell-row,
      :host([data-toolbar-position="right"]) #notificationBellPanel .qts-bell-row {
        width:100%; min-width:0; height:auto; padding:7px; overflow:visible; white-space:normal;
      }
      :host([data-toolbar-position="left"]) #notificationBellPanel .qts-bell-head button,
      :host([data-toolbar-position="right"]) #notificationBellPanel .qts-bell-head button {
        width:auto; min-width:0; height:auto; padding:0; overflow:visible;
      }
      :host([data-toolbar-position="left"]) :is(#shapeTypeMenu,#markerTypeMenu,#recordTypeMenu,#macroRecHistoryPanel,#stepsRecHistoryPanel),
      :host([data-toolbar-position="right"]) :is(#shapeTypeMenu,#markerTypeMenu,#recordTypeMenu,#macroRecHistoryPanel,#stepsRecHistoryPanel) {
        position:fixed; top:8px; width:min(260px,calc(100vw - 70px)); max-height:calc(100vh - 16px); overflow:auto;
      }
      :host([data-toolbar-position="left"]) :is(#shapeTypeMenu,#markerTypeMenu,#recordTypeMenu,#macroRecHistoryPanel,#stepsRecHistoryPanel) { left:60px; right:auto; }
      :host([data-toolbar-position="right"]) :is(#shapeTypeMenu,#markerTypeMenu,#recordTypeMenu,#macroRecHistoryPanel,#stepsRecHistoryPanel) { left:auto; right:60px; }
      :host([data-detached-window="true"]) #bar,
      :host([data-detached-window="true"]) #restoreButton { display:none !important; }
      /* Logged-out mode: the bar still mounts (so a URL the user configured never goes silent
         about why nothing appeared), but every functional button is hidden except Settings/
         Minimize -- only the message + login CTA below show. See render()/refreshAuthorization. */
      #loggedOutPanel { display: none; align-items: center; gap: 8px; }
      #bar.isLoggedOut #loggedOutPanel { display: flex; }
      #bar.isLoggedOut #right > *:not(#loggedOutPanel):not(#settingsButton):not(#minimizeButton) { display: none !important; }
      #loggedOutMessage { font-size: 11px; font-weight: 800; white-space: nowrap; }
      #loggedOutLoginButton { background: var(--qts-ui-primary, #ffd700); color: var(--qts-ui-primary-contrast, #111); border-color: #fff; }
      #left { min-width: 0; flex: 1 1 auto; height: 100%; display: flex; flex-direction: row; align-items: center; gap: 8px; }
      #right { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 0 0 auto; }
      #extraPinnedTools { display: flex; align-items: center; gap: 6px; }
      #textStack { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 1px; }
      #breadcrumb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 28vw; display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
      .qts-crumb-sep { opacity: .55; }
      .qts-crumb-link { all: unset; cursor: pointer; display: inline-flex; align-items: center; }
      .qts-crumb-tooltip { display: inline-flex; align-items: center; cursor: help; }
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
      .qts-test-environment-badge { padding: 4px 8px; border-radius: 999px; background: #111; color: #ffd700; border: 2px solid #ffd700; font-size: 10px; letter-spacing: .06em; }
      button {
        all: unset; box-sizing: border-box; cursor: pointer; height: 24px; padding: 0 9px;
        display: inline-flex; align-items: center; gap: 5px; border-radius: 7px;
        background: rgba(0,0,0,.2); color: inherit; font: inherit; font-size: 11px; font-weight: 800;
        border: 1px solid rgba(255,255,255,.35); white-space: nowrap;
      }
      button:hover { background: rgba(0,0,0,.32); }
      button.iconOnly { width: 26px; padding: 0; justify-content: center; }
      button > svg { width:17px; height:17px; filter:drop-shadow(0 0 .35px currentColor); }
      .qts-user-pinned { position: relative; }
      .qts-pin-badge {
        position: absolute; top: -3px; right: -3px; width: 11px; height: 11px; border-radius: 50%;
        background: var(--qts-ui-primary, #ffd700); border: 1px solid #171717; display: flex; align-items: center; justify-content: center;
      }
      .qts-pin-badge svg { width: 7px; height: 7px; fill: #171717; }
      button.isActive { background: var(--qts-ui-primary, #ffd700) !important; color: var(--qts-ui-primary-contrast, #111) !important; border-color: #fff !important; }
      #clearAllButton.isHidden, .isHidden, .isPreferenceHidden { display: none !important; }
      #recordToggleButton.isActive { background: #c70e0e !important; color: #fff !important; border-color: #fff !important; animation: qts-rec-pulse 1.6s ease-in-out infinite; }
      #recordToggleButton.isPaused { background: var(--qts-ui-primary, #ffd700) !important; color: var(--qts-ui-primary-contrast, #111) !important; animation: none; }
      @keyframes qts-rec-pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
      #recordTimer { font-variant-numeric: tabular-nums; opacity: .9; }
      #restoreButton {
        all: unset; box-sizing: border-box; position: fixed; top: 6px; right: 8px; z-index: 2147483647;
        width: 30px; height: 26px; display: none; align-items: center; justify-content: center;
        border: 1px solid color-mix(in srgb, var(--qts-ui-primary, #ffd700) 55%, transparent); border-radius: 9px; background: #0b0b0b; color: var(--qts-ui-primary, #ffd700);
        font: 900 13px sans-serif; cursor: pointer; box-shadow: 0 8px 18px rgba(0,0,0,.34);
      }
      #restoreButton.isVisible { display: inline-flex; }
      :host([data-toolbar-position="bottom"]) #restoreButton { top:auto; bottom:6px; }
      :host([data-toolbar-position="left"]) #restoreButton { top:8px; right:auto; left:6px; }
      :host([data-toolbar-position="right"]) #restoreButton { top:8px; right:6px; }
      #toolsWrapper { position: relative; }
      #toolsMenu {
        position: absolute; top: 30px; right: 0; width: 260px; padding: 7px; display: grid; gap: 5px;
        max-height: 320px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable;
        border-radius: 10px; background: #0c0c0c; border: 1px solid rgba(255,255,255,.18);
        box-shadow: 0 16px 40px rgba(0,0,0,.45); opacity: 0; visibility: hidden; transform: translateY(-6px);
        transition: opacity 140ms ease, transform 140ms ease, visibility 140ms; color: #fff; z-index: 10;
      }
      #toolsMenu.isOpen { opacity: 1; visibility: visible; transform: translateY(0); }
      :host([data-toolbar-position="bottom"]) #toolsMenu {
        top:auto; bottom:30px; transform:translateY(6px);
      }
      :host([data-toolbar-position="bottom"]) #toolsMenu.isOpen { transform:translateY(0); }
      :host([data-toolbar-position="bottom"]) :is(#notificationBellPanel,#shapeTypeMenu,#markerTypeMenu,#recordTypeMenu,#macroRecHistoryPanel,#stepsRecHistoryPanel) {
        top:auto; bottom:30px;
      }
      #toolsMenu::-webkit-scrollbar { width: 9px; }
      #toolsMenu::-webkit-scrollbar-thumb { background: color-mix(in srgb,var(--qts-ui-primary,#2563eb) 64%,transparent); border:2px solid transparent; border-radius:99px; background-clip:padding-box; }
      #toolsMenu button {
        box-sizing:border-box !important; width:100% !important; min-width:100% !important; max-width:100% !important;
        height:34px; justify-content:flex-start !important; gap:9px; padding:0 9px;
        background: #171717; border-color: #2c2c2c; font-size: 12px;
      }
      #toolsMenu button > svg {
        width:19px; height:19px; flex:0 0 19px; padding:2px; border-radius:5px;
        color:var(--qts-ui-primary,#2563eb); background:color-mix(in srgb,var(--qts-ui-primary,#2563eb) 14%,transparent);
      }
      #toolsMenu button:hover { background: #232323; border-color: var(--qts-ui-primary, #ffd700); }
      #toolsMenu button.isActive { background: var(--qts-ui-primary, #ffd700) !important; color: var(--qts-ui-primary-contrast, #111) !important; }
      .qts-badge { margin-left: auto; padding: 1px 6px; border-radius: 999px; background: var(--qts-ui-primary, #b20808); color: var(--qts-ui-primary-contrast, #fff); font-size: 9px; }
      #toolsMenu button.isPlanLocked { opacity: .5; }
      #toolsMenu button.isPlanLocked:hover { background: #171717; border-color: #2c2c2c; }
      .qts-lock-badge { margin-left: auto; display: inline-flex; }
      .qts-lock-badge svg { width: 13px !important; height: 13px !important; padding: 0 !important; background: none !important; color: inherit !important; }
      #settingsButton { position: relative; }
      .qts-tutorial-dot { position: absolute; top: 3px; right: 3px; width: 8px; height: 8px; border-radius: 50%; background: #42d5c2; box-shadow: 0 0 0 2px #171717; }
      #macroRecordingBar { position: relative; display: flex; align-items: center; gap: 3px; padding: 3px; border-radius: 9px; background: #8f0909; border: 1px solid #fff; animation: qts-rec-pulse 1.3s ease-in-out infinite; }
      #macroRecordingBar.isPaused { background: #7a5b00; animation: none; }
      #stepsRecordingBar { position: relative; display: flex; align-items: center; gap: 3px; padding: 3px; border-radius: 9px; background: #8f0909; border: 1px solid #fff; animation: qts-rec-pulse 1.3s ease-in-out infinite; }
      #stepsRecordingBar.isPaused { background: #7a5b00; animation: none; }
      #testSessionBar { display: flex; align-items: center; gap: 3px; padding: 3px; border-radius: 9px; background: var(--qts-ui-primary, #2563eb); border: 1px solid #fff; }
      #testSessionBar button { color: var(--qts-ui-primary-contrast, #fff); }
      #testSessionElapsed { font-variant-numeric: tabular-nums; }
      #macroRecHistoryPanel { position: absolute; top: 30px; right: 0; width: 260px; max-height: 260px; overflow: auto; padding: 6px; display: grid; gap: 4px; border-radius: 10px; background: #0c0c0c; border: 1px solid rgba(255,255,255,.18); box-shadow: 0 16px 40px rgba(0,0,0,.45); z-index: 10; }
      .qts-macro-hist-row { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 6px; background: #171717; font-size: 11px; color: #fff; }
      .qts-macro-hist-row span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .qts-macro-hist-row button { all: unset; cursor: pointer; color: #ff7078; font-weight: 800; padding: 0 4px; }
      .qts-macro-hist-result { margin-left: 14px; background: transparent; color: #9fd8a8; font-style: italic; }
      .qts-mini-empty { padding: 8px; color: #999; font-size: 11px; text-align: center; }
      #notificationBellWrapper { position: relative; }
      #notificationBellButton { position: relative; }
      .qts-bell-badge { position: absolute; top: -4px; right: -4px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 999px; background: var(--qts-ui-primary, #b20808); color: var(--qts-ui-primary-contrast, #fff); font-size: 9px; font-weight: 800; display: none; align-items: center; justify-content: center; line-height: 1; }
      .qts-bell-badge.isVisible { display: flex; }
      #notificationBellPanel { position: absolute; top: 30px; right: 0; width: 300px; max-height: 320px; overflow: auto; padding: 6px; display: grid; gap: 4px; border-radius: 10px; background: #0c0c0c; border: 1px solid rgba(255,255,255,.18); box-shadow: 0 16px 40px rgba(0,0,0,.45); z-index: 10; color: #fff; }
      .qts-bell-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 4px 6px; border-bottom: 1px solid #292929; margin-bottom: 2px; }
      .qts-bell-head b { font-size: 12px; }
      .qts-bell-head button { all: unset; cursor: pointer; color: #ffb0b0; font-size: 11px; font-weight: 700; }
      .qts-bell-head button:disabled { color: #555; cursor: default; }
      .qts-bell-row { all: unset; display: block; box-sizing: border-box; width: 100%; padding: 7px; border-radius: 7px; background: #171717; cursor: pointer; font-size: 11px; }
      .qts-bell-row:hover { background: #232323; }
      .qts-bell-row span { display: -webkit-box; margin-top: 2px; overflow: hidden; overflow-wrap: anywhere; white-space: normal; color: #ddd; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-height: 1.35; max-height: 4.05em; }
      .qts-bell-row small { display: block; margin-top: 2px; color: #999; overflow-wrap: anywhere; }
      #shapeWrapper, #markerWrapper { position: relative; }
      #shapeTypeMenu, #markerTypeMenu { position: absolute; top: 30px; left: 0; width: 180px; padding: 6px; display: grid; gap: 4px; border-radius: 10px; background: #0c0c0c; border: 1px solid rgba(255,255,255,.18); box-shadow: 0 16px 40px rgba(0,0,0,.45); z-index: 10; color: #fff; }
      #shapeTypeMenu button, #markerTypeMenu button { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px; border-radius: 7px; background: #171717; border: 1px solid #2c2c2c; font-size: 12px; }
      #shapeTypeMenu button:hover, #markerTypeMenu button:hover { background: #232323; border-color: var(--qts-ui-primary, #ffd700); }
      #markerMoreButton { width: 18px !important; padding: 0 !important; }
      /* Opened from the "Desenhar forma" row inside the Tools dropdown (as opposed to the pinned
         shapeButton icon, which has its own #shapeWrapper-relative flyout above): used to just
         flow inline (position:static) as the LAST child of #toolsMenu, landing far below "Desenhar
         forma" itself at the bottom of an unrelated, much longer list -- confusing since nothing
         visually tied it back to the row that opened it. This instead flies out beside that exact
         row (top set in JS from its offsetTop within #toolsMenu), preferring the left like a
         native nested menu; .opensRight is added at open time only when there isn't enough room
         on the left of the toolbar so it doesn't get clipped off-screen. */
      #shapeTypeMenu.asToolsSubmenu { position: absolute; right: 100%; margin-right: 8px; width: 190px; }
      #shapeTypeMenu.asToolsSubmenu.opensRight { right: auto; left: 100%; margin-right: 0; margin-left: 8px; }
      #recordWrapper { position: relative; }
      #recordTypeMenu { position: absolute; top: 30px; right: 0; width: 240px; padding: 6px; display: grid; gap: 4px; border-radius: 10px; background: #0c0c0c; border: 1px solid rgba(255,255,255,.18); box-shadow: 0 16px 40px rgba(0,0,0,.45); z-index: 10; color: #fff; }
      #recordTypeMenuTitle { margin: 2px 4px 4px; font-size: 11px; font-weight: 800; color: #aaa; text-transform: uppercase; letter-spacing: .04em; }
      #recordTypeMenu button { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 2px; width: 100%; padding: 8px; border-radius: 7px; background: #171717; border: 1px solid #2c2c2c; }
      #recordTypeMenu button:hover { background: #232323; border-color: var(--qts-ui-primary, #ffd700); }
      #recordTypeMenu button strong { font-size: 12px; }
      #recordTypeMenu button span { font-size: 10px; color: #999; line-height: 1.35; }
      #recordTypeMenu button.isComingSoon { cursor: not-allowed; opacity: .55; }
      #recordTypeMenu button.isComingSoon:hover { background: #171717; border-color: #2c2c2c; }
      .qts-coming-soon-badge { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: #3a3a3a; color: var(--qts-ui-primary, #ffd700); font-size: 9px; font-weight: 800; vertical-align: middle; }
      #pinnedMacrosMenu:empty { display: none; }
      #pinnedMacrosMenu { display: grid; gap: 4px; padding-bottom: 5px; margin-bottom: 2px; border-bottom: 1px solid #292929; }
      #mobileActionsMenu { display: none; }
      /* Theme bridge for every toolbar popup.  These surfaces predate the platform theme and
         used literal dark colours, which made the "Claro" toggle appear to do nothing. */
      #toolsMenu, #shapeTypeMenu, #recordTypeMenu, #macroRecHistoryPanel, #notificationBellPanel {
        background: var(--qts-ui-surface); color: var(--qts-ui-text); border-color: var(--qts-ui-border);
        box-shadow: 0 16px 40px var(--qts-ui-shadow);
      }
      #toolsMenu button, #shapeTypeMenu button, #recordTypeMenu button,
      .qts-macro-hist-row, .qts-bell-row {
        background: var(--qts-ui-surface-2); color: var(--qts-ui-text); border-color: var(--qts-ui-border);
      }
      #toolsMenu button:hover, #shapeTypeMenu button:hover, #recordTypeMenu button:hover,
      .qts-bell-row:hover { filter: brightness(.94); border-color: var(--qts-ui-primary, #ffd700); }
      #recordTypeMenuTitle, #recordTypeMenu button span, .qts-mini-empty,
      .qts-bell-row small { color: var(--qts-ui-muted); }
      .qts-bell-row span { color: var(--qts-ui-text); }
      .qts-bell-head, #pinnedMacrosMenu { border-color: var(--qts-ui-border); }
      :host([data-theme="light"]) .qts-bell-head button { color:#9f1d29; }
      :host([data-theme="light"]) .qts-coming-soon-badge { background:#e4e8f1; color:#5637bf; }
      /* Theme every toolbar-owned popup, not just the right drawer. These surfaces used to
         retain literal black backgrounds when light mode was selected. */
      #toolsMenu, #shapeTypeMenu, #recordTypeMenu, #notificationBellPanel, #macroRecHistoryPanel,
      #stepsRecHistoryPanel { background:var(--qts-ui-surface); border-color:var(--qts-ui-border); color:var(--qts-ui-text); box-shadow:0 16px 40px var(--qts-ui-shadow); }
      #toolsMenu button, #shapeTypeMenu button, #recordTypeMenu button, .qts-bell-row,
      .qts-macro-hist-row { background:var(--qts-ui-surface-2); border-color:var(--qts-ui-border); color:var(--qts-ui-text); }
      #toolsMenu button:hover, #shapeTypeMenu button:hover, #recordTypeMenu button:hover,
      .qts-bell-row:hover { background:color-mix(in srgb,var(--qts-ui-surface-2) 72%,#7657ff); }
      #recordTypeMenuTitle, #recordTypeMenu button span, .qts-bell-row small, .qts-mini-empty { color:var(--qts-ui-muted); }
      .qts-bell-row span { color:var(--qts-ui-text); }
      /* On a real phone width, #right's pinned quick-action buttons (flex:0 0 auto, never
         shrink) add up to wider than the whole bar, which squeezes #left (breadcrumb) down to
         zero width - client/project/product don't just get cramped, they vanish entirely, and
         buttons past the overflow (settings, sometimes even Tools) get pushed off-screen with no
         way back. Below this width those pinned buttons hide and the same actions move into the
         Tools menu instead (#mobileActionsMenu), which stays reachable regardless of width. */
      @media (max-width: 560px) {
        #left { gap: 3px; overflow: hidden; }
        #textStack { flex: 1 1 auto; overflow: hidden; }
        #breadcrumb { max-width: 100%; gap: 3px; }
        #currentUrl { display: none; }
        .qts-badge-name { display: none; }
        .qts-badge-avatar { display: inline-flex !important; width: 18px !important; height: 18px !important; }
        .qts-client-label { max-width: 22px; opacity: 1; }
        .qts-client-label .qts-badge-avatar { width: 14px !important; height: 14px !important; }
        .qts-crumb-sep { font-size: 9px; }
        #testStatusButton, #passButton, #failButton, #noteButton, #shapeWrapper, #clearAllButton, #extraPinnedTools,
        #screenshotButton, #recordWrapper, #recordStopButton, #recordTimer, #blurQuickButton,
        #holofoteQuickButton { display: none !important; }
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
        ${IS_TEST_BUILD ? '<span class="qts-test-environment-badge" title="Ambiente isolado - não publicar">TESTE</span>' : ""}
      </div>
      <div id="right">
        <div id="loggedOutPanel">
          <span id="loggedOutMessage">${escapeHtml(t.loggedOutMessage || "Você não está logado")}</span>
          <button id="loggedOutLoginButton" type="button">${escapeHtml(t.loggedOutAction || "Entrar")}</button>
        </div>
        <div id="urlToggleWrapper">
          <button id="urlToggleButton" class="iconOnly" type="button" title="Exibir URL completa" aria-label="Exibir URL completa" aria-expanded="false">${ICON("globe")}</button>
          <div id="verticalUrlPanel" class="isHidden"><span id="verticalUrlText"></span><button id="verticalUrlCopy" class="iconOnly" type="button" title="Copiar URL" aria-label="Copiar URL">${ICON("copy")}</button></div>
        </div>
        <button id="testStatusButton" type="button" title="${escapeHtml(t.testStatusTitle)}">${escapeHtml(t.testStatus)}</button>
        <button id="passButton" class="iconOnly" type="button" title="${escapeHtml(t.pass)}">${ICON("pass")}</button>
        <button id="failButton" class="iconOnly" type="button" title="${escapeHtml(t.fail)}">${ICON("fail")}</button>
        <div id="markerWrapper">
          <button id="markerMoreButton" class="iconOnly" type="button" title="${escapeHtml(t.markerMore)}">${ICON("chevronDown")}</button>
          <div id="markerTypeMenu" class="isHidden" role="menu">
            <button type="button" data-marker-pick="warning" role="menuitem">${ICON("warning")} ${escapeHtml(t.markerWarning)}</button>
            <button type="button" data-marker-pick="question" role="menuitem">${ICON("question")} ${escapeHtml(t.markerQuestion)}</button>
          </div>
        </div>
        <button id="noteButton" class="iconOnly" type="button" title="${escapeHtml(t.note)}">${ICON("noteText")}</button>
        <div id="shapeWrapper">
          <button id="shapeButton" class="iconOnly" type="button" title="${escapeHtml(t.shape)}">${ICON("square")}</button>
          <div id="shapeTypeMenu" class="isHidden" role="menu">
            <button type="button" data-shape-pick="rectangle" role="menuitem">${ICON("rectangle")} ${escapeHtml(t.shapeTypeRectangle)}</button>
            <button type="button" data-shape-pick="square" role="menuitem">${ICON("square")} ${escapeHtml(t.shapeTypeSquare)}</button>
            <button type="button" data-shape-pick="circle" role="menuitem">${ICON("circle")} ${escapeHtml(t.shapeTypeCircle)}</button>
            <button type="button" data-shape-pick="line" role="menuitem">${ICON("arrowLeft")} ${escapeHtml(t.line)}</button>
          </div>
        </div>
        <button id="clearAllButton" class="iconOnly isHidden" type="button" title="${escapeHtml(t.clearAllTitle)}" aria-label="${escapeHtml(t.clearAll)}">${ICON("eraser")}</button>
        <button id="screenshotButton" class="iconOnly" type="button" title="${escapeHtml(t.screenshot)}">${ICON("camera")}</button>
        <div id="recordWrapper">
          <button id="recordToggleButton" class="iconOnly" type="button" title="${escapeHtml(t.recordStart)}">${ICON("recordStart")}</button>
          <div id="recordTypeMenu" class="isHidden" role="menu">
            <p id="recordTypeMenuTitle">${escapeHtml(t.recordTypeMenuTitle)}</p>
            <button type="button" id="recordTypeVideoItem" role="menuitem" data-record-mode="video">
              <strong>${escapeHtml(t.recordTypeVideoLabel)}</strong>
              <span>${escapeHtml(t.recordTypeVideoHint)}</span>
            </button>
            <button type="button" id="recordTypePartsItem" role="menuitem" data-record-mode="gif">
              <strong>${escapeHtml(t.recordTypeGifLabel || "GIF em partes (15s)")}</strong>
              <span>${escapeHtml(t.recordTypeGifHint || "Gera GIFs sem áudio de até 15 segundos. Uma parte baixa direto; duas ou mais são organizadas em um ZIP.")}</span>
            </button>
          </div>
        </div>
        <button id="recordStopButton" class="iconOnly isHidden" type="button" title="${escapeHtml(t.recordStop)}">${ICON("recordStop")}</button>
        <span id="recordTimer" class="isHidden">00:00</span>
        <div id="extraPinnedTools" aria-label="Atalhos fixados personalizados"></div>
        <button id="blurQuickButton" class="iconOnly" type="button" aria-pressed="false" title="${escapeHtml(t.blurElementsMenuLabel || "Borrar elementos")}">${ICON("eyeSlash")}</button>
        <button id="holofoteQuickButton" class="iconOnly" type="button" aria-pressed="false" title="${escapeHtml(t.holofoteMenuLabel || "Modo Holofote")}">${ICON("lightbulb")}</button>
        <div id="macroRecordingBar" class="isHidden">
          <button id="macroRecHistoryButton" type="button" title="Ver ações gravadas">${ICON("dot")} <span id="macroStepCount">0</span></button>
          <button id="macroRecPauseButton" class="iconOnly" type="button" title="Pausar gravação">${ICON("pause")}</button>
          <button id="macroRecUndoButton" class="iconOnly" type="button" title="Desfazer última ação">${ICON("undo")}</button>
          <button id="macroRecCancelButton" class="iconOnly" type="button" title="Cancelar gravação">${ICON("fail")}</button>
          <button id="macroRecDoneButton" class="iconOnly" type="button" title="Concluir e editar">${ICON("pass")}</button>
          <div id="macroRecHistoryPanel" class="isHidden"></div>
        </div>
        <div id="stepsRecordingBar" class="isHidden">
          <button id="stepsRecHistoryButton" type="button" title="${escapeHtml(t.stepsRecorderHistory || "Ver passos gravados")}">${ICON("dot")} <span id="stepsRecCount">0</span></button>
          <button id="stepsRecPauseButton" class="iconOnly" type="button" title="${escapeHtml(t.stepsRecorderPause || "Pausar passos")}">${ICON("pause")}</button>
          <button id="stepsRecUndoButton" class="iconOnly" type="button" title="${escapeHtml(t.stepsRecorderUndo || "Desfazer último passo")}">${ICON("undo")}</button>
          <button id="stepsRecCancelButton" class="iconOnly" type="button" title="${escapeHtml(t.stepsRecorderCancel || "Cancelar")}">${ICON("fail")}</button>
          <button id="stepsRecDoneButton" class="iconOnly" type="button" title="${escapeHtml(t.stepsRecorderStop || "Parar e revisar")}">${ICON("pass")}</button>
          <div id="stepsRecHistoryPanel" class="isHidden"></div>
        </div>
        <div id="testSessionBar" class="isHidden">
          <button id="testSessionInfoButton" type="button" title="${escapeHtml(t.testSessionActiveTitle)}">${ICON("wait")} <span id="testSessionElapsed">00:00</span></button>
          <button id="testSessionFinishButton" class="iconOnly" type="button" title="${escapeHtml(t.testSessionFinish)}">${ICON("checkSquare")}</button>
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
              <button type="button" id="mobileShapeRectangleItem" role="menuitem">${ICON("rectangle")} ${escapeHtml(t.shapeTypeRectangle)}</button>
              <button type="button" id="mobileShapeSquareItem" role="menuitem">${ICON("square")} ${escapeHtml(t.shapeTypeSquare)}</button>
              <button type="button" id="mobileShapeCircleItem" role="menuitem">${ICON("circle")} ${escapeHtml(t.shapeTypeCircle)}</button>
              <button type="button" id="mobileLineItem" role="menuitem">${ICON("arrowLeft")} ${escapeHtml(t.line)}</button>
              <button type="button" id="mobileScreenshotItem" role="menuitem">${ICON("camera")} ${escapeHtml(t.screenshot)}</button>
              <button type="button" id="mobileRecordItem" role="menuitem">${ICON("recordStart")} ${escapeHtml(t.recordStart)}</button>
            </div>
            <div id="pinnedMacrosMenu"></div>
            <button type="button" id="disableAllToolsMenuItem" class="isHidden" role="menuitem">${ICON("fail")} ${escapeHtml(translateQaSurfaceText("Desativar ferramentas ativas"))}</button>
            <button type="button" id="statusMenuItem" role="menuitem">${ICON("checkSquare")} Test Suite</button>
            <button type="button" id="testSessionMenuItem" role="menuitem">${ICON("wait")} ${escapeHtml(t.testSessionMenuLabel)}</button>
            <button type="button" id="reportBuilderMenuItem" role="menuitem">${ICON("edit")} ${escapeHtml(t.reportBuilderMenuLabel)}</button>
            <button type="button" id="notesMenuItem" role="menuitem">${ICON("noteText")} ${escapeHtml(t.note)}</button>
            <button type="button" id="shapesMenuItem" role="menuitem">${ICON("square")} ${escapeHtml(t.shape)}</button>
            <button type="button" id="macroStudioMenuItem" role="menuitem">${ICON("macroStudio")} ${escapeHtml(t.macroStudioMenuLabel)}</button>
            <button type="button" id="stepsRecorderMenuItem" role="menuitem">${ICON("stepsRecorder")} ${escapeHtml(t.stepsRecorderMenuLabel || "Gravador de Passos")}</button>
            <button type="button" id="characterCounterMenuItem" role="menuitem">${ICON("characterCounter")} ${escapeHtml(t.characterCounterMenuLabel)}</button>
            <button type="button" id="multiClickMenuItem" role="menuitem">${ICON("multiClick")} ${escapeHtml(t.multiClickMenuLabel)}</button>
            <button type="button" id="inputLabMenuItem" role="menuitem">${ICON("inputLab")} ${escapeHtml(t.inputLabMenuLabel)}</button>
            <button type="button" id="fakerFillMenuItem" role="menuitem">${ICON("fakerFill")} ${escapeHtml(t.fakerFillMenuLabel)}</button>
            <button type="button" id="keyViewMenuItem" role="menuitem">${ICON("keyView")} ${escapeHtml(t.keyViewMenuLabel || "Key View")}</button>
            <button type="button" id="clickSpyMenuItem" role="menuitem">${ICON("mouse")} Click Spy</button>
            <button type="button" id="freezeClockMenuItem" role="menuitem">${ICON("freezeClock")} Freeze Clock</button>
            <button type="button" id="forceHttpMenuItem" role="menuitem">${ICON("forceHttp")} Force HTTP</button>
            <button type="button" id="errorMonitorMenuItem" role="menuitem">${ICON("errorMonitor")} ${escapeHtml(t.errorMonitorTitle)}<span id="errorMonitorBadge" class="qts-badge" style="display:none">0</span></button>
            <button type="button" id="inspectorsMenuItem" role="menuitem">${ICON("inspectors")} ${escapeHtml(t.inspectorsTitle)}<span id="inspectorsBadge" class="qts-badge" style="display:none">0</span></button>
            <button type="button" id="jsonStudioMenuItem" role="menuitem">${ICON("braces")} ${escapeHtml(t.jsonStudioTitle)}</button>
            <button type="button" id="breakpointMenuItem" role="menuitem">${ICON("breakpointViewer")} Breakpoint Viewer</button>
            <button type="button" id="testAccountsMenuItem" role="menuitem">${ICON("key")} ${escapeHtml(t.testAccountsMenuLabel)}</button>
            <button type="button" id="paymentMethodsMenuItem" role="menuitem">${ICON("paymentMethods")} ${escapeHtml(t.paymentMethodsMenuLabel)}</button>
            <button type="button" id="resourcesMenuItem" role="menuitem">${ICON("resources")} ${escapeHtml(t.resourcesMenuLabel)}</button>
            <button type="button" id="elementCaptureMenuItem" role="menuitem">${ICON("elementCapture")} ${escapeHtml(t.elementCaptureMenuLabel || "Capturar elementos")}</button>
            <button type="button" id="blurElementsMenuItem" role="menuitem">${ICON("eyeSlash")} ${escapeHtml(t.blurElementsMenuLabel || "Borrar elementos")}</button>
            <button type="button" id="holofoteMenuItem" role="menuitem">${ICON("lightbulb")} ${escapeHtml(t.holofoteMenuLabel || "Modo Holofote")}</button>
            <button type="button" id="languageValidatorMenuItem" role="menuitem">${ICON("languageValidator")} ${escapeHtml(translateQaSurfaceText("Validador de textos"))}</button>
            <button type="button" id="qrCodeMenuItem" role="menuitem">${ICON("qrCode")} QR Code</button>
            <button type="button" id="pixelPerfectMenuItem" role="menuitem">${ICON("ruler")} ${escapeHtml(t.pixelPerfectMenuLabel || "Pixel Perfect")}</button>
          </div>
        </div>
        <button id="settingsButton" class="iconOnly" type="button" title="${escapeHtml(t.settings)}">${ICON("settings")}<span id="tutorialDot" class="qts-tutorial-dot" hidden></span></button>
        <button id="minimizeButton" class="iconOnly" type="button" title="${escapeHtml(t.minimize)}">${ICON("chevronUp")}</button>
      </div>
    </div>
    <button id="restoreButton" type="button" title="${escapeHtml(t.restore)}">${ICON("chevronDown")}</button>
  `;

  // A plain mousedown on any element outside the current text selection collapses it by
  // browser default (the same reason rich-text-editor toolbars preventDefault their own
  // buttons' mousedown) - without this, clicking Tools → a menu item → "Usar seleção da
  // página" always saw an empty selection, because the first click (on the Tools button
  // itself) had already destroyed it. Scoped to <button> only so real drawer inputs/textareas
  // keep normal focus/caret behavior.
  shadow.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  shadow.getElementById("settingsButton").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "qts:open-options" });
  });
  shadow.getElementById("loggedOutLoginButton").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "qts:open-options", tab: "account" });
  });
  // Delegated on #left (stable across renders) rather than #clientLabel/#breadcrumb directly,
  // since render() replaces those two elements' innerHTML every time - a listener attached
  // straight to a breadcrumb segment would be destroyed along with it on the next render.
  shadow.getElementById("left").addEventListener("click", (event) => {
    const link = event.target.closest("[data-crumb-nav]");
    if (link) window.location.href = link.dataset.crumbNav;
  });
  shadow.getElementById("minimizeButton").addEventListener("click", () => setMinimized(true));
  shadow.getElementById("restoreButton").addEventListener("click", () => setMinimized(false));
  const urlToggleButton = shadow.getElementById("urlToggleButton");
  const verticalUrlPanel = shadow.getElementById("verticalUrlPanel");
  shadow.getElementById("urlToggleWrapper").addEventListener("click", (event) => event.stopPropagation());
  urlToggleButton.addEventListener("click", () => {
    const expanded = verticalUrlPanel.classList.toggle("isHidden") === false;
    urlToggleButton.setAttribute("aria-expanded", String(expanded));
    urlToggleButton.title = expanded ? "Ocultar URL completa" : "Exibir URL completa";
  });
  shadow.getElementById("verticalUrlCopy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(safeCurrentUrl());
    showQaToast("URL copiada.");
  });
  shadow.getElementById("testStatusButton").addEventListener("click", () => openTestStatusModal());
  shadow.getElementById("passButton").addEventListener("click", (event) => enablePlacementMode("pass", event.currentTarget));
  shadow.getElementById("failButton").addEventListener("click", (event) => enablePlacementMode("fail", event.currentTarget));
  shadow.getElementById("markerMoreButton").addEventListener("click", (event) => {
    event.stopPropagation();
    shadow.getElementById("markerTypeMenu").classList.toggle("isHidden");
  });
  shadow.getElementById("markerTypeMenu").addEventListener("click", (event) => event.stopPropagation());
  shadow.querySelectorAll("#markerTypeMenu [data-marker-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      shadow.getElementById("markerTypeMenu").classList.add("isHidden");
      enablePlacementMode(button.dataset.markerPick, shadow.getElementById("markerMoreButton"));
    });
  });
  shadow.getElementById("noteButton").addEventListener("click", () => addFloatingTextNote());
  shadow.getElementById("shapeButton").addEventListener("click", (event) => {
    event.stopPropagation();
    // The submenu may currently live inside #toolsMenu from the "Desenhar forma" row path below --
    // move it back under the pinned icon's own wrapper and drop that path's positioning leftovers
    // (an inline top and the asToolsSubmenu/opensRight classes), otherwise it would keep rendering
    // wherever #toolsMenu last placed it instead of under this icon.
    const submenu = shadow.getElementById("shapeTypeMenu");
    const shapeWrapper = shadow.getElementById("shapeWrapper");
    if (submenu.parentElement !== shapeWrapper) shapeWrapper.appendChild(submenu);
    submenu.classList.remove("asToolsSubmenu", "opensRight");
    submenu.style.top = "";
    toggleShapeTypeMenu();
  });
  shadow.getElementById("shapeTypeMenu").addEventListener("click", (event) => event.stopPropagation());
  shadow.querySelectorAll("#shapeTypeMenu [data-shape-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleShapeTypeMenu(false);
      closeToolsMenu();
      const pick = button.dataset.shapePick;
      const shapeButton = shadow.getElementById("shapeButton");
      if (pick === "line") enablePlacementMode("line", shapeButton);
      else enablePlacementMode("shape", shapeButton, pick);
    });
  });
  shadow.getElementById("notesMenuItem").addEventListener("click", () => { addFloatingTextNote(); closeToolsMenu(); });
  shadow.getElementById("shapesMenuItem").addEventListener("click", (event) => {
    event.stopPropagation();
    const submenu = shadow.getElementById("shapeTypeMenu");
    const toolsMenu = shadow.getElementById("toolsMenu");
    const trigger = event.currentTarget;
    if (submenu.parentElement !== toolsMenu) toolsMenu.appendChild(submenu);
    submenu.classList.add("asToolsSubmenu");
    const willOpen = submenu.classList.contains("isHidden");
    submenu.classList.toggle("isHidden");
    if (willOpen) {
      // Vertically aligns the flyout with the exact row that opened it (offsetTop is relative to
      // #toolsMenu here, since that's this button's nearest positioned ancestor) instead of the
      // top of the whole Tools list. opensRight only kicks in when the Tools dropdown itself sits
      // too close to the left edge of the viewport for a left-opening flyout to fit.
      submenu.style.top = `${trigger.offsetTop}px`;
      const toolsMenuRect = toolsMenu.getBoundingClientRect();
      submenu.classList.toggle("opensRight", toolsMenuRect.left < 210);
    }
  });
  shadow.getElementById("clearAllButton").addEventListener("click", () => clearAllFloatingItems());
  shadow.getElementById("screenshotButton").addEventListener("click", () => captureScreenshot());
  shadow.getElementById("recordStopButton").addEventListener("click", () => handleStopRecordingClick());
  shadow.getElementById("blurQuickButton").addEventListener("click", () => toggleBlurSelectionMode());
  shadow.getElementById("holofoteQuickButton").addEventListener("click", () => toggleHolofoteMode());
  shadow.getElementById("macroRecHistoryButton").addEventListener("click", () => toggleMacroHistoryPanel());
  shadow.getElementById("macroRecPauseButton").addEventListener("click", () => toggleMacroRecordingPause());
  shadow.getElementById("macroRecUndoButton").addEventListener("click", () => undoLastMacroStep());
  shadow.getElementById("macroRecCancelButton").addEventListener("click", () => cancelMacroRecording());
  shadow.getElementById("macroRecDoneButton").addEventListener("click", () => stopMacroRecording());
  shadow.getElementById("stepsRecHistoryButton").addEventListener("click", toggleStepsHistory);
  shadow.getElementById("stepsRecPauseButton").addEventListener("click", toggleStepsPause);
  shadow.getElementById("stepsRecUndoButton").addEventListener("click", undoStepsRecording);
  shadow.getElementById("stepsRecCancelButton").addEventListener("click", cancelStepsRecording);
  shadow.getElementById("stepsRecDoneButton").addEventListener("click", stopStepsRecording);

  // Same handlers as the pinned bar buttons above - this is the narrow-viewport fallback path
  // for them (see the #mobileActionsMenu media query), not a separate feature.
  shadow.getElementById("mobileTestStatusItem").addEventListener("click", () => { openTestStatusModal(); closeToolsMenu(); });
  shadow.getElementById("statusMenuItem").addEventListener("click", () => { openTestStatusModal(); closeToolsMenu(); });
  shadow.getElementById("testSessionMenuItem").addEventListener("click", () => {
    if (state.testSession) finishTestSession(); else startTestSession();
  });
  shadow.getElementById("testSessionInfoButton").addEventListener("click", () => {
    if (state.testSession) showQaToast(`${state.t.testSessionActiveTitle} · ${formatElapsed(Date.now() - state.testSession.startedAt)}`);
  });
  shadow.getElementById("testSessionFinishButton").addEventListener("click", finishTestSession);
  shadow.getElementById("reportBuilderMenuItem").addEventListener("click", () => { openReportBuilder(); closeToolsMenu(); });
  shadow.getElementById("mobilePassItem").addEventListener("click", (event) => { enablePlacementMode("pass", shadow.getElementById("passButton")); closeToolsMenu(); });
  shadow.getElementById("mobileFailItem").addEventListener("click", () => { enablePlacementMode("fail", shadow.getElementById("failButton")); closeToolsMenu(); });
  shadow.getElementById("mobileNoteItem").addEventListener("click", () => { addFloatingTextNote(); closeToolsMenu(); });
  shadow.getElementById("mobileShapeRectangleItem").addEventListener("click", () => { enablePlacementMode("shape", shadow.getElementById("shapeButton"), "rectangle"); closeToolsMenu(); });
  shadow.getElementById("mobileShapeSquareItem").addEventListener("click", () => { enablePlacementMode("shape", shadow.getElementById("shapeButton"), "square"); closeToolsMenu(); });
  shadow.getElementById("mobileShapeCircleItem").addEventListener("click", () => { enablePlacementMode("shape", shadow.getElementById("shapeButton"), "circle"); closeToolsMenu(); });
  shadow.getElementById("mobileLineItem").addEventListener("click", () => { enablePlacementMode("line", shadow.getElementById("shapeButton")); closeToolsMenu(); });
  shadow.getElementById("mobileScreenshotItem").addEventListener("click", () => { captureScreenshot(); closeToolsMenu(); });
  shadow.getElementById("mobileRecordItem").addEventListener("click", () => {
    if (recordingState.status === "idle") startEvidenceRecording("video");
    else handleRecordToggle();
    closeToolsMenu();
  });

  shadow.getElementById("toolsButton").addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = shadow.getElementById("toolsMenu");
    const willOpen = !menu.classList.contains("isOpen");
    shadow.getElementById("disableAllToolsMenuItem").classList.toggle("isHidden", !hasAnyActiveTool());
    shadow.getElementById("notificationBellPanel")?.classList.add("isHidden");
    toggleRecordTypeMenu(false);
    toggleShapeTypeMenu(false);
    shadow.getElementById("markerTypeMenu")?.classList.add("isHidden");
    menu.classList.toggle("isOpen", willOpen);
  });
  // Feeds "mais usados" sorting -- a single delegated listener instead of touching every
  // individual tool's own click handler. Fires on the way down (capture) so it always sees the
  // click even though "Desenhar forma"'s handler above calls stopPropagation() on its own submenu.
  shadow.getElementById("toolsMenu").addEventListener("click", (event) => {
    const button = event.target.closest("button[id]");
    const key = button && TOOLS_MENU_ITEM_KEY_BY_ID[button.id];
    if (key) void recordToolMenuUsage(key);
  }, true);
  shadow.getElementById("disableAllToolsMenuItem").addEventListener("click", () => void disableAllActiveTools());
  shadow.getElementById("notificationBellButton").addEventListener("click", (event) => {
    event.stopPropagation();
    closeToolsMenu();
    toggleRecordTypeMenu(false);
    toggleShapeTypeMenu(false);
    shadow.getElementById("markerTypeMenu")?.classList.add("isHidden");
    toggleNotificationBellPanel();
  });
  shadow.getElementById("recordToggleButton").addEventListener("click", (event) => { event.stopPropagation(); handleRecordToggle(); });
  shadow.getElementById("recordTypeMenu").addEventListener("click", (event) => event.stopPropagation());
  shadow.getElementById("recordTypeVideoItem").addEventListener("click", () => { toggleRecordTypeMenu(false); startEvidenceRecording("video"); });
  // GIF mode is local and bounded: each independently playable part contains at most 15 seconds;
  // one part downloads directly and multiple parts are packaged in their original order.
  shadow.getElementById("recordTypePartsItem").addEventListener("click", () => { toggleRecordTypeMenu(false); startEvidenceRecording("gif"); });
  shadow.addEventListener("click", () => {
    shadow.getElementById("toolsMenu").classList.remove("isOpen");
    shadow.getElementById("notificationBellPanel")?.classList.add("isHidden");
    shadow.getElementById("verticalUrlPanel")?.classList.add("isHidden");
    shadow.getElementById("urlToggleButton")?.setAttribute("aria-expanded", "false");
    toggleRecordTypeMenu(false);
    toggleShapeTypeMenu(false);
    shadow.getElementById("markerTypeMenu")?.classList.add("isHidden");
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
  shadow.getElementById("languageValidatorMenuItem").addEventListener("click", () => { openLanguageValidator(); closeToolsMenu(); });
  shadow.getElementById("qrCodeMenuItem").addEventListener("click", () => { openQrCodeTool(); closeToolsMenu(); });
  // These three keep a persistent on/off mode (unlike most Tools-menu items, which just open a
  // drawer every time): clicking them again while already active turns the mode off directly
  // instead of reopening the drawer just to find the Desativar button inside it - same one-click
  // toggle the quick pinned buttons (blurQuickButton/holofoteQuickButton) already had.
  shadow.getElementById("blurElementsMenuItem").addEventListener("click", () => {
    if (state.blurSelectionActive) { toggleBlurSelectionMode(); closeToolsMenu(); return; }
    openBlurElementsTool();
    closeToolsMenu();
  });
  shadow.getElementById("holofoteMenuItem").addEventListener("click", () => {
    if (state.holofoteActive) { disableHolofoteMode(); closeToolsMenu(); return; }
    openHolofoteTool();
    closeToolsMenu();
  });
  shadow.getElementById("pixelPerfectMenuItem").addEventListener("click", () => {
    if (state.pixelPerfectActive) { disablePixelPerfectMode(); closeToolsMenu(); return; }
    openPixelPerfectTool();
    closeToolsMenu();
  });
  shadow.getElementById("characterCounterMenuItem").addEventListener("click", () => { openCharacterCounter(); closeToolsMenu(); });
  shadow.getElementById("macroStudioMenuItem").addEventListener("click", () => { openMacroStudio(); closeToolsMenu(); });
  shadow.getElementById("stepsRecorderMenuItem").addEventListener("click", () => { openStepsRecorder(); closeToolsMenu(); });
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
  if (document.getElementById(HOST_ID) || !state.environment) return;
  const { host, shadow } = buildShadowHost();
  state.shadowRoot = shadow;
  document.documentElement.appendChild(host);

  const spacer = document.createElement("div");
  spacer.id = SPACER_ID;
  if (document.body) document.body.insertBefore(spacer, document.body.firstChild);

  render();
  void maybeShowFirstRunIntro();
  void maybeShowTutorialDot();
  void maybeStartLiveTour();
  void maybeOpenDetachedTool();
}

function openToolInNewTab(toolKey) {
  const url = new URL(window.location.href);
  url.searchParams.set("qtsDetachedTool", toolKey);
  chrome.runtime.sendMessage({ type: "qts:open-tool-window", url: url.toString(), toolKey }, (response) => {
    if (chrome.runtime.lastError || response?.ok !== true) window.open(url.toString(), "_blank", "noopener");
  });
}

async function maybeOpenDetachedTool() {
  const url = new URL(window.location.href);
  const toolKey = url.searchParams.get("qtsDetachedTool");
  if (!toolKey || !state.authorized) return;
  state.detachedToolKey = toolKey;
  url.searchParams.delete("qtsDetachedTool");
  window.history.replaceState({}, "", url.toString());
  window.setTimeout(() => openDetachedTool(toolKey), 150);
}

function openDetachedTool(toolKey) {
  const supportedTools = new Set(["testStatus", "testAccounts", "paymentMethods", "resources", "jsonStudio", "keyView", "elementCapture", "inputLab", "fakerFill", "stepsRecorder", "inspectors", "errorMonitor", "forceHttp", "blurElements", "holofote", "pixelPerfect", "characterCounter", "multiClick", "macroStudio"]);
  if (!supportedTools.has(toolKey)) return false;
  const existingDrawer = state.shadowRoot?.getElementById("drawerHost");
  if (existingDrawer?.dataset.view === toolKey && existingDrawer.querySelector(".qts-drawer")) return true;
  state.detachedToolKey = toolKey;
  const host = document.getElementById(HOST_ID);
  if (host) host.dataset.detachedWindow = "true";
  switch (toolKey) {
    case "testStatus": openTestStatusModal(); break;
    case "testAccounts": openTestAccountsDrawer(); break;
    case "paymentMethods": openPaymentMethodsDrawer(); break;
    case "resources": openResourcesDrawer(); break;
    case "jsonStudio": openJsonStudio(); break;
    case "keyView": openKeyView(); break;
    case "elementCapture": openElementCapture(); break;
    case "inputLab": openInputLab(); break;
    case "fakerFill": openFakerFill(); break;
    case "stepsRecorder": openStepsRecorder(); break;
    case "inspectors": openInspectorsDrawer(); break;
    case "errorMonitor": openErrorMonitorDrawer(); break;
    case "forceHttp": openForceHttpDialog(); break;
    case "blurElements": openBlurElementsTool(); break;
    case "holofote": openHolofoteTool(); break;
    case "pixelPerfect": openPixelPerfectTool(); break;
    case "characterCounter": openCharacterCounter(); break;
    case "multiClick": openMultiClick(); break;
    case "macroStudio": openMacroStudio(); break;
  }
  return true;
}

// Small dot on the settings button, separate from maybeShowFirstRunIntro's one-time card above:
// this one points at the Tutorial panel specifically, only while the user hasn't opened it at all
// yet (no completed steps) and hasn't already dismissed the "Novo por aqui?" banner in options.js
// (dismissedBannerAt covers both surfaces with one flag, since dismissing one implies "I know
// about the tutorial already"). Re-checked on every mount rather than cached in `state`, since the
// user may complete/dismiss it from the options page while a toolbar tab stays open.
async function maybeShowTutorialDot() {
  if (!state.shadowRoot) return;
  const progress = await window.QTS_STORAGE.getTutorialProgress();
  const dot = state.shadowRoot.getElementById("tutorialDot");
  if (!dot) return;
  dot.hidden = progress.completedSteps.length > 0 || Boolean(progress.dismissedBannerAt);
}

// Live guided tour: a spotlight ring + instruction balloon pointing at each plan-gated-or-not
// tool's REAL button/menu item on the actual bar, one at a time. The user performs the real action
// themselves (the tour never simulates clicks for them) and clicks "Concluir passo" when ready.
// Content comes straight from window.QTS_TUTORIAL_DATA (tutorial-data.js, now also loaded in this
// content-script context) - adding a tool there and to TOUR_TARGETS below is the only wiring a
// future tool needs to join the live tour, same "one array" principle as the Tutorial/FAQ panels.
const TOUR_TARGETS = {
  testStatus: { selector: "#statusMenuItem", menu: true },
  passFail: { selector: "#passButton" },
  notesShapes: { selector: "#notesMenuItem", menu: true },
  line: { selector: "#shapesMenuItem", menu: true },
  blurElements: { selector: "#blurElementsMenuItem", menu: true },
  holofote: { selector: "#holofoteMenuItem", menu: true },
  pixelPerfect: { selector: "#pixelPerfectMenuItem", menu: true },
  screenshot: { selector: "#screenshotButton" },
  recording: { selector: "#recordToggleButton" },
  clickSpy: { selector: "#clickSpyMenuItem", menu: true },
  freezeClock: { selector: "#freezeClockMenuItem", menu: true },
  forceHttp: { selector: "#forceHttpMenuItem", menu: true },
  errorMonitor: { selector: "#errorMonitorMenuItem", menu: true },
  inspectors: { selector: "#inspectorsMenuItem", menu: true },
  jsonStudio: { selector: "#jsonStudioMenuItem", menu: true },
  breakpoints: { selector: "#breakpointMenuItem", menu: true },
  characterCounter: { selector: "#characterCounterMenuItem", menu: true },
  multiClick: { selector: "#multiClickMenuItem", menu: true },
  inputLab: { selector: "#inputLabMenuItem", menu: true },
  fakerFill: { selector: "#fakerFillMenuItem", menu: true },
  macroStudio: { selector: "#macroStudioMenuItem", menu: true },
  stepsRecorder: { selector: "#stepsRecorderMenuItem", menu: true },
  keyView: { selector: "#keyViewMenuItem", menu: true },
  elementCapture: { selector: "#elementCaptureMenuItem", menu: true },
  languageValidator: { selector: "#languageValidatorMenuItem", menu: true },
  qrCode: { selector: "#qrCodeMenuItem", menu: true },
  testAccounts: { selector: "#testAccountsMenuItem", menu: true },
  paymentMethods: { selector: "#paymentMethodsMenuItem", menu: true },
  resources: { selector: "#resourcesMenuItem", menu: true },
};
let tourSteps = [];
let tourStepIndex = -1;
let tourResizeHandler = null;
let tourScrollHandler = null;
let tourKeyHandler = null;
let tourInteractionHandler = null;
let tourMenuPhase = false;
let tourRenderVersion = 0;
let tourSurfacePhase = false;
let breakpointTourSubstep = 0;

async function maybeStartLiveTour() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("qtsTutorial") !== "1") return;
  const requestedStep = url.searchParams.get("qtsTutorialStep");
  url.searchParams.delete("qtsTutorial");
  url.searchParams.delete("qtsTutorialStep");
  window.history.replaceState({}, "", url.toString());
  if (!state.authorized) {
    chrome.runtime.sendMessage({ type: "qts:open-options", tab: "account" });
    return;
  }
  startTutorialTour(requestedStep);
}

function startTutorialTour(startAtKey) {
  if (!state.shadowRoot) return;
  if (tourResizeHandler) window.removeEventListener("resize", tourResizeHandler);
  if (tourScrollHandler) window.removeEventListener("scroll", tourScrollHandler, true);
  if (tourKeyHandler) document.removeEventListener("keydown", tourKeyHandler, true);
  if (tourInteractionHandler) state.shadowRoot.removeEventListener("click", tourInteractionHandler, true);
  tourSteps = (window.QTS_TUTORIAL_DATA || []).filter((module) => TOUR_TARGETS[module.key]);
  if (!tourSteps.length) return;
  const requestedIndex = startAtKey ? tourSteps.findIndex((module) => module.key === startAtKey) : -1;
  tourStepIndex = requestedIndex >= 0 ? requestedIndex : 0;
  tourMenuPhase = Boolean(TOUR_TARGETS[tourSteps[tourStepIndex]?.key]?.menu);
  tourSurfacePhase = false;
  ensureTourHost();
  renderTourStep();
  tourResizeHandler = () => renderTourStep();
  tourScrollHandler = () => renderTourStep();
  tourKeyHandler = (event) => { if (event.key === "Escape") endTour({ redirectToWorkspace: false }); };
  window.addEventListener("resize", tourResizeHandler);
  window.addEventListener("scroll", tourScrollHandler, true);
  document.addEventListener("keydown", tourKeyHandler, true);
  tourInteractionHandler = (event) => handleTourInteraction(event);
  state.shadowRoot.addEventListener("click", tourInteractionHandler, true);
}

function ensureTourHost() {
  if (state.shadowRoot.getElementById("tourOverlay")) return;
  const host = document.createElement("div");
  host.id = "tourOverlay";
  host.innerHTML = `
    <style>
      #tourOverlay { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
      .qts-tour-spotlight { position: fixed; pointer-events: none; border-radius: 10px; box-shadow: 0 0 0 9999px rgba(0,0,0,.68), 0 0 0 3px var(--qts-ui-primary, #ffd700); transition: top .25s ease, left .25s ease, width .25s ease, height .25s ease; z-index: 2147483646; animation: qts-tour-pulse 1.4s ease-in-out infinite; }
      @keyframes qts-tour-pulse { 0%, 100% { box-shadow: 0 0 0 9999px rgba(0,0,0,.68), 0 0 0 3px var(--qts-ui-primary, #ffd700); } 50% { box-shadow: 0 0 0 9999px rgba(0,0,0,.68), 0 0 0 6px var(--qts-ui-primary, #ffd700); } }
      .qts-tour-balloon {
        position: fixed; z-index: 2147483647; width: min(320px, calc(100vw - 24px)); padding: 14px;
        border-radius: 12px; background: #0b0b0b; border: 1px solid #333; box-shadow: 0 16px 34px rgba(0,0,0,.5);
        color: #fff; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; pointer-events: auto;
      }
      .qts-tour-balloon .qts-tour-step { color: var(--qts-ui-primary, #ffd700); font-size: 11px; font-weight: 800; letter-spacing: .02em; }
      .qts-tour-balloon b { display: block; margin: 4px 0 6px; font-size: 14px; }
      .qts-tour-balloon p { margin: 0 0 12px; color: #ccc; }
      .qts-tour-actions { display: flex; gap: 8px; }
      .qts-tour-actions button { all: unset; box-sizing: border-box; flex: 1; text-align: center; height: 32px; line-height: 32px; border-radius: 8px; cursor: pointer; font-weight: 800; font-size: 12px; }
      .qts-tour-skip { background: #232323; color: #ccc; flex: none !important; padding: 0 12px; }
      .qts-tour-next { background: var(--qts-ui-primary, #ffd700); color: var(--qts-ui-primary-contrast, #111); }
      .qts-tour-card {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2147483647;
        width: min(340px, calc(100vw - 24px)); padding: 18px; border-radius: 14px; background: #0b0b0b;
        border: 1px solid #333; box-shadow: 0 20px 48px rgba(0,0,0,.55); color: #fff; text-align: center;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; pointer-events: auto;
      }
      .qts-tour-card .qts-tour-trophy { font-size: 30px; margin-bottom: 6px; }
      .qts-tour-card b { display: block; font-size: 15px; margin-bottom: 4px; }
      .qts-tour-card-tip { margin: 0; color: #ccc; font-size: 12px; line-height: 1.5; }
      .qts-tour-card .qts-tour-card-actions { display: flex; gap: 8px; margin-top: 14px; }
      .qts-tour-card .qts-tour-card-actions button { all: unset; box-sizing: border-box; flex: 1; text-align: center; height: 32px; line-height: 32px; border-radius: 8px; cursor: pointer; font-weight: 800; font-size: 12px; background: #232323; color: #ccc; }
      .qts-tour-card .qts-tour-card-actions button.qts-tour-primary { background: var(--qts-ui-primary, #ffd700); color: var(--qts-ui-primary-contrast, #111); }
      :host([data-theme="light"]) .qts-tour-balloon,
      :host([data-theme="light"]) .qts-tour-card { background:#fff; border-color:#b8c2d3; color:#171a24; box-shadow:0 18px 44px rgba(30,43,67,.24); }
      :host([data-theme="light"]) .qts-tour-balloon p,
      :host([data-theme="light"]) .qts-tour-card-tip { color:#536078; }
      :host([data-theme="light"]) .qts-tour-balloon .qts-tour-step { color:#5637bf; }
      :host([data-theme="light"]) .qts-tour-skip,
      :host([data-theme="light"]) .qts-tour-card .qts-tour-card-actions button { background:#e9edf6; color:#29344a; }
      @media (prefers-color-scheme:light) {
        :host([data-theme="system"]) .qts-tour-balloon, :host([data-theme="system"]) .qts-tour-card { background:#fff; border-color:#b8c2d3; color:#171a24; }
        :host([data-theme="system"]) .qts-tour-balloon p, :host([data-theme="system"]) .qts-tour-card-tip { color:#536078; }
      }
    </style>
  `;
  state.shadowRoot.appendChild(host);
}

function tourHost() {
  return state.shadowRoot?.getElementById("tourOverlay") || null;
}

async function renderTourStep() {
  const renderVersion = ++tourRenderVersion;
  const host = tourHost();
  const module = tourSteps[tourStepIndex];
  if (!host || !module) return;
  if (tourSurfacePhase) {
    renderTourPanelContext(module);
    return;
  }
  host.querySelectorAll(".qts-tour-spotlight, .qts-tour-balloon, .qts-tour-card").forEach((node) => node.remove());
  const config = TOUR_TARGETS[module.key];
  const toolsMenu = state.shadowRoot.getElementById("toolsMenu");
  if (!config.menu || tourMenuPhase) toolsMenu?.classList.remove("isOpen");
  if (config.menu && !tourMenuPhase) {
    toolsMenu?.classList.add("isOpen");
    // #toolsMenu opens via a 140ms opacity/transform transition (toolbar.js's own CSS) -- reading
    // getBoundingClientRect() in the same tick as toggling .isOpen can still see the pre-transition
    // (closed, translateY(-6px)) geometry, which threw the spotlight off the real button just
    // enough to look like nothing was highlighted. Wait the transition out before measuring.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
    if (tourSteps[tourStepIndex] !== module || renderVersion !== tourRenderVersion) return;
  }
  const targetEl = state.shadowRoot.querySelector(config.menu && tourMenuPhase ? "#toolsButton" : config.selector);
  if (!targetEl) { advanceTourStep(); return; }
  if (config.menu && !tourMenuPhase && toolsMenu) {
    const menuRect = toolsMenu.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const safeInset = 6;
    // The compact Tools menu intentionally shows only eight rows and scrolls the rest. Tour
    // targets near the bottom therefore have valid layout coordinates but sit outside the menu's
    // clipping viewport. Center the real button first, wait for layout, and only then measure the
    // spotlight/balloon. This also works after sorting the menu changes an item's offsetTop.
    if (targetRect.top < menuRect.top + safeInset || targetRect.bottom > menuRect.bottom - safeInset) {
      const centeredTop = targetEl.offsetTop - (toolsMenu.clientHeight - targetEl.offsetHeight) / 2;
      toolsMenu.scrollTop = Math.max(0, centeredTop);
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      if (tourSteps[tourStepIndex] !== module || renderVersion !== tourRenderVersion) return;
    }
  }
  const rect = targetEl.getBoundingClientRect();
  const pad = 6;
  const spotlight = document.createElement("div");
  spotlight.className = "qts-tour-spotlight";
  spotlight.style.top = `${rect.top - pad}px`;
  spotlight.style.left = `${rect.left - pad}px`;
  spotlight.style.width = `${rect.width + pad * 2}px`;
  spotlight.style.height = `${rect.height + pad * 2}px`;
  host.appendChild(spotlight);

  const balloon = document.createElement("div");
  balloon.className = "qts-tour-balloon";
  const t = state.t;
  balloon.innerHTML = `
    <span class="qts-tour-step">${escapeHtml(t.tourStepLabel ? t.tourStepLabel(tourStepIndex + 1, tourSteps.length) : `${tourStepIndex + 1}/${tourSteps.length}`)}</span>
    <b>${escapeHtml(config.menu && tourMenuPhase ? (state.t.tools || "Ferramentas") : module.title)}</b>
    <p>${escapeHtml(config.menu && tourMenuPhase ? tourOpenToolsInstruction() : module.instructions)}</p>
    <div class="qts-tour-actions">
      <button type="button" class="qts-tour-skip" data-tour-skip>${escapeHtml(t.tourSkip || "Pular tutorial")}</button>
      <button type="button" class="qts-tour-next" data-tour-done>${escapeHtml(t.tourComplete || "Concluir passo")}</button>
    </div>
  `;
  host.appendChild(balloon);
  const balloonWidth = balloon.offsetWidth || 320;
  const balloonHeight = balloon.offsetHeight || 140;
  const belowTop = rect.bottom + 14;
  const aboveTop = rect.top - balloonHeight - 14;
  const top = belowTop + balloonHeight <= window.innerHeight - 12 ? belowTop : Math.max(12, aboveTop);
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - balloonWidth - 12);
  balloon.style.top = `${top}px`;
  balloon.style.left = `${left}px`;
  balloon.querySelector("[data-tour-skip]").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); endTour({ redirectToSettingsTour: true }); });
  balloon.querySelector("[data-tour-done]").addEventListener("click", () => completeCurrentTourStep());
}

function tourLanguage() {
  return String(state.workspace?.language || navigator.language || "pt").toLowerCase();
}

function tourOpenToolsInstruction() {
  const language = tourLanguage();
  if (language.startsWith("es")) return "Primero, abre el menú Herramientas. Después destacaremos exactamente dónde hacer clic.";
  if (language.startsWith("en")) return "First, open the Tools menu. We will then highlight exactly where to click.";
  return "Primeiro, abra o menu Ferramentas. Em seguida, vamos destacar exatamente onde clicar.";
}

function tourPanelInstruction() {
  const language = tourLanguage();
  if (language.startsWith("es")) return "La herramienta está abierta. Sigue las instrucciones en este panel y, cuando termines, concluye el paso.";
  if (language.startsWith("en")) return "The tool is open. Follow the instructions in this panel, then complete the step.";
  return "A ferramenta está aberta. Siga as instruções neste painel e, quando terminar, conclua o passo.";
}

function handleTourInteraction(event) {
  const module = tourSteps[tourStepIndex];
  const config = module && TOUR_TARGETS[module.key];
  if (!config) return;
  if (config.menu && tourMenuPhase && event.target.closest("#toolsButton")) {
    tourMenuPhase = false;
    window.setTimeout(renderTourStep, 190);
    return;
  }
  if (!event.target.closest(config.selector)) return;
  // Restore the page immediately while the real action runs. If that action opens a panel,
  // replace the dimming with a small contextual explanation attached to the open surface.
  tourHost()?.querySelectorAll(".qts-tour-spotlight, .qts-tour-balloon").forEach((node) => node.remove());
  tourSurfacePhase = true;
  breakpointTourSubstep = 0;
  // Some tools open synchronously, while others wait for a MAIN-world response before their
  // drawer exists (Freeze Clock is the common example). Keep the tour alive in both cases and
  // re-attach its explanation as soon as the real surface becomes available.
  [80, 240, 600, 1200].forEach((delay) => window.setTimeout(() => renderTourPanelContext(module), delay));
}

function renderTourPanelContext(module) {
  if (tourSteps[tourStepIndex] !== module) return;
  const panel = state.shadowRoot.querySelector("#drawerHost .qts-drawer, #drawerHost .qts-bp-overlay, #testStatusModal:not(.isHidden), #shapeTypeMenu:not(.isHidden), #recordTypeMenu:not(.isHidden)");
  const host = tourHost();
  if (!host) return;
  // Drawers are created after the tour host and use the same maximum z-index. Move the host to
  // the end so the contextual balloon remains visible without blocking the panel itself.
  state.shadowRoot.appendChild(host);
  host.querySelectorAll(".qts-tour-spotlight, .qts-tour-balloon").forEach((node) => node.remove());
  if (module.key === "breakpoints" && panel?.classList.contains("qts-bp-overlay")) {
    renderBreakpointTourContext(module, host);
    return;
  }
  const balloon = document.createElement("div");
  balloon.className = "qts-tour-balloon";
  balloon.style.right = "18px";
  balloon.style.bottom = "18px";
  balloon.innerHTML = `<span class="qts-tour-step">${escapeHtml(state.t.tourStepLabel ? state.t.tourStepLabel(tourStepIndex + 1, tourSteps.length) : `${tourStepIndex + 1}/${tourSteps.length}`)}</span><b>${escapeHtml(module.title)}</b><p>${escapeHtml(tourPanelInstruction())}</p><div class="qts-tour-actions"><button type="button" class="qts-tour-skip" data-tour-skip>${escapeHtml(state.t.tourSkip || "Pular tutorial")}</button><button type="button" class="qts-tour-next" data-tour-done>${escapeHtml(state.t.tourComplete || "Concluir passo")}</button></div>`;
  host.appendChild(balloon);
  balloon.querySelector("[data-tour-skip]").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); endTour({ redirectToSettingsTour: true }); });
  balloon.querySelector("[data-tour-done]").addEventListener("click", completeCurrentTourStep);
}

const BREAKPOINT_TOUR_STEPS = [
  { selector: "#bpUrl", title: "URL de teste", text: "Confira ou informe a URL que será comparada nas duas visualizações." },
  { selector: "#bpDeviceA", title: "Primeiro dispositivo", text: "Escolha o primeiro tamanho de tela para a comparação responsiva." },
  { selector: "#bpDeviceB", title: "Segundo dispositivo", text: "Escolha o segundo dispositivo. As duas telas mantêm a proporção real entre si." },
  { selector: "#bpReload", title: "Recarregar previews", text: "Use Recarregar depois de alterar a URL ou quando quiser repetir o cenário nas duas telas." },
  { selector: "#bpZoom", title: "Zoom", text: "Ajuste somente a visualização; a resolução emulada de cada dispositivo não é alterada." },
  { selector: "#bpSyncScroll", title: "Sincronizar scroll", text: "Ative para rolar as duas páginas juntas e comparar o mesmo trecho." },
  { selector: "#bpSyncClick", title: "Sincronizar clique", text: "Ative para repetir o clique na posição equivalente da outra tela quando a página permitir." },
];

function renderBreakpointTourContext(module, host) {
  const step = BREAKPOINT_TOUR_STEPS[Math.min(breakpointTourSubstep, BREAKPOINT_TOUR_STEPS.length - 1)];
  const target = state.shadowRoot.querySelector(`#drawerHost ${step.selector}`);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const spotlight = document.createElement("div");
  spotlight.className = "qts-tour-spotlight";
  spotlight.style.cssText = `top:${rect.top - 5}px;left:${rect.left - 5}px;width:${rect.width + 10}px;height:${rect.height + 10}px`;
  host.appendChild(spotlight);
  const balloon = document.createElement("div");
  balloon.className = "qts-tour-balloon";
  balloon.style.left = `${Math.min(Math.max(12, rect.left), window.innerWidth - 332)}px`;
  balloon.style.top = `${rect.bottom + 170 < window.innerHeight ? rect.bottom + 12 : Math.max(12, rect.top - 170)}px`;
  const last = breakpointTourSubstep >= BREAKPOINT_TOUR_STEPS.length - 1;
  balloon.innerHTML = `<span class="qts-tour-step">Breakpoint ${breakpointTourSubstep + 1}/${BREAKPOINT_TOUR_STEPS.length}</span><b>${escapeHtml(step.title)}</b><p>${escapeHtml(step.text)}</p><div class="qts-tour-actions"><button type="button" class="qts-tour-skip" data-tour-skip>${escapeHtml(state.t.tourSkip || "Pular tutorial")}</button><button type="button" class="qts-tour-next" data-bp-next>${last ? escapeHtml(state.t.tourComplete || "Concluir passo") : escapeHtml(state.t.tourNext || "Próximo")}</button></div>`;
  host.appendChild(balloon);
  balloon.querySelector("[data-tour-skip]").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); endTour({ redirectToSettingsTour: true }); });
  balloon.querySelector("[data-bp-next]").addEventListener("click", () => {
    if (last) completeCurrentTourStep();
    else { breakpointTourSubstep += 1; renderTourPanelContext(module); }
  });
}

function closeCurrentTourSurface() {
  cleanupBreakpointViewer();
  closeDrawer();
  state.shadowRoot?.getElementById("toolsMenu")?.classList.remove("isOpen");
  ["testStatusModal", "shapeTypeMenu", "recordTypeMenu"].forEach((id) => state.shadowRoot?.getElementById(id)?.classList.add("isHidden"));
  tourSurfacePhase = false;
  breakpointTourSubstep = 0;
}

async function completeCurrentTourStep() {
  const module = tourSteps[tourStepIndex];
  if (!module) return;
  await window.QTS_STORAGE.saveTutorialCompletedStep(module.key);
  // A completed tool must never cover the target for the next step. This also cleans up the
  // full-screen Responsive View and its listeners before showing the achievement card.
  closeCurrentTourSurface();
  playSound("achievement");
  showTourStepDoneCard(module);
}

function showTourStepDoneCard(module) {
  const host = tourHost();
  if (!host) return;
  host.querySelectorAll(".qts-tour-spotlight, .qts-tour-balloon, .qts-tour-card").forEach((node) => node.remove());
  const t = state.t;
  const isLast = tourStepIndex >= tourSteps.length - 1;
  const card = document.createElement("div");
  card.className = "qts-tour-card";
  const tipLine = module.tip ? `${module.short} ${t.tourTip || "Dica"}: ${module.tip}` : module.short;
  card.innerHTML = `
    <div class="qts-tour-trophy">${ICON("trophy")}</div>
    <b>${escapeHtml(module.title)} ${escapeHtml(t.tourDone || "concluído!")}</b>
    <p class="qts-tour-card-tip">${escapeHtml(tipLine)}</p>
    <div class="qts-tour-card-actions">
      <button type="button" data-tour-repeat>${escapeHtml(t.tourRepeat || "Repetir")}</button>
      <button type="button" data-tour-close>${escapeHtml(t.close || "Fechar")}</button>
      <button type="button" class="qts-tour-primary" data-tour-next-card>${isLast ? escapeHtml(t.tourFinish || "Concluir") : escapeHtml(t.tourNext || "Próximo")}</button>
    </div>
  `;
  host.appendChild(card);
  card.querySelector("[data-tour-repeat]").addEventListener("click", () => renderTourStep());
  card.querySelector("[data-tour-close]").addEventListener("click", () => endTour({ redirectToWorkspace: false }));
  card.querySelector("[data-tour-next-card]").addEventListener("click", () => advanceTourStep());
}

function advanceTourStep() {
  closeCurrentTourSurface();
  tourStepIndex += 1;
  if (tourStepIndex >= tourSteps.length) { endTour({ redirectToSettingsTour: true }); return; }
  tourMenuPhase = Boolean(TOUR_TARGETS[tourSteps[tourStepIndex]?.key]?.menu);
  renderTourStep();
}

function endTour({ redirectToWorkspace = false, redirectToSettingsTour = false }) {
  closeCurrentTourSurface();
  tourHost()?.remove();
  tourSteps = [];
  tourStepIndex = -1;
  tourRenderVersion += 1;
  state.shadowRoot?.getElementById("toolsMenu")?.classList.remove("isOpen");
  if (tourResizeHandler) { window.removeEventListener("resize", tourResizeHandler); tourResizeHandler = null; }
  if (tourScrollHandler) { window.removeEventListener("scroll", tourScrollHandler, true); tourScrollHandler = null; }
  if (tourKeyHandler) { document.removeEventListener("keydown", tourKeyHandler, true); tourKeyHandler = null; }
  if (tourInteractionHandler && state.shadowRoot) { state.shadowRoot.removeEventListener("click", tourInteractionHandler, true); tourInteractionHandler = null; }
  void window.QTS_STORAGE.saveTutorialBannerDismissed();
  if (redirectToWorkspace) chrome.runtime.sendMessage({ type: "qts:open-options", tab: "workspace" });
  // The settings tour starts in Workspace. Deep-link there as the stable fallback as well, so a
  // delayed access refresh never leaves the user on Tutorial without the promised next step.
  if (redirectToSettingsTour) chrome.runtime.sendMessage({ type: "qts:open-options", tab: "workspace", settingsTour: true });
}

// First-run callout used to be a popup card at the bottom of the screen - founder feedback: it
// sat right where the tour balloon and evidence recordings needed that space, so it now queues as
// a normal entry in the notification bell instead (dismiss = same hasSeenToolbarIntro flag as
// before, just read/written from updateHttpErrorSurfaces/renderNotificationBellPanel below).
async function maybeShowFirstRunIntro() {
  if (!state.shadowRoot) return;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.uiState);
  state.showFirstRunNotification = !stored[STORAGE_KEYS.uiState]?.hasSeenToolbarIntro;
  state.pendingReleaseNote = stored[STORAGE_KEYS.uiState]?.pendingReleaseNote || null;
  updateHttpErrorSurfaces();
}

function releaseNotesCopy() {
  const language = state.workspace?.preferences?.language || "pt-BR";
  if (language.startsWith("es")) return { title: `Actualizado a la versión ${state.pendingReleaseNote?.version || ""}`, intro: "Tus datos y configuraciones anteriores se conservaron.", items: ["Modo vertical (izquierda/derecha): el botón Herramientas ya no muestra dos íconos superpuestos.", "Modo vertical: \"Empujar contenido\" ahora funciona correctamente también con la barra a la izquierda, a la derecha o abajo, no solo arriba.", "Modo vertical: el botón de minimizar ahora está en la parte superior de la barra, no abajo.", "Se eliminó la etiqueta \"Posición\" del selector de posición del sidebar - ahora solo aparece el combobox."], action: "Entendido" };
  if (language.startsWith("en")) return { title: `Updated to version ${state.pendingReleaseNote?.version || ""}`, intro: "Your existing data and settings were preserved.", items: ["Vertical mode (left/right): the Tools button no longer shows two overlapping icons.", "Vertical mode: \"Push content\" now works correctly when docked left, right or bottom too, not just at the top.", "Vertical mode: the minimize button now sits at the top of the bar instead of the bottom.", "The \"Posição\" label was removed from the sidebar position selector - just the dropdown shows now."], action: "Got it" };
  return { title: `Atualizado para a versão ${state.pendingReleaseNote?.version || ""}`, intro: "Seus dados e configurações anteriores foram preservados.", items: ["Modo vertical (esquerda/direita): o botão Ferramentas não mostra mais dois ícones sobrepostos.", "Modo vertical: \"Empurrar conteúdo\" agora funciona corretamente também com a barra à esquerda, à direita ou embaixo, não só no topo.", "Modo vertical: o botão de minimizar agora fica no topo da barra, não mais embaixo.", "O rótulo \"Posição\" foi removido do seletor de posição do sidebar - só o combobox aparece."], action: "Entendi" };
}

async function dismissReleaseNote() {
  state.pendingReleaseNote = null;
  const current = await chrome.storage.local.get(STORAGE_KEYS.uiState);
  const uiState = { ...(current[STORAGE_KEYS.uiState] || {}) };
  delete uiState.pendingReleaseNote;
  uiState.lastSeenReleaseVersion = chrome.runtime.getManifest().version;
  await chrome.storage.local.set({ [STORAGE_KEYS.uiState]: uiState });
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: "QA Toolbar Sandbox - abrir configurações" });
  updateHttpErrorSurfaces();
}

function openReleaseNotes() {
  const copy = releaseNotesCopy();
  openDrawer({ title: copy.title, variant: "modal", bodyHtml: `<p class="qts-tool-lead">${escapeHtml(copy.intro)}</p><ul style="display:grid;gap:10px;padding-left:22px">${copy.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul><div class="qts-toolbar-row" style="justify-content:flex-end"><button id="releaseNotesDone" class="action primary" type="button">${escapeHtml(copy.action)}</button></div>`, onReady(body) { body.querySelector("#releaseNotesDone").addEventListener("click", async () => { await dismissReleaseNote(); closeDrawer(); }); } });
}

async function dismissFirstRunNotification() {
  state.showFirstRunNotification = false;
  const current = await chrome.storage.local.get(STORAGE_KEYS.uiState);
  await chrome.storage.local.set({ [STORAGE_KEYS.uiState]: { ...(current[STORAGE_KEYS.uiState] || {}), hasSeenToolbarIntro: true } });
  updateHttpErrorSurfaces();
}

function removeToolbar({ disableBridge = false } = {}) {
  cancelElementSelection();
  stopKeyView();
  state.elementViewCleanup?.();
  state.macroRecording?.cleanup?.();
  state.macroRecording = null;
  state.stepsRecording?.cleanup?.();
  state.stepsRecording = null;
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
  if (document.body) {
    document.body.style.marginLeft = "";
    document.body.style.marginRight = "";
  }
  document.dispatchEvent(new CustomEvent("qts:pagebridge-active", { detail: { active: false } }));
  if (disableBridge) document.dispatchEvent(new CustomEvent("qts:pagebridge-disable"));
}

function syncToolbarForCurrentLocation() {
  state.environment = findActiveEnvironment(state.workspace || { environments: [] });
  if (!state.environment && state.siteScope?.mode === "all") {
    state.environment = {
      id: "qts-all-sites",
      name: "Todos os sites",
      color: "#2878ff",
      productId: null,
      projectId: null,
      clientId: null,
      urlPatterns: ["<all_urls>"],
      primaryUrl: window.location.origin,
    };
  }
  if (!state.environment) {
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
 * SPA route render, a scroll-triggered header) - re-running offsetSiteFixedHeaders() only from
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
  if (!state.environment) return;
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

// `forced` (used by the "lembrar de atribuir status" recording flow) hides the close button and
// backdrop-dismiss so the modal can't be skipped, and `onDone` fires 3s after a status is picked
// (matching showResultOverlay's own on-screen duration) - the recording is still running the whole
// time, so the result overlay actually gets captured in the video before the caller stops it.
function openTestStatusModal({ forced = false, onDone = null } = {}) {
  closeTestStatusModal();
  const statusOptions = getTestStatusOptions();
  const modal = document.createElement("div");
  modal.id = "qts-test-status-modal";
  modal.className = "qts-modal-backdrop";
  modal.innerHTML = `
    <div class="qts-modal">
      <header><h2>${escapeHtml(state.t.testStatus)}</h2>${forced ? "" : `<span class="qts-modal-head-actions"><button type="button" data-detach title="Abrir em nova aba">${ICON("resize")}</button><button type="button" data-close class="isDanger" title="Fechar">${ICON("fail")}</button></span>`}</header>
      ${forced ? `<p class="qts-modal-forced-hint">${escapeHtml(state.t.recordForceStatusHint)}</p>` : ""}
      <div class="qts-status-grid">
        ${statusOptions.map((option) => `
          <button type="button" class="qts-status-option" data-status="${option.key}" style="--qts-status-color:${option.color}">
            <span class="qts-status-icon">${option.icon}</span><span>${escapeHtml(option.label)}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("isOpen"));
  if (!forced) {
    modal.querySelector("[data-detach]").addEventListener("click", () => {
      openToolInNewTab("testStatus");
      closeTestStatusModal();
    });
    modal.querySelector("[data-close]").addEventListener("click", closeTestStatusModal);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeTestStatusModal(); });
  }
  modal.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.status;
      const option = statusOptions.find((item) => item.key === key);
      closeTestStatusModal();
      showResultOverlay(option);
      playSound(key);
      void recordTestStatus(option);
      if (onDone) window.setTimeout(() => onDone(option), 3_000);
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
  if (state.testSession) state.testSession.statusPicks.push({ status: option.key, label: option.label, at: Date.now() });
}

// ---------------------------------------------------------------------------
// Sessão de Teste: "iniciar → durante → finalizar" grouping so evidence, status
// picks and network errors captured while testing a scenario can be reviewed
// and exported together, instead of scattered across separate tools with no
// shared thread. Local-only (chrome.storage.local), like TEST_STATUS_HISTORY_KEY
// above - no workspace/backend schema involved.
// ---------------------------------------------------------------------------

const TEST_SESSION_REPORTS_KEY = "qtsTestSessionReportsV1";
let testSessionTimer = 0;

function sessionContextSnapshot() {
  const environment = state.environment;
  if (!environment) return { client: "", project: "", product: "", environment: "", url: window.location.href };
  const workspace = state.workspace || { clients: [], projects: [], products: [] };
  const client = findById(workspace.clients, environment.clientId);
  const project = findById(workspace.projects, environment.projectId);
  const product = findById(workspace.products, environment.productId);
  return {
    client: client?.name || "", project: project?.name || "", product: product?.name || "",
    environment: environment.name || "", url: window.location.href,
  };
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function startTestSession() {
  if (state.testSession) return;
  state.testSession = {
    startedAt: Date.now(),
    context: sessionContextSnapshot(),
    statusPicks: [],
    evidenceCount: 0,
    stepRecordingIds: [],
    httpErrorsAtStart: state.httpErrors.length,
  };
  const bar = state.shadowRoot.getElementById("testSessionBar");
  bar.classList.remove("isHidden");
  const elapsedEl = state.shadowRoot.getElementById("testSessionElapsed");
  testSessionTimer = window.setInterval(() => {
    if (!state.testSession) return;
    elapsedEl.textContent = formatElapsed(Date.now() - state.testSession.startedAt);
  }, 1_000);
  showQaToast(state.t.testSessionStarted);
  closeToolsMenu();
}

function renderTestSessionSummary(container, session) {
  const t = state.t;
  const durationLabel = formatElapsed(Date.now() - session.startedAt);
  const httpErrorsDuringSession = state.httpErrors.filter((entry) => entry.capturedAt >= session.startedAt);
  const lastStatus = session.statusPicks.at(-1);
  container.innerHTML = `
    <div class="qts-card">
      <p><b>${escapeHtml(t.testSessionScenario)}</b></p>
      <input type="text" data-session-scenario placeholder="${escapeHtml(t.testSessionScenarioPlaceholder)}" />
      <p style="margin-top:10px"><b>${escapeHtml(t.testSessionContext)}</b><br>
        ${[session.context.client, session.context.project, session.context.product, session.context.environment].filter(Boolean).map(escapeHtml).join(" · ") || escapeHtml(t.testSessionNoContext)}
        <br><small style="word-break:break-all">${escapeHtml(session.context.url)}</small>
      </p>
      <p><b>${escapeHtml(t.testSessionDuration)}</b> ${escapeHtml(durationLabel)}</p>
      <p><b>${escapeHtml(t.testSessionResult)}</b> ${lastStatus ? escapeHtml(lastStatus.label) : escapeHtml(t.testSessionNoResult)}</p>
      <p><b>${escapeHtml(t.testSessionEvidence)}</b> ${session.evidenceCount}</p>
      <p><b>${escapeHtml(stepsCopy().title)}</b> ${(session.stepRecordingIds || []).filter((id) => (state.workspace.stepRecordings || []).some((item) => item.id === id)).length}</p>
      <p><b>${escapeHtml(t.testSessionTechnicalContext)}</b> ${httpErrorsDuringSession.length ? `${httpErrorsDuringSession.length} × ${escapeHtml(t.testSessionHttpErrors)}` : escapeHtml(t.testSessionNoErrors)}</p>
      <label class="qts-field-label">${escapeHtml(t.testSessionNotes)}<textarea data-session-notes rows="3" placeholder="${escapeHtml(t.testSessionNotesPlaceholder)}"></textarea></label>
      <label class="qts-field-label">${escapeHtml(t.testSessionNextSteps)}<textarea data-session-next-steps rows="2" placeholder="${escapeHtml(t.testSessionNextStepsPlaceholder)}"></textarea></label>
      <div class="qts-card-actions">
        <button type="button" class="action" data-session-save>${escapeHtml(t.testSessionSave)}</button>
        <button type="button" class="action" data-session-copy>${escapeHtml(t.testSessionCopy)}</button>
        <button type="button" class="action" data-session-export>${escapeHtml(t.testSessionExport)}</button>
        <button type="button" class="action" data-session-report>${escapeHtml(t.reportCreateFromSession)}</button>
      </div>
    </div>
  `;
  const buildSummaryText = () => {
    const scenario = container.querySelector("[data-session-scenario]").value.trim() || t.testSessionScenarioPlaceholder;
    const notes = container.querySelector("[data-session-notes]").value.trim();
    const nextSteps = container.querySelector("[data-session-next-steps]").value.trim();
    return [
      `# ${scenario}`,
      `${t.testSessionContext} ${[session.context.client, session.context.project, session.context.product, session.context.environment].filter(Boolean).join(" · ") || t.testSessionNoContext}`,
      session.context.url,
      `${t.testSessionDuration} ${durationLabel}`,
      `${t.testSessionResult} ${lastStatus ? lastStatus.label : t.testSessionNoResult}`,
      `${t.testSessionEvidence} ${session.evidenceCount}`,
      `${t.testSessionTechnicalContext} ${httpErrorsDuringSession.length ? `${httpErrorsDuringSession.length} × ${t.testSessionHttpErrors}` : t.testSessionNoErrors}`,
      notes ? `\n${t.testSessionNotes}\n${notes}` : "",
      nextSteps ? `\n${t.testSessionNextSteps}\n${nextSteps}` : "",
    ].filter(Boolean).join("\n");
  };
  container.querySelector("[data-session-copy]").addEventListener("click", () => {
    navigator.clipboard?.writeText(buildSummaryText()).then(() => showQaToast(t.testSessionCopied));
  });
  container.querySelector("[data-session-export]").addEventListener("click", () => {
    const blob = new Blob([buildSummaryText()], { type: "text/markdown" });
    triggerBlobDownload(blob, `${buildEvidenceFileBaseName(lastStatus?.status || null)}_sessao.md`);
  });
  container.querySelector("[data-session-save]").addEventListener("click", async () => {
    const stored = await chrome.storage.local.get(TEST_SESSION_REPORTS_KEY);
    const reports = Array.isArray(stored[TEST_SESSION_REPORTS_KEY]) ? stored[TEST_SESSION_REPORTS_KEY] : [];
    reports.unshift({
      scenario: container.querySelector("[data-session-scenario]").value.trim(),
      context: session.context,
      startedAt: session.startedAt,
      finishedAt: Date.now(),
      result: lastStatus?.status || null,
      evidenceCount: session.evidenceCount,
      httpErrorCount: httpErrorsDuringSession.length,
      notes: container.querySelector("[data-session-notes]").value.trim(),
      nextSteps: container.querySelector("[data-session-next-steps]").value.trim(),
    });
    await chrome.storage.local.set({ [TEST_SESSION_REPORTS_KEY]: reports.slice(0, 100) });
    showQaToast(t.testSessionSaved);
  });
  container.querySelector("[data-session-report]").addEventListener("click", () => {
    const scenario = container.querySelector("[data-session-scenario]").value.trim();
    const notes = container.querySelector("[data-session-notes]").value.trim();
    const recordedSteps = (session.stepRecordingIds || [])
      .map((id) => (state.workspace.stepRecordings || []).find((item) => item.id === id))
      .filter(Boolean)
      .flatMap((recording) => recording.steps || [])
      .map((step, index) => `${index + 1}. ${step.text}`)
      .join("\n");
    openReportBuilder({
      kind: lastStatus?.status === "pass" ? "approval" : lastStatus?.status === "limitation" ? "limitation" : lastStatus?.status === "blocked" ? "blocker" : "bug",
      title: scenario,
      actual: notes,
      steps: recordedSteps,
    }, session.context);
  });
}

function finishTestSession() {
  if (!state.testSession) return;
  const session = state.testSession;
  window.clearInterval(testSessionTimer);
  state.testSession = null;
  state.shadowRoot.getElementById("testSessionBar")?.classList.add("isHidden");
  openDrawer({
    title: state.t.testSessionSummaryTitle,
    bodyHtml: "",
    view: "testSession",
    onReady: (drawerBody) => renderTestSessionSummary(drawerBody, session),
  });
}

// ---------------------------------------------------------------------------
// Report Builder: one structured form for the report kinds a QA session
// actually produces (bug/aprovação/limitação/impedimento/reteste/melhoria/
// risco), instead of writing the same title/steps/expected/actual shape from
// scratch in a chat message every time. Local-only, like Sessão de Teste -
// drafts and templates live in chrome.storage.local, not the workspace.
// ---------------------------------------------------------------------------

const REPORT_DRAFTS_KEY = "qtsReportBuilderDraftsV1";
const REPORT_TEMPLATES_KEY = "qtsReportBuilderTemplatesV1";
const REPORT_FIELD_SELECTORS = {
  kind: "[data-report-kind]", title: "[data-report-title]", description: "[data-report-description]",
  preconditions: "[data-report-preconditions]", steps: "[data-report-steps]", expected: "[data-report-expected]",
  actual: "[data-report-actual]", severity: "[data-report-severity]", priority: "[data-report-priority]", tags: "[data-report-tags]",
};

function reportKindOptions() {
  const t = state.t;
  return [
    { key: "bug", label: t.reportKindBug },
    { key: "approval", label: t.reportKindApproval },
    { key: "limitation", label: t.reportKindLimitation },
    { key: "blocker", label: t.reportKindBlocker },
    { key: "retest", label: t.reportKindRetest },
    { key: "improvement", label: t.reportKindImprovement },
    { key: "risk", label: t.reportKindRisk },
  ];
}

function detectBrowserLabel() {
  const ua = navigator.userAgent || "";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return ua.slice(0, 40) || "-";
}

function openReportBuilder(prefill = {}, context = null) {
  openDrawer({
    title: state.t.reportBuilderTitle,
    bodyHtml: "",
    view: "reportBuilder",
    variant: "modal",
    onReady: (drawerBody) => renderReportBuilder(drawerBody, context || sessionContextSnapshot(), prefill),
  });
}

function renderReportBuilder(container, context, prefill) {
  const t = state.t;
  const kinds = reportKindOptions();
  const contextLine = [context.client, context.project, context.product, context.environment].filter(Boolean).join(" · ") || t.testSessionNoContext;
  const severities = ["low", "medium", "high", "critical"];
  const priorities = ["low", "medium", "high"];
  const severityLabel = { low: t.reportSeverityLow, medium: t.reportSeverityMedium, high: t.reportSeverityHigh, critical: t.reportSeverityCritical };
  const priorityLabel = { low: t.reportPriorityLow, medium: t.reportPriorityMedium, high: t.reportPriorityHigh };
  container.innerHTML = `
    <div class="qts-card">
      <div class="qts-toolbar-row">
        <label class="qts-field-label">${escapeHtml(t.reportKind)}<select data-report-kind>${kinds.map((k) => `<option value="${k.key}" ${prefill.kind === k.key ? "selected" : ""}>${escapeHtml(k.label)}</option>`).join("")}</select></label>
        <label class="qts-field-label" id="reportTemplateField" style="display:none">${escapeHtml(t.reportLoadTemplate)}<select data-report-template><option value="">${escapeHtml(t.reportLoadTemplate)}</option></select></label>
      </div>
      <label class="qts-field-label">${escapeHtml(t.reportTitle)}<input type="text" data-report-title value="${escapeHtml(prefill.title || "")}" placeholder="${escapeHtml(t.reportTitlePlaceholder)}" /></label>
      <label class="qts-field-label">${escapeHtml(t.reportDescription)}<textarea data-report-description rows="2" placeholder="${escapeHtml(t.reportDescriptionPlaceholder)}">${escapeHtml(prefill.description || "")}</textarea></label>
      <label class="qts-field-label">${escapeHtml(t.reportPreconditions)}<textarea data-report-preconditions rows="2" placeholder="${escapeHtml(t.reportPreconditionsPlaceholder)}"></textarea></label>
      <label class="qts-field-label">${escapeHtml(t.reportSteps)}<textarea data-report-steps rows="3" placeholder="${escapeHtml(t.reportStepsPlaceholder)}">${escapeHtml(prefill.steps || "")}</textarea></label>
      <label class="qts-field-label">${escapeHtml(t.reportExpected)}<textarea data-report-expected rows="2"></textarea></label>
      <label class="qts-field-label">${escapeHtml(t.reportActual)}<textarea data-report-actual rows="2">${escapeHtml(prefill.actual || "")}</textarea></label>
      <div class="qts-toolbar-row">
        <label class="qts-field-label">${escapeHtml(t.reportSeverity)}<select data-report-severity>${severities.map((s) => `<option value="${s}">${escapeHtml(severityLabel[s])}</option>`).join("")}</select></label>
        <label class="qts-field-label">${escapeHtml(t.reportPriority)}<select data-report-priority>${priorities.map((p) => `<option value="${p}">${escapeHtml(priorityLabel[p])}</option>`).join("")}</select></label>
      </div>
      <label class="qts-field-label">${escapeHtml(t.reportTags)}<input type="text" data-report-tags placeholder="${escapeHtml(t.reportTagsPlaceholder)}" /></label>
      <p class="qts-status">${escapeHtml(t.reportContext)} ${escapeHtml(contextLine)} · ${escapeHtml(detectBrowserLabel())} · ${window.innerWidth}×${window.innerHeight}<br><small style="word-break:break-all">${escapeHtml(context.url)}</small></p>
      <div class="qts-card-actions">
        <button type="button" class="action" data-report-save-template>${escapeHtml(t.reportSaveTemplate)}</button>
        <button type="button" class="action" data-report-save-draft>${escapeHtml(t.reportSaveDraft)}</button>
        <button type="button" class="action" data-report-copy>${escapeHtml(t.reportCopy)}</button>
        <button type="button" class="action" data-report-copy-slack title="${escapeHtml(t.reportCopySlackHint)}">${escapeHtml(t.reportCopySlack)}</button>
        <button type="button" class="action" data-report-export>${escapeHtml(t.reportExport)}</button>
      </div>
    </div>
  `;
  const field = (name) => container.querySelector(REPORT_FIELD_SELECTORS[name]);
  const readFields = () => Object.fromEntries(Object.keys(REPORT_FIELD_SELECTORS).map((name) => [name, field(name).value.trim()]));
  const applyFields = (values) => {
    for (const name of Object.keys(REPORT_FIELD_SELECTORS)) if (values[name] != null) field(name).value = values[name];
  };

  chrome.storage.local.get(REPORT_TEMPLATES_KEY).then((stored) => {
    const templates = Array.isArray(stored[REPORT_TEMPLATES_KEY]) ? stored[REPORT_TEMPLATES_KEY] : [];
    if (!templates.length) return;
    const templateField = container.querySelector("#reportTemplateField");
    const templateSelect = container.querySelector("[data-report-template]");
    templateField.style.display = "";
    templateSelect.innerHTML = `<option value="">${escapeHtml(t.reportLoadTemplate)}</option>${templates.map((tpl, index) => `<option value="${index}">${escapeHtml(tpl.name)}</option>`).join("")}`;
    templateSelect.addEventListener("change", () => {
      const template = templates[Number(templateSelect.value)];
      if (template) applyFields(template.fields);
      templateSelect.value = "";
    });
  });

  const buildReportText = () => {
    const values = readFields();
    const kindLabel = kinds.find((k) => k.key === values.kind)?.label || values.kind;
    const lines = [
      `# [${kindLabel}] ${values.title || t.reportTitlePlaceholder}`,
      `${t.reportContext} ${contextLine} · ${detectBrowserLabel()} · ${window.innerWidth}×${window.innerHeight}`,
      context.url,
      `${t.reportSeverity}: ${severityLabel[values.severity]} · ${t.reportPriority}: ${priorityLabel[values.priority]}`,
      values.tags ? `${t.reportTags}: ${values.tags}` : "",
      values.description ? `\n${t.reportDescription}\n${values.description}` : "",
      values.preconditions ? `\n${t.reportPreconditions}\n${values.preconditions}` : "",
      values.steps ? `\n${t.reportSteps}\n${values.steps}` : "",
      values.expected ? `\n${t.reportExpected}\n${values.expected}` : "",
      values.actual ? `\n${t.reportActual}\n${values.actual}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  };

  // Slack/Teams mrkdwn uses *single asterisks* for bold and has no header syntax - a Markdown
  // "#"/"**" report pasted as-is shows up littered with literal symbols. No OAuth app, no
  // webhook config: this is the "copiar mensagem formatada" first phase - resolves the common
  // case (paste a well-formatted report into a channel) without needing anyone's Slack/Teams
  // admin to approve an app first.
  const buildSlackText = () => {
    const values = readFields();
    const kindLabel = kinds.find((k) => k.key === values.kind)?.label || values.kind;
    const lines = [
      `*[${kindLabel}] ${values.title || t.reportTitlePlaceholder}*`,
      `${t.reportContext} ${contextLine} · ${detectBrowserLabel()} · ${window.innerWidth}×${window.innerHeight}`,
      context.url,
      `*${t.reportSeverity}:* ${severityLabel[values.severity]}   *${t.reportPriority}:* ${priorityLabel[values.priority]}`,
      values.tags ? `*${t.reportTags}:* ${values.tags}` : "",
      values.description ? `\n*${t.reportDescription}*\n${values.description}` : "",
      values.preconditions ? `\n*${t.reportPreconditions}*\n${values.preconditions}` : "",
      values.steps ? `\n*${t.reportSteps}*\n${values.steps}` : "",
      values.expected ? `\n*${t.reportExpected}*\n${values.expected}` : "",
      values.actual ? `\n*${t.reportActual}*\n${values.actual}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  };

  container.querySelector("[data-report-copy]").addEventListener("click", () => {
    navigator.clipboard?.writeText(buildReportText()).then(() => showQaToast(t.reportCopied));
  });
  container.querySelector("[data-report-copy-slack]").addEventListener("click", () => {
    navigator.clipboard?.writeText(buildSlackText()).then(() => showQaToast(t.reportCopiedSlack));
  });
  container.querySelector("[data-report-export]").addEventListener("click", () => {
    const blob = new Blob([buildReportText()], { type: "text/markdown" });
    triggerBlobDownload(blob, `${buildEvidenceFileBaseName(null)}_relatorio.md`);
  });
  container.querySelector("[data-report-save-draft]").addEventListener("click", async () => {
    const stored = await chrome.storage.local.get(REPORT_DRAFTS_KEY);
    const drafts = Array.isArray(stored[REPORT_DRAFTS_KEY]) ? stored[REPORT_DRAFTS_KEY] : [];
    drafts.unshift({ ...readFields(), context, savedAt: Date.now() });
    await chrome.storage.local.set({ [REPORT_DRAFTS_KEY]: drafts.slice(0, 100) });
    showQaToast(t.reportSaved);
  });
  container.querySelector("[data-report-save-template]").addEventListener("click", async () => {
    const name = prompt(t.reportSaveTemplatePrompt);
    if (!name || !name.trim()) return;
    const stored = await chrome.storage.local.get(REPORT_TEMPLATES_KEY);
    const templates = Array.isArray(stored[REPORT_TEMPLATES_KEY]) ? stored[REPORT_TEMPLATES_KEY] : [];
    const { actual, ...reusableFields } = readFields();
    templates.unshift({ name: name.trim(), fields: reusableFields, savedAt: Date.now() });
    await chrome.storage.local.set({ [REPORT_TEMPLATES_KEY]: templates.slice(0, 50) });
    showQaToast(t.reportTemplateSaved);
  });
}

// ---------------------------------------------------------------------------
// Floating annotations: Pass/Fail markers, text notes and shapes, drawn
// directly on the host page (light DOM) so they can sit over arbitrary page
// content - the toolbar bar itself stays inside the Shadow Root, but these
// need to overlay whatever the tester is pointing at.
// ---------------------------------------------------------------------------

function cancelPlacementMode() {
  if (!state.placementMode) return;
  document.body.classList.remove("qts-placement-mode");
  state.shadowRoot?.querySelectorAll("button.isActive").forEach((button) => button.classList.remove("isActive"));
  state.placementMode = null;
  document.removeEventListener("click", handlePlacementClick, true);
  document.removeEventListener("mousedown", handleShapeMouseDown, true);
  document.removeEventListener("mousedown", handleLineMouseDown, true);
  document.removeEventListener("keydown", handlePlacementEscape, true);
}

async function disableAllActiveTools() {
  cancelPlacementMode();
  if (state.clickSpyActive) deactivateClickSpy();
  if (state.blurSelectionActive) toggleBlurSelectionMode();
  if (state.holofoteActive) disableHolofoteMode();
  if (state.pixelPerfectActive) disablePixelPerfectMode();
  if (state.clockFrozen) document.dispatchEvent(new CustomEvent("qts:freeze-clock-command", { detail: { freeze: false } }));
  if (state.forceHttpActive) document.dispatchEvent(new CustomEvent("qts:force-http-command", { detail: { status: null } }));
  if (state.macroRecording) cancelMacroRecording();
  if (state.stepsRecording) {
    state.stepsRecording.cleanup();
    state.stepsRecording = null;
    updateStepsRecordingUi();
  }
  if (state.testSession) {
    window.clearInterval(testSessionTimer);
    state.testSession = null;
    state.shadowRoot.getElementById("testSessionBar")?.classList.add("isHidden");
  }
  const keyView = getKeyViewPreferences();
  if (keyView.enabled) {
    state.workspace.preferences = { ...(state.workspace.preferences || {}), keyView: { ...keyView, enabled: false } };
    stopKeyView();
    state.workspace = await saveWorkspace(state.workspace);
  }
  closeDrawer();
  closeToolsMenu();
  syncModeShortcutStates();
  showQaToast("Todas as ferramentas ativas foram desativadas.");
}

function handlePlacementEscape(event) {
  if (event.key === "Escape") cancelPlacementMode();
}

// shapeType is only meaningful for mode "shape" - it's the Formato the user already picked from
// the shape-type menu (rectangle/square/circle), applied immediately on drop instead of defaulting
// to rectangle and making the user reopen the style editor just to fix the shape they already chose.
let pendingShapeType = "rectangle";

function enablePlacementMode(mode, triggerButton, shapeType) {
  // The active shortcut is also its cancel button. The old order cleared the state first and
  // immediately armed the same mode again, making a second click appear to do nothing.
  if (state.placementMode === mode && triggerButton?.classList.contains("isActive")) {
    cancelPlacementMode();
    return false;
  }
  cancelPlacementMode();
  state.placementMode = mode;
  if (mode === "shape") pendingShapeType = shapeType || "rectangle";
  document.body.classList.add("qts-placement-mode");
  triggerButton.classList.add("isActive");
  document.addEventListener("keydown", handlePlacementEscape, true);
  if (mode === "shape") document.addEventListener("mousedown", handleShapeMouseDown, true);
  else if (mode === "line") document.addEventListener("mousedown", handleLineMouseDown, true);
  else document.addEventListener("click", handlePlacementClick, true);
  return true;
}

function hasAnyActiveTool() {
  return Boolean(
    state.placementMode
    || state.clickSpyActive
    || state.blurSelectionActive
    || state.holofoteActive
    || state.pixelPerfectActive
    || state.clockFrozen
    || state.forceHttpActive
    || state.macroRecording
    || state.stepsRecording
    || getKeyViewPreferences().enabled
  );
}

// Founder feedback: Linha used to be a separate pinned button; it now lives inside the same
// "Forma" entry point as a 4th choice (alongside Retângulo/Quadrado/Círculo) in a small popover,
// so drawing starts immediately with the right shape already picked instead of drawing a rectangle
// and fixing the type afterward in the style editor.
function toggleShapeTypeMenu(forceOpen) {
  const menu = state.shadowRoot?.getElementById("shapeTypeMenu");
  if (!menu) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : menu.classList.contains("isHidden");
  menu.classList.toggle("isHidden", !shouldOpen);
}

function isInsideToolbarUi(target) {
  return Boolean(target.closest?.(`#${HOST_ID}, .qts-floating-item, .qts-modal-backdrop, .qts-clickspy-tooltip`));
}

const MARKER_KINDS = new Set(["pass", "fail", "warning", "question"]);

function handlePlacementClick(event) {
  if (isInsideToolbarUi(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  if (MARKER_KINDS.has(state.placementMode)) {
    placeMarker(state.placementMode, event.clientX, event.clientY);
  }
  cancelPlacementMode();
}

// Founder feedback (requested earlier, never shipped): edit/remove/resize used to sit exposed on
// every marker/note/shape at all times, cluttering the page and getting in the way of screenshots.
// Now only this small eye toggle is always visible; it reveals the rest of the controls - plus a
// "hide element" button that blanks the annotation's own content (not the controls) so a clean
// screenshot can be taken without deleting the annotation - on demand.
function visibilityControlsHtml() {
  const t = state.t;
  return `<button type="button" class="qts-visibility-btn" data-visibility-toggle title="${escapeHtml(t.showControls)}" aria-label="${escapeHtml(t.showControls)}">${ICON("eye")}</button>`;
}

function wireVisibilityControls(item) {
  const t = state.t;
  const visibilityBtn = item.querySelector("[data-visibility-toggle]");
  let idleTimer = 0;
  const wakeEye = () => {
    window.clearTimeout(idleTimer);
    item.classList.add("isEyeAwake");
    idleTimer = window.setTimeout(() => item.classList.remove("isEyeAwake"), 1_800);
  };
  // The eye is discoverable when an annotation is created, then gets out of the screenshot's way.
  // Hover/focus is handled in CSS so it stays visible for the entire interaction; these listeners
  // additionally cover touch/pen presses and clicks on the annotation itself.
  wakeEye();
  item.addEventListener("pointerdown", wakeEye);
  item.addEventListener("pointermove", wakeEye, { passive: true });
  item.addEventListener("focusin", wakeEye);
  visibilityBtn.addEventListener("click", () => {
    wakeEye();
    const visible = item.classList.toggle("isControlsVisible");
    visibilityBtn.innerHTML = ICON(visible ? "eyeSlash" : "eye");
    visibilityBtn.title = visible ? t.hideControls : t.showControls;
    visibilityBtn.setAttribute("aria-label", visibilityBtn.title);
  });
}

const MARKER_KIND_CLASS = { pass: "isPass", fail: "isFail", warning: "isWarning", question: "isQuestion" };

function placeMarker(kind, clientX, clientY) {
  const size = 24;
  const marker = document.createElement("div");
  marker.className = "qts-floating-item qts-marker";
  marker.style.left = `${Math.max(4, clientX - size / 2)}px`;
  marker.style.top = `${Math.max(getCurrentHeight() + 4, clientY - size / 2)}px`;
  marker.style.width = `${size}px`;
  marker.style.height = `${size}px`;
  marker.innerHTML = `
    <div class="qts-marker-body ${MARKER_KIND_CLASS[kind] || "isPass"}" data-drag-handle>${ICON(kind)}</div>
    ${visibilityControlsHtml()}
    <button type="button" class="qts-remove-btn" title="${escapeHtml(state.t.remove)}">${ICON("fail")}</button>
    <div class="qts-resize-handle" data-resize-handle title="${escapeHtml(state.t.resize)}">${ICON("resize")}</div>
  `;
  document.body.appendChild(marker);
  wireVisibilityControls(marker);
  makeDraggable(marker, marker.querySelector("[data-drag-handle]"));
  // minWidth/minHeight must be large enough that the eye toggle (top-left) and resize handle
  // At compact sizes the control badges reflow vertically through the marker's container query.
  makeResizable(marker, marker.querySelector("[data-resize-handle]"), { minWidth: 24, minHeight: 24, lockAspectRatio: true });
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
    <button type="button" class="qts-remove-btn" title="${escapeHtml(t.remove)}">${ICON("fail")}</button>
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
    <div class="qts-editor-head" data-drag-handle><span>${escapeHtml(t.noteHeader)}</span><button type="button" class="qts-remove-btn" title="${escapeHtml(t.remove)}">${ICON("fail")}</button></div>
    <div class="qts-editor-body">
      <textarea placeholder="${escapeHtml(t.notePlaceholder)}"></textarea>
      <div class="qts-note-style-row">
        <label>${escapeHtml(t.noteColor)}<input type="color" data-note-color /></label>
        <label>${escapeHtml(t.noteFontSize)}<input type="range" min="11" max="28" data-note-size /></label>
        <label>${escapeHtml(t.noteBackground)}<select data-note-bg>
          <option value="translucent" ${safeBackground === "translucent" ? "selected" : ""}>${escapeHtml(t.noteBackgroundTranslucent)}</option>
          <option value="solid" ${safeBackground === "solid" ? "selected" : ""}>${escapeHtml(t.noteBackgroundSolid)}</option>
          <option value="none" ${safeBackground === "none" ? "selected" : ""}>${escapeHtml(t.noteBackgroundNone)}</option>
        </select></label>
      </div>
      <div class="qts-editor-actions"><button type="button" data-save>${escapeHtml(t.save)}</button></div>
    </div>
  `;
  // Page-derived text must remain text, never markup.
  note.querySelector("textarea").value = String(currentText || "");
  note.querySelector("[data-note-color]").value = safeColor;
  note.querySelector("[data-note-size]").value = String(safeFontSize);
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
  shape.dataset.shapeType = pendingShapeType;
  shape.innerHTML = `
    <div class="qts-shape-box" data-drag-handle></div>
    ${visibilityControlsHtml()}
    <button type="button" class="qts-edit-btn" title="${escapeHtml(state.t.edit)}">${ICON("edit")}</button>
    <button type="button" class="qts-remove-btn" title="${escapeHtml(state.t.remove)}">${ICON("fail")}</button>
    <div class="qts-resize-handle hasEditButton" data-resize-handle title="${escapeHtml(state.t.resize)}">${ICON("resize")}</div>
  `;
  document.body.appendChild(shape);
  wireVisibilityControls(shape);
  makeDraggable(shape, shape.querySelector("[data-drag-handle]"));
  // Shapes carry an extra edit button (pushes the resize handle further right, see
  // .hasEditButton), so they need more headroom than markers before the eye toggle (top-left)
  // and resize handle (top-right) start to overlap -- 30px let the box shrink well past that.
  makeResizable(shape, shape.querySelector("[data-resize-handle]"), { minWidth: 80, minHeight: 80 });
  shape.querySelector(".qts-remove-btn").addEventListener("click", () => { shape.remove(); updateClearAllVisibility(); });
  shape.querySelector(".qts-edit-btn").addEventListener("click", () => toggleShapeStyleEditor(shape));
  // Applies the Formato already picked from the shape-type menu right away - the user shouldn't
  // have to reopen the style editor just to set the type they already chose before drawing.
  const box = shape.querySelector(".qts-shape-box");
  const isSquarish = pendingShapeType === "square" || pendingShapeType === "circle";
  if (isSquarish) {
    const size = Math.max(30, Math.min(shape.offsetWidth, shape.offsetHeight));
    shape.style.width = `${size}px`;
    shape.style.height = `${size}px`;
  }
  box.style.setProperty("--qts-shape-radius", pendingShapeType === "circle" ? "50%" : isSquarish ? "0px" : "8px");
  updateClearAllVisibility();
}

// Founder request: shapes needed a real square/circle option (not just "rectangle with rounded
// corners") and a way to blur a sensitive area instead of just outlining/filling it with a color
// (e.g. hiding a real customer name in a screenshot). Both live in the same style popover as the
// existing color controls -- "Formato" picks the box's proportions/radius, "Efeito" swaps the
// color inputs for a blur-strength slider (backdrop-filter, so it blurs whatever's underneath,
// not just tints it).
function toggleShapeStyleEditor(shape) {
  const existing = shape.querySelector(".qts-shape-editor");
  if (existing) { existing.remove(); return; }
  const t = state.t;
  const box = shape.querySelector(".qts-shape-box");
  const editor = document.createElement("div");
  editor.className = "qts-shape-editor";
  editor.innerHTML = `
    <label>${escapeHtml(t.shapeEditorType)}<select data-shape-type>
      <option value="rectangle">${escapeHtml(t.shapeTypeRectangle)}</option>
      <option value="square">${escapeHtml(t.shapeTypeSquare)}</option>
      <option value="circle">${escapeHtml(t.shapeTypeCircle)}</option>
    </select></label>
    <label>${escapeHtml(t.shapeEditorEffect)}<select data-shape-effect>
      <option value="color">${escapeHtml(t.shapeEffectColor)}</option>
      <option value="blur">${escapeHtml(t.shapeEffectBlur)}</option>
    </select></label>
    <div data-shape-color-controls>
      <label>${escapeHtml(t.shapeEditorBorderColor)}<input type="color" data-shape-border value="#ef3340" /></label>
      <label>${escapeHtml(t.shapeEditorFillColor)}<input type="color" data-shape-fill value="#ef3340" /></label>
      <label>${escapeHtml(t.shapeEditorOpacity)}<input type="range" min="20" max="100" value="100" data-shape-opacity /></label>
    </div>
    <label data-shape-blur-control hidden>${escapeHtml(t.shapeEditorBlurStrength)}<input type="range" min="2" max="24" value="10" data-shape-blur /></label>
    <label data-shape-radius-control>${escapeHtml(t.shapeEditorRadius)}<input type="range" min="0" max="48" value="8" data-shape-radius /></label>
    <div class="qts-editor-actions"><button type="button" data-save>${escapeHtml(t.save)}</button></div>
  `;
  shape.appendChild(editor);
  editor.querySelector("[data-shape-type]").value = shape.dataset.shapeType || "rectangle";
  editor.querySelector("[data-save]").addEventListener("click", () => editor.remove());
  const apply = () => {
    const type = editor.querySelector("[data-shape-type]").value;
    shape.dataset.shapeType = type;
    const effect = editor.querySelector("[data-shape-effect]").value;
    const isSquarish = type === "square" || type === "circle";
    if (isSquarish) {
      const size = Math.max(30, Math.min(shape.offsetWidth, shape.offsetHeight));
      shape.style.width = `${size}px`;
      shape.style.height = `${size}px`;
    }
    box.style.setProperty("--qts-shape-radius", type === "circle" ? "50%" : isSquarish ? "0px" : `${editor.querySelector("[data-shape-radius]").value}px`);
    editor.querySelector("[data-shape-radius-control]").hidden = isSquarish;
    editor.querySelector("[data-shape-color-controls]").hidden = effect === "blur";
    editor.querySelector("[data-shape-blur-control]").hidden = effect !== "blur";
    if (effect === "blur") {
      const strength = editor.querySelector("[data-shape-blur]").value;
      box.style.setProperty("--qts-shape-blur", `blur(${strength}px)`);
      box.style.setProperty("--qts-shape-bg", "rgba(0,0,0,.05)");
      box.style.setProperty("--qts-shape-border", "2px dashed rgba(255,255,255,.6)");
      box.style.setProperty("--qts-shape-opacity", "1");
    } else {
      const borderColor = editor.querySelector("[data-shape-border]").value;
      const fillColor = editor.querySelector("[data-shape-fill]").value;
      const opacity = Number(editor.querySelector("[data-shape-opacity]").value) / 100;
      box.style.setProperty("--qts-shape-blur", "none");
      box.style.setProperty("--qts-shape-border", `3px solid ${borderColor}`);
      box.style.setProperty("--qts-shape-bg", hexToRgba(fillColor, 0.15));
      box.style.setProperty("--qts-shape-opacity", String(opacity));
    }
  };
  editor.querySelectorAll("input, select").forEach((input) => input.addEventListener("input", apply));
  apply();
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16) || 0;
  const g = parseInt(normalized.slice(2, 4), 16) || 0;
  const b = parseInt(normalized.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

// A line is created from two literal points (not a drag-to-size box like Shapes), so it gets its
// own placement mode. The outer floating-item stays axis-aligned (so its edit/remove/visibility
// controls stay readable) sized to the straight-line distance; only the inner bar rotates around
// its own left edge to point at the second click point, with an optional arrowhead at that end.
function handleLineMouseDown(event) {
  if (event.button !== 0 || isInsideToolbarUi(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const preview = document.createElement("div");
  preview.className = "qts-line-preview";
  preview.style.left = `${startX}px`;
  preview.style.top = `${startY}px`;
  document.body.appendChild(preview);
  const updatePreview = (endX, endY) => {
    const length = Math.hypot(endX - startX, endY - startY);
    const angle = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);
    preview.style.width = `${length}px`;
    preview.style.transform = `rotate(${angle}deg)`;
  };
  const handleMove = (moveEvent) => updatePreview(moveEvent.clientX, moveEvent.clientY);
  const handleUp = (upEvent) => {
    document.removeEventListener("mousemove", handleMove, true);
    document.removeEventListener("mouseup", handleUp, true);
    preview.remove();
    placeLine(startX, startY, upEvent.clientX, upEvent.clientY);
    cancelPlacementMode();
  };
  document.addEventListener("mousemove", handleMove, true);
  document.addEventListener("mouseup", handleUp, true);
}

function placeLine(startX, startY, endX, endY) {
  const length = Math.max(24, Math.hypot(endX - startX, endY - startY));
  const angle = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);
  const hitHeight = 24;
  const line = document.createElement("div");
  line.className = "qts-floating-item qts-line hasArrow";
  line.style.left = `${startX}px`;
  line.style.top = `${startY - hitHeight / 2}px`;
  line.style.width = `${length}px`;
  line.style.height = `${hitHeight}px`;
  line.style.setProperty("--qts-line-angle", `${angle}deg`);
  line.innerHTML = `
    <div class="qts-line-bar" data-drag-handle>
      <div class="qts-line-resize-handle" data-resize-handle title="${escapeHtml(state.t.resize)}"></div>
    </div>
    ${visibilityControlsHtml()}
    <button type="button" class="qts-edit-btn" title="${escapeHtml(state.t.edit)}">${ICON("edit")}</button>
    <button type="button" class="qts-remove-btn" title="${escapeHtml(state.t.remove)}">${ICON("fail")}</button>
  `;
  document.body.appendChild(line);
  wireVisibilityControls(line);
  makeDraggable(line, line.querySelector("[data-drag-handle]"));
  makeLineResizable(line, line.querySelector("[data-resize-handle]"));
  line.querySelector(".qts-remove-btn").addEventListener("click", () => { line.remove(); updateClearAllVisibility(); });
  line.querySelector(".qts-edit-btn").addEventListener("click", () => toggleLineStyleEditor(line));
  updateClearAllVisibility();
}

function lineEndpointIcon(value, side) {
  const isStart = side === "start";
  const endpointX = isStart ? 6 : 30;
  const marker = {
    none: "",
    arrow: isStart
      ? '<path d="M10 3 4 8l6 5" fill="none"/>'
      : '<path d="m26 3 6 5-6 5" fill="none"/>',
    triangle: isStart
      ? '<path d="M3 8 11 2.5v11z" class="qts-line-endpoint-fill"/>'
      : '<path d="m33 8-8-5.5v11z" class="qts-line-endpoint-fill"/>',
    dotFilled: `<circle cx="${endpointX}" cy="8" r="4" class="qts-line-endpoint-fill"/>`,
    dotHollow: `<circle cx="${endpointX}" cy="8" r="4" fill="none"/>`,
  }[value] || "";
  return `<svg class="qts-line-endpoint-icon" viewBox="0 0 36 16" aria-hidden="true" focusable="false"><path d="M6 8h24" fill="none"/>${marker}</svg>`;
}

function lineEndpointOptions(side, label, selected, t) {
  const options = [
    ["none", t.lineArrowNone],
    ["arrow", t.lineArrowArrow],
    ["triangle", t.lineArrowTriangle],
    ["dotFilled", t.lineArrowDotFilled],
    ["dotHollow", t.lineArrowDotHollow],
  ];
  return `<fieldset class="qts-line-endpoint-field"><legend>${escapeHtml(label)}</legend><div class="qts-line-endpoint-options">${options.map(([value, text]) => `<label title="${escapeHtml(text)}"><input type="radio" name="line-${side}" value="${value}" aria-label="${escapeHtml(text)}" ${value === selected ? "checked" : ""}/><span>${lineEndpointIcon(value, side)}</span></label>`).join("")}</div></fieldset>`;
}

function toggleLineStyleEditor(line) {
  const existing = line.querySelector(".qts-shape-editor");
  if (existing) { existing.remove(); return; }
  const t = state.t;
  const bar = line.querySelector(".qts-line-bar");
  const editor = document.createElement("div");
  editor.className = "qts-shape-editor";
  editor.innerHTML = `
    <label>${escapeHtml(t.shapeEditorBorderColor)}<input type="color" data-line-color value="#ef3340" /></label>
    <label>${escapeHtml(t.lineThickness)}<input type="range" min="1" max="10" value="3" data-line-thickness /></label>
    ${lineEndpointOptions("start", t.lineArrowStart || "Ponta esquerda", "none", t)}
    ${lineEndpointOptions("end", t.lineArrowEnd || "Ponta direita", "arrow", t)}
    <div class="qts-editor-actions"><button type="button" data-save>${escapeHtml(t.save)}</button></div>
  `;
  line.appendChild(editor);
  const endClasses = ["hasArrow", "hasTriangle", "hasDotFilled", "hasDotHollow"];
  const startClasses = ["startHasArrow", "startHasTriangle", "startHasDotFilled", "startHasDotHollow"];
  const endClassByValue = { arrow: "hasArrow", triangle: "hasTriangle", dotFilled: "hasDotFilled", dotHollow: "hasDotHollow" };
  const startClassByValue = { arrow: "startHasArrow", triangle: "startHasTriangle", dotFilled: "startHasDotFilled", dotHollow: "startHasDotHollow" };
  const valueFromClasses = (classes, mapping) => Object.entries(mapping).find(([, className]) => classes.contains(className))?.[0] || "none";
  editor.querySelector(`[name="line-start"][value="${valueFromClasses(line.classList, startClassByValue)}"]`).checked = true;
  editor.querySelector(`[name="line-end"][value="${valueFromClasses(line.classList, endClassByValue)}"]`).checked = true;
  const apply = () => {
    const color = editor.querySelector("[data-line-color]").value;
    const thickness = editor.querySelector("[data-line-thickness]").value;
    const start = editor.querySelector('[name="line-start"]:checked').value;
    const end = editor.querySelector('[name="line-end"]:checked').value;
    bar.style.setProperty("--qts-line-color", color);
    bar.style.setProperty("--qts-line-thickness", `${thickness}px`);
    line.classList.remove(...startClasses, ...endClasses);
    if (startClassByValue[start]) line.classList.add(startClassByValue[start]);
    if (endClassByValue[end]) line.classList.add(endClassByValue[end]);
  };
  editor.querySelectorAll("input").forEach((input) => input.addEventListener("input", apply));
  editor.querySelector("[data-save]").addEventListener("click", () => editor.remove());
  apply();
}

function makeDraggable(element, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  handle.addEventListener("mousedown", (event) => {
    // Excludes anything interactive that can legitimately sit on top of/inside the drag handle
    // (the shape style editor's inputs, in particular) - a mousedown that starts on a real
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
    // A bare getCurrentHeight() clamp (no gap) let an item land flush against the bar's bottom
    // edge - the bar itself sits at the very top of the z-index stack (see #bar below), so a
    // flush item's own drag handle could end up hairline-overlapped and un-grabbable on the next
    // attempt ("fica colado", per founder feedback). A few px of buffer keeps a real gap.
    element.style.top = `${Math.max(getCurrentHeight() + 6, event.clientY - offsetY)}px`;
  });
  document.addEventListener("mouseup", () => { dragging = false; });
}

// Shared SE-corner drag-resize for markers/shapes/notes - one consistent resize gesture across
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
    // stadium/oval) - locking width===height here is what keeps the shape an actual circle
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

// Lines don't fit the SE-corner resize above (there's no fixed box, just a start point + length +
// angle) - dragging this handle (sitting at the line's own endpoint, rotating with the bar) keeps
// the start point fixed and recomputes length/angle from it, the same math placeLine used to draw
// it in the first place.
function makeLineResizable(line, handle) {
  let resizing = false;
  const hitHeight = 24;
  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    resizing = true;
    event.preventDefault();
    event.stopPropagation();
  });
  document.addEventListener("mousemove", (event) => {
    if (!resizing) return;
    const startX = parseFloat(line.style.left) || 0;
    const startY = (parseFloat(line.style.top) || 0) + hitHeight / 2;
    const length = Math.max(24, Math.hypot(event.clientX - startX, event.clientY - startY));
    const angle = Math.atan2(event.clientY - startY, event.clientX - startX) * (180 / Math.PI);
    line.style.width = `${length}px`;
    line.style.setProperty("--qts-line-angle", `${angle}deg`);
  });
  document.addEventListener("mouseup", () => { resizing = false; });
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

async function captureScreenshot() {
  const statusKey = await resolveRecentStatusKeyForCurrentPage();
  chrome.runtime.sendMessage({ type: "qts:capture-visible-tab" }, (response) => {
    if (!response?.ok) {
      console.error("QA Toolbar Sandbox: screenshot failed", response?.error);
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = response.dataUrl;
    anchor.download = `${buildEvidenceFileBaseName(statusKey)}.png`;
    anchor.click();
  });
}

// ---------------------------------------------------------------------------
// Generic drawer/modal helpers (rendered inside the Shadow Root - unlike
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
    .qts-drawer { --qts-panel:#0b0b0b; --qts-panel-2:#141414; --qts-panel-text:#fff; --qts-panel-muted:#aaa; --qts-panel-border:#333; --qts-panel-accent:var(--qts-ui-primary, #ffd700); }
    :host([data-theme="light"]) .qts-drawer { --qts-panel:#fff; --qts-panel-2:#f2f4f8; --qts-panel-text:#171a24; --qts-panel-muted:#58647a; --qts-panel-border:#b8c2d3; --qts-panel-accent:var(--qts-ui-primary, #5b35e8); }
    @media (prefers-color-scheme: light) { :host([data-theme="system"]) .qts-drawer { --qts-panel:#fff; --qts-panel-2:#f2f4f8; --qts-panel-text:#171a24; --qts-panel-border:#cbd3e2; } }
    .qts-drawer-backdrop {
      position: fixed; inset: 0; z-index: 2147483647; display: flex; justify-content: flex-end;
      background: rgba(0,0,0,.5); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .qts-drawer {
      container-type:inline-size; position:relative; width: min(480px, 92vw); height: 100%; background: var(--qts-panel,#0b0b0b); color: var(--qts-panel-text,#fff); border-left: 2px solid var(--qts-ui-primary, #b20808);
      display: flex; flex-direction: column; box-shadow: -18px 0 40px rgba(0,0,0,.4); resize: both; overflow: hidden;
    }
    .qts-drawer-backdrop[data-position="left"] { justify-content:flex-start; }
    .qts-drawer-backdrop[data-position="left"] .qts-drawer { border-left:0; border-right:2px solid var(--qts-ui-primary); box-shadow:18px 0 40px rgba(0,0,0,.4); }
    .qts-drawer-backdrop[data-position="top"] { align-items:flex-start; }
    .qts-drawer-backdrop[data-position="bottom"] { align-items:flex-end; }
    .qts-drawer-backdrop[data-position="top"] .qts-drawer,
    .qts-drawer-backdrop[data-position="bottom"] .qts-drawer { width:100%; height:min(420px,70vh); border-left:0; }
    .qts-drawer-backdrop[data-position="top"] .qts-drawer { border-bottom:2px solid var(--qts-ui-primary); }
    .qts-drawer-backdrop[data-position="bottom"] .qts-drawer { border-top:2px solid var(--qts-ui-primary); }
    .qts-drawer-backdrop.isPinned { pointer-events:none; background:transparent; }
    .qts-drawer-backdrop.isPinned .qts-drawer { pointer-events:auto; }
    .qts-drawer.isMinimized { height:58px !important; min-height:58px; resize:none; }
    .qts-drawer.isMinimized .qts-drawer-search, .qts-drawer.isMinimized .qts-drawer-body { display:none; }
    /* Macro Studio's founder feedback: a right-edge sidebar felt cramped/ugly for something with
       a palette + flow builder + code view - this variant centers the same #drawerBody markup in
       a proper modal instead, reusing every existing style/handler inside it unchanged. */
    .qts-drawer-backdrop.isModal { justify-content: center; align-items: center; padding: 16px; }
    .qts-drawer-backdrop.isModal .qts-drawer {
      width: min(920px, 94vw); height: min(760px, 90vh); border-left: 0; border-radius: 16px;
      border: 1px solid #292929; box-shadow: 0 30px 80px rgba(0,0,0,.55);
    }
    .qts-drawer-backdrop.isDetached {
      width:100vw; height:100vh; height:100dvh; min-width:0; min-height:0; padding:0;
      align-items:stretch; justify-content:stretch; overflow:hidden; background:var(--qts-panel,#0b0b0b);
    }
    .qts-drawer-backdrop.isDetached .qts-drawer {
      box-sizing:border-box; flex:1 1 auto; width:100%; min-width:0; max-width:none;
      height:100%; min-height:0; max-height:none; border:0; border-radius:0; box-shadow:none; resize:none;
    }
    .qts-drawer-backdrop.isDetached .qts-drawer-head { flex:0 0 auto; }
    .qts-drawer-backdrop.isDetached .qts-drawer-body {
      width:100%; min-width:0; min-height:0; max-width:100%; overflow:auto; overscroll-behavior:contain;
    }
    .qts-drawer-head { display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid var(--qts-panel-border,#262626); background:var(--qts-panel,#fff); }
    .qts-drawer-title { min-width:0; flex:1 1 180px; display:grid; gap:2px; }
    .qts-drawer-head h2 { margin:0; font-size:15px; line-height:1.25; min-width:0; overflow-wrap:anywhere; }
    .qts-drawer-kicker { color:var(--qts-panel-muted); font-size:10px; font-weight:650; }
    .qts-drawer-controls {
      position:static; z-index:8; min-width:0; display:flex; flex:0 0 auto;
      align-items:center; justify-content:flex-end; gap:6px; margin-left:auto;
    }
    .qts-drawer-head button { width:34px; height:34px; border:0; border-radius:9px; background:var(--qts-ui-primary,#2563eb); color:var(--qts-ui-primary-contrast,#fff); font-size:18px; cursor:pointer; flex:none; }
    .qts-drawer-head button { display:inline-flex; align-items:center; justify-content:center; padding:0; }
    .qts-drawer-head #drawerClose { background:#c70e0e; color:#fff; }
    .qts-drawer-position { width:auto; display:flex; gap:3px; flex:none; }
    .qts-drawer-head .qts-drawer-position-btn {
      width:22px; height:22px; min-width:0; padding:0; border:1px solid var(--qts-panel-border,#262626);
      border-radius:6px; background:transparent; color:var(--qts-panel-muted);
    }
    .qts-drawer-head .qts-drawer-position-btn[aria-pressed="true"] {
      color:var(--qts-ui-primary,#2563eb); border-color:var(--qts-ui-primary,#2563eb);
      background:color-mix(in srgb, var(--qts-ui-primary,#2563eb) 14%, transparent);
    }
    @container (max-width: 430px) {
      .qts-drawer-head { flex-wrap:wrap; align-items:center; }
      .qts-drawer-title { flex:1 1 calc(100% - 44px); }
      .qts-drawer-controls { justify-content:flex-end; }
      .qts-drawer-position { margin-right:auto; }
      .qts-drawer-head button { width:36px; height:36px; }
    }
    .qts-drawer-search { padding:8px 12px; border-bottom:1px solid var(--qts-panel-border); }
    .qts-drawer-resize { position:absolute; z-index:3; }
    .qts-drawer-resize[data-edge="left"], .qts-drawer-resize[data-edge="right"] { top:0; bottom:0; width:8px; cursor:ew-resize; }
    .qts-drawer-resize[data-edge="left"] { left:-4px; } .qts-drawer-resize[data-edge="right"] { right:-4px; }
    .qts-drawer-resize[data-edge="top"], .qts-drawer-resize[data-edge="bottom"] { left:0; right:0; height:8px; cursor:ns-resize; }
    .qts-drawer-resize[data-edge="top"] { top:-4px; } .qts-drawer-resize[data-edge="bottom"] { bottom:-4px; }
    .qts-drawer-head #drawerBack { background: var(--qts-panel-surface-2,#171717); color: inherit; font-size: 15px; }
    .qts-drawer-body { flex:1; min-width:0; overflow:auto; padding:14px 16px; }
    .qts-drawer-footer-actions {
      position:sticky; bottom:-14px; z-index:7; display:grid; grid-template-columns:1fr; gap:8px;
      margin:18px -16px -14px; padding:10px 12px;
      border-top:1px solid var(--qts-panel-border); background:var(--qts-panel);
    }
    .qts-drawer-footer-actions:empty { display:none; }
    .qts-drawer-footer-actions:has(> :nth-child(2):last-child) { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .qts-drawer-footer-actions:has(> :nth-child(3):last-child) { grid-template-columns:1fr; }
    .qts-drawer-footer-actions > button { width:100%; min-height:40px; }
    .qts-drawer-body > *, .qts-card > *, .qts-list-row > * { min-width:0; max-width:100%; }
    .qts-drawer-body :is(h1,h2,h3,h4,p,small,b,label,span) { overflow-wrap:anywhere; }
    .qts-drawer input, .qts-drawer select, .qts-drawer textarea {
      box-sizing:border-box; width:100%; min-height:40px; padding:8px 10px; border:1px solid var(--qts-panel-border,#2c2c2c); border-radius:8px; background:var(--qts-panel-2,#141414); color:var(--qts-panel-text,#fff); font:inherit; line-height:1.35;
    }
    .qts-drawer textarea { height:auto; }
    .qts-drawer button { line-height:1.25; }
    .qts-drawer :is(p,small,b,label,span,button,option) { overflow-wrap:anywhere; }
    .qts-drawer input[type="checkbox"] {
      -webkit-appearance:none; appearance:none; box-sizing:border-box;
      width:38px !important; min-width:38px !important; max-width:38px !important;
      height:22px !important; min-height:22px !important; max-height:22px !important;
      margin:0; padding:0; border:1px solid var(--qts-panel-border); border-radius:999px;
      background:var(--qts-panel-border); position:relative; cursor:pointer; vertical-align:middle; flex:none;
    }
    .qts-drawer input[type="checkbox"]::after {
      content:""; position:absolute; width:16px; height:16px; left:2px; top:2px; border-radius:50%;
      background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.35); transition:transform 140ms ease;
    }
    .qts-drawer input[type="checkbox"]:checked { background:var(--qts-ui-primary,#2563eb); }
    .qts-drawer input[type="checkbox"]:checked::after { transform:translateX(16px); }
    .qts-drawer button.action { min-height: 40px; padding: 0 14px; border: 1px solid var(--qts-panel-border,#333); border-radius: 8px; background: var(--qts-panel-2,#1c1c1c); color: var(--qts-panel-text,#fff); cursor: pointer; font-weight: 800; }
    .qts-drawer button.action.primary { background: var(--qts-ui-primary, #b20808); border-color: var(--qts-ui-primary, #b20808); color: var(--qts-ui-primary-contrast, #fff); }
    .qts-empty { padding: 24px; text-align: center; color: var(--qts-panel-muted); border: 1px dashed var(--qts-panel-border); border-radius: 10px; }
    .qts-net-item { padding: 8px 10px; margin-bottom: 6px; border: 1px solid var(--qts-panel-border); border-radius: 8px; background: var(--qts-panel-2); cursor: pointer; }
    .qts-net-item b { color: var(--qts-panel-accent); }
    .qts-net-item small { display: block; color: var(--qts-panel-muted); word-break: break-all; }
    .qts-json-tree { font: 11px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
    .qts-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--qts-panel-2); border: 1px solid var(--qts-panel-border); font-size: 10px; color: var(--qts-panel-text); }
    .qts-chip b { color: var(--qts-panel-accent); font-weight: 800; }

    /* Toolbar shared by every data-listing drawer: search + smart filters + collapse-to-minimal. */
    .qts-toolbar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .qts-toolbar-row input[type="search"] { flex: 1 1 160px; min-width: 0; }
    .qts-icon-btn { width: 32px; height: 32px; padding: 0; border: 1px solid #333; border-radius: 8px; background: #1c1c1c; color: #fff; cursor: pointer; flex: 0 0 auto; }
    .qts-icon-btn:hover { border-color: var(--qts-panel-accent, #ffd700); }
    .qts-filter-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .qts-filter-bar.isCollapsed { display: none; }
    .qts-toggle-group { display: inline-flex; gap: 4px; padding: 3px; border: 1px solid #262626; border-radius: 8px; background: #131313; }
    .qts-toggle-group button { height: 26px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; color: #ccc; font-size: 11px; font-weight: 700; cursor: pointer; }
    .qts-toggle-group button.isSelected { background: var(--qts-ui-primary, #b20808); color: var(--qts-ui-primary-contrast, #fff); }
    .qts-combo { position: relative; border: 1px solid #262626; border-radius: 8px; background: #131313; }
    .qts-combo summary { list-style: none; padding: 5px 10px; font-size: 11px; font-weight: 700; cursor: pointer; color: #ddd; }
    .qts-combo summary::-webkit-details-marker { display: none; }
    .qts-combo summary .qts-combo-count { color: var(--qts-panel-accent, #ffd700); }
    .qts-combo[open] > .qts-combo-panel { display: flex; }
    .qts-combo-panel {
      display: none; flex-direction: column; gap: 6px; position: absolute; top: 34px; left: 0; z-index: 100;
      width: max(220px, 100%); max-height: 260px; padding: 8px; border: 1px solid #333; border-radius: 8px;
      background: #101010; box-shadow: 0 12px 30px rgba(0,0,0,.5); overflow: auto;
    }
    .qts-drawer-backdrop[data-position="bottom"] .qts-combo-panel,
    .qts-drawer-backdrop[data-position="bottom"] .qts-dropdown-panel {
      top:auto; bottom:calc(100% + 6px);
    }
    .qts-combo-option { display: flex; align-items: center; gap: 8px; padding: 4px 2px; font-size: 11px; cursor: pointer; }
    .qts-combo-option img { width: 20px; height: 20px; border-radius: 4px; object-fit: cover; flex: 0 0 auto; }
    .qts-combo-clear { align-self: flex-end; background: none; border: 0; color: #ff8a8a; font-size: 10px; cursor: pointer; padding: 2px 4px; }

    /* Friendly (default) vs raw JSON detail view. */
    .qts-view-switch { display: inline-flex; margin-bottom: 10px; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
    .qts-view-switch button { height: 28px; padding: 0 12px; border: 0; background: #171717; color: #aaa; font-size: 11px; font-weight: 800; cursor: pointer; }
    .qts-view-switch button.isSelected { background: var(--qts-ui-primary, #b20808); color: var(--qts-ui-primary-contrast, #fff); }
    .qts-friendly-field { display: grid; grid-template-columns: minmax(120px,180px) 1fr; gap: 10px; padding: 6px 8px; border-bottom: 1px solid #1c1c1c; }
    .qts-friendly-field .qts-field-label { color: var(--qts-panel-accent, #ffd700); font-size: 10px; font-weight: 800; text-transform: uppercase; word-break: break-word; align-self: start; padding-top: 2px; }
    .qts-friendly-field .qts-field-value { word-break: break-word; display: flex; align-items: center; gap: 6px; }
    .qts-locate-btn { flex: none; width: 22px; height: 22px; padding: 0; border: 1px solid #333; border-radius: 6px; background: #171717; color: #aaa; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .qts-locate-btn:hover { border-color: var(--qts-panel-accent, #ffd700); color: var(--qts-panel-accent, #ffd700); }
    .qts-friendly-section { margin: 4px 0; border: 1px solid #222; border-radius: 8px; overflow: hidden; }
    .qts-friendly-section > summary { padding: 7px 10px; background: #161616; color: #fff; font-size: 11px; font-weight: 800; cursor: pointer; list-style: none; }
    .qts-friendly-section > summary::-webkit-details-marker { display: none; }
    .qts-friendly-section > summary .qts-count { color: #888; font-weight: 600; }
    .qts-friendly-hidden { display: none !important; }
    .qts-tool-lead { margin:0 0 14px; padding:12px 14px; color:var(--qts-panel-muted); background:var(--qts-panel-2); border:1px solid var(--qts-panel-border); border-radius:10px; line-height:1.55; }
    .qts-tool-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(125px, 1fr)); gap: 8px; margin: 10px 0; }
    .qts-metric { padding: 11px; border: 1px solid #282828; border-radius: 10px; background: #141414; }
    .qts-metric strong { display: block; color: var(--qts-panel-accent, #ffd700); font-size: 20px; }
    .qts-metric small { color: #aaa; }
    .qts-card { padding: 12px; margin-bottom: 8px; border: 1px solid #292929; border-radius: 10px; background: #121212; }
    .qts-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .qts-card-actions { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 9px; }
    .qts-card-actions button.action { height: 28px; font-size: 11px; }
    .qts-tabs { display: inline-flex; gap: 4px; padding: 3px; margin-bottom: 12px; border: 1px solid #292929; border-radius: 9px; }
    .qts-tabs button { padding: 7px 12px; border: 0; border-radius: 7px; background: transparent; color: #aaa; cursor: pointer; font-weight: 800; }
    .qts-tabs button.isSelected { background: var(--qts-ui-primary, #b20808); color: var(--qts-ui-primary-contrast, #fff); }
    .qts-macro-layout { display: grid; grid-template-columns: 180px minmax(0,1fr); gap: 12px; }
    .qts-palette { display: grid; align-content: start; gap: 6px; }
    .qts-palette button { padding: 9px; border: 1px dashed #444; border-radius: 8px; background: #171717; color: #fff; cursor: grab; text-align: left; }
    .qts-flow { min-height: 220px; padding: 9px; border: 1px dashed #444; border-radius: 10px; }
    .qts-step { position: relative; display: grid; grid-template-columns: 28px 115px minmax(0,1fr) 32px; gap: 7px; align-items: center; padding: 8px; margin-bottom: 16px; border: 1px solid #333; border-radius: 9px; background: #171717; }
    .qts-step:not(:last-child)::after { content: "↓"; position: absolute; left: 14px; bottom: -18px; color: var(--qts-panel-accent, #ffd700); }
    .qts-step-index { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--qts-ui-primary, #b20808); color: var(--qts-ui-primary-contrast, #fff); font-weight: 900; }
    .qts-code { min-height: 350px; padding: 14px; border: 1px solid #2c2c2c; border-radius: 10px; background: #080808; color: #9bffb0; font: 12px/1.55 ui-monospace, Consolas, monospace; white-space: pre; overflow: auto; }
    .qts-curl-preview { margin-bottom: 10px; }
    .qts-curl-preview pre { margin: 0 0 6px; padding: 12px; border: 1px solid #2c2c2c; border-radius: 10px; background: #080808; color: #9bffb0; font: 11px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-all; overflow: auto; max-height: 260px; }
    .qts-curl-hint { display: block; color: var(--qts-panel-muted); }
    .qts-curl-result { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--qts-panel-border); border-radius: 10px; background: var(--qts-panel-2); }
    .qts-curl-result pre { margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; max-height: 220px; overflow: auto; font: 11px/1.5 ui-monospace, Consolas, monospace; }
    .qts-icon-btn.isActive { background: var(--qts-ui-primary, #b20808) !important; color: var(--qts-ui-primary-contrast, #fff) !important; }
    .qts-status { min-height: 18px; margin-top: 8px; color: var(--qts-panel-accent, #ffd700); overflow-wrap: anywhere; }
    .qts-faker-report { display:grid; gap:7px; margin-top:10px; max-height:45vh; overflow:auto; }
    .qts-faker-report-row { display:grid; grid-template-columns:minmax(120px,1fr) minmax(0,1.4fr); gap:10px; align-items:center; border-top:1px solid #2a2a2a; padding-top:7px; }
    .qts-faker-report-row span, .qts-faker-report-row code { min-width:0; overflow-wrap:anywhere; white-space:normal; }
    .qts-faker-report-row small { display:block; color:#999; margin-top:2px; }
    .qts-faker-report-row code { color:#74e7a5; }
    .qts-list { display: grid; gap: 6px; margin-top: 8px; max-height: 220px; overflow: auto; }
    .qts-list-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 9px; border: 1px solid #292929; border-radius: 8px; background: #141414; font-size: 12px; }
    .qts-list-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qts-list-row button { all: unset; cursor: pointer; color: #ff7078; font-weight: 800; padding: 0 4px; flex: none; }
    .qts-result-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .qts-result-table th, .qts-result-table td { padding: 7px; border-bottom: 1px solid #292929; text-align: left; }
    .qts-key-view-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .qts-key-view-status div { display: grid; gap: 2px; }
    .qts-key-view-status small, .qts-switch-row small { display: block; color: #999; font-weight: 500; }
    .qts-switch-row { display:grid; grid-template-columns:38px minmax(0,1fr); gap:10px; align-items:center; padding:11px; margin-bottom:8px; border:1px solid #292929; border-radius:10px; background:#121212; cursor:pointer; }
    .qts-switch-row > span { min-width:0; overflow-wrap:anywhere; }
    .qts-drawer .qts-switch-row input[type="checkbox"] { width:38px !important; height:22px !important; min-height:22px !important; margin:0; }
    .qts-field-label { display: grid; gap: 7px; margin: 12px 0; color: #ddd; font-weight: 750; }
    .qts-position-grid { width: 132px; display: grid; grid-template-columns: repeat(3, 40px); gap: 6px; }
    .qts-position-grid button { width: 40px; height: 36px; border: 1px solid #393939; border-radius: 8px; background: #171717; color: #aaa; cursor: pointer; font-size: 16px; }
    .qts-position-grid button.isSelected { border-color: var(--qts-ui-primary, #ffd700); background: var(--qts-ui-primary, #b20808); color: var(--qts-ui-primary-contrast, #fff); box-shadow: 0 0 0 2px color-mix(in srgb, var(--qts-ui-primary, #ffd700) 18%, transparent); }
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
    /* A bare native <input type=color> renders as a ~16px swatch with no border in some engines --
       easy to miss entirely as "this is a color picker". Wrapping it with a visible frame and a
       readable hex readout next to it (same idea as the shape/note editors' color inputs) makes
       it unambiguous. */
    .qts-pp-color-row { display: flex; align-items: center; gap: 10px; }
    .qts-pp-color-row input[type="color"] { width: 46px; height: 34px; padding: 2px; border: 2px solid #444; border-radius: 8px; background: #000; cursor: pointer; }
    .qts-pp-color-row input[type="color"]:hover { border-color: var(--qts-panel-accent, #ffd700); }
    .qts-pp-color-hex { font: 800 12px ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .04em; color: #ddd; }
    .qts-tool-state { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; padding:12px; border:1px solid var(--qts-panel-border); border-radius:12px; background:var(--qts-panel-2); }
    .qts-tool-state-copy { display:grid; gap:3px; min-width:0; }
    .qts-tool-state-copy small { color:var(--qts-panel-muted); }
    .qts-mode-fieldset { margin:0 0 16px; padding:0; border:0; }
    .qts-mode-fieldset legend { margin-bottom:8px; font-weight:800; }
    .qts-mode-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .qts-mode-option { min-height:64px !important; height:auto !important; padding:9px 10px !important; display:flex; align-items:center; gap:10px; text-align:left; border:1px solid var(--qts-panel-border) !important; background:var(--qts-panel-2) !important; color:var(--qts-panel-text) !important; }
    .qts-mode-option[aria-checked="true"] { border-color:var(--qts-ui-primary) !important; box-shadow:0 0 0 2px color-mix(in srgb,var(--qts-ui-primary) 25%,transparent); background:color-mix(in srgb,var(--qts-ui-primary) 10%,var(--qts-panel-2)) !important; }
    .qts-mode-icon { width:36px; height:36px; flex:0 0 36px; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; background:var(--qts-ui-primary); color:var(--qts-ui-primary-contrast); font:900 23px/1 ui-monospace,Consolas,monospace; }
    .qts-mode-icon svg { width:20px; height:20px; }
    .qts-mode-copy { display:grid; gap:2px; min-width:0; }
    .qts-mode-copy small { color:var(--qts-panel-muted); font-weight:600; }
    .qts-visually-hidden { position:absolute !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important; overflow:hidden !important; clip:rect(0,0,0,0) !important; white-space:nowrap !important; border:0 !important; }
    @container (max-width:360px) { .qts-mode-grid { grid-template-columns:1fr; } }
    /* Semantic theme bridge for every reusable drawer component. It intentionally comes last
       so older feature-specific literal colors cannot break the selected platform theme. */
    .qts-drawer-backdrop.isModal .qts-drawer,
    .qts-toolbar-row input, .qts-toolbar-row select, .qts-toolbar-row textarea,
    .qts-icon-btn, .qts-toggle-group, .qts-combo, .qts-combo-panel,
    .qts-view-switch, .qts-view-switch button, .qts-locate-btn,
    .qts-friendly-section, .qts-friendly-section > summary, .qts-metric,
    .qts-card, .qts-tabs, .qts-palette button, .qts-flow, .qts-step,
    .qts-list-row, .qts-switch-row, .qts-position-grid button {
      background:var(--qts-panel-2); color:var(--qts-panel-text); border-color:var(--qts-panel-border);
    }
    .qts-tool-lead, .qts-metric small, .qts-tabs button, .qts-toggle-group button,
    .qts-combo summary, .qts-switch-row small, .qts-key-view-status small,
    .qts-privacy-note p { color:var(--qts-panel-muted); }
    .qts-net-item b, .qts-chip b, .qts-friendly-field .qts-field-label,
    .qts-metric strong, .qts-status { color:var(--qts-panel-accent); }
    .qts-friendly-field, .qts-friendly-section, .qts-result-table th,
    .qts-result-table td, .qts-faker-report-row { border-color:var(--qts-panel-border); }
    .qts-toggle-group button.isSelected, .qts-view-switch button.isSelected,
    .qts-tabs button.isSelected { background:var(--qts-ui-primary, #b20808); color:var(--qts-ui-primary-contrast, #fff); }
    .qts-icon-btn, .qts-toggle-group, .qts-combo, .qts-combo-panel,
    .qts-view-switch, .qts-view-switch button, .qts-locate-btn,
    .qts-friendly-section > summary, .qts-palette button, .qts-position-grid button {
      color:var(--qts-panel-text); background-color:var(--qts-panel-2); border-color:var(--qts-panel-border);
    }
    .qts-combo summary, .qts-tool-lead, .qts-metric small, .qts-tabs button,
    .qts-toggle-group button, .qts-key-view-status small, .qts-switch-row small,
    .qts-faker-report-row small { color:var(--qts-panel-muted); }
    .qts-friendly-section > summary, .qts-field-label { color:var(--qts-panel-text); }
    .qts-list-row span { color:var(--qts-panel-text); }
    .qts-drawer select option { background:var(--qts-panel); color:var(--qts-panel-text); }
    .qts-drawer input::placeholder, .qts-drawer textarea::placeholder { color:var(--qts-panel-muted); opacity:1; }
    .qts-drawer input:focus-visible, .qts-drawer select:focus-visible,
    .qts-drawer textarea:focus-visible, .qts-drawer button:focus-visible {
      outline:3px solid color-mix(in srgb,var(--qts-panel-accent) 42%,transparent); outline-offset:2px;
    }
    :host([data-theme="light"]) .qts-code { background:#f6f8fc; color:#146b35; border-color:var(--qts-panel-border); }
    :host([data-theme="light"]) .qts-step-index { color:#fff; }
    :host([data-theme="light"]) .qts-faker-report-row code { color:#087f4d; }
    :host([data-theme="light"]) .qts-list-row button,
    :host([data-theme="light"]) .qts-combo-clear { color:#a61f2b; }
    :host([data-theme="light"]) .qts-key-view-preview:not([data-theme="dark"]) { background:#eef1f6; color:#444; border-color:var(--qts-panel-border); }
    @media (max-width: 680px) { .qts-macro-layout, .qts-key-view-size-grid { grid-template-columns: 1fr; } .qts-palette { grid-template-columns: repeat(2,minmax(0,1fr)); } .qts-step { grid-template-columns: 28px 95px minmax(0,1fr) 32px; } }
    @container (max-width: 560px) {
      .qts-drawer-body { padding:10px; }
      .qts-toolbar-row > *, .qts-card-actions > * { min-width:0; max-width:100%; }
      .qts-friendly-field, .qts-faker-report-row { grid-template-columns:1fr; gap:4px; }
      .qts-tool-grid { grid-template-columns:repeat(auto-fit,minmax(100px,1fr)); }
      .qts-card-actions { flex-wrap:wrap; }
      .qts-step { grid-template-columns:24px minmax(0,1fr) 32px; }
      .qts-step > :nth-child(3) { grid-column:2 / -1; }
    }
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
  "Borrar elementos": "Difuminar elementos",
  "Clique em elementos da página para borrar informações sensíveis antes de um screenshot ou gravação, ou clique com o botão direito num elemento e escolha \"Borrar / desborrar este elemento\" no menu QA Sandbox.": "Haz clic en elementos de la página para difuminar información sensible antes de una captura o grabación, o haz clic derecho en un elemento y elige \"Borrar / desborrar este elemento\" en el menú QA Sandbox.",
  "Selecionar elemento": "Seleccionar elemento", "Limpar todos os borrados": "Quitar todo el difuminado",
  "Clique num elemento para borrar (ou desborrar, se já estiver). Esc para parar.": "Haz clic en un elemento para difuminarlo (o quitar el difuminado si ya lo tiene). Esc para detener.",
  "Nenhum elemento borrado ainda.": "Ningún elemento difuminado todavía.",
  "Modo Holofote": "Modo Foco",
  "Ative e segure Ctrl por 2 segundos em qualquer momento para acender um holofote ao redor do mouse, útil pra guiar a atenção em demonstrações e gravações. Soltar Ctrl apaga o holofote suavemente.": "Actívalo y mantén presionado Ctrl durante 2 segundos en cualquier momento para encender un foco alrededor del mouse, útil para guiar la atención en demostraciones y grabaciones. Soltar Ctrl apaga el foco suavemente.",
  "Ativar": "Activar", "Desativar": "Desactivar",
  "Efeito": "Efecto", "Escurecer": "Oscurecer", "Borrar": "Difuminar",
  "Opacidade (efeito Escurecer)": "Opacidad (efecto Oscurecer)",
  "Intensidade do borrão (efeito Borrar)": "Intensidad del desenfoque (efecto Difuminar)",
  "Tamanho do holofote": "Tamaño del foco",
  "Ative e escolha um modo: linhas guia acompanhando o mouse (cruz, horizontal ou vertical) com uma régua inteligente de clique-para-medir, ou o inspetor de elementos - passe o mouse pra ver o tamanho exato de qualquer elemento da página, role o scroll pra subir/descer entre pai e filho, e clique pra fixar. Também disponível com o botão direito do mouse, em \"Inspecionar com Pixel Perfect\".": "Actívalo y elige un modo: líneas guía que siguen al mouse (cruz, horizontal o vertical) con una regla inteligente de clic-para-medir, o el inspector de elementos - pasa el mouse para ver el tamaño exacto de cualquier elemento de la página, usa el scroll para subir/bajar entre padre e hijo, y haz clic para fijarlo. También disponible con el botón derecho del mouse, en \"Inspeccionar con Pixel Perfect\".",
  "Modo": "Modo", "Linhas guia - cruz (horizontal + vertical)": "Líneas guía - cruz (horizontal + vertical)", "Linhas guia - somente horizontal": "Líneas guía - solo horizontal", "Linhas guia - somente vertical": "Líneas guía - solo vertical",
  "Inspecionar elemento (tamanho em pixels)": "Inspeccionar elemento (tamaño en píxeles)",
  "Cor": "Color", "Espessura da linha": "Grosor de la línea",
  "Role o scroll para ir ao elemento pai/filho · Clique para fixar": "Usa el scroll para ir al elemento padre/hijo · Haz clic para fijarlo",
  "Pixel Perfect: role o scroll pra trocar de elemento, clique pra soltar.": "Pixel Perfect: usa el scroll para cambiar de elemento, haz clic para soltarlo.",
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
  "Borrar elementos": "Blur elements",
  "Clique em elementos da página para borrar informações sensíveis antes de um screenshot ou gravação, ou clique com o botão direito num elemento e escolha \"Borrar / desborrar este elemento\" no menu QA Sandbox.": "Click elements on the page to blur sensitive information before a screenshot or recording, or right-click an element and choose \"Borrar / desborrar este elemento\" in the QA Sandbox menu.",
  "Selecionar elemento": "Select element", "Limpar todos os borrados": "Clear all blurred elements",
  "Clique num elemento para borrar (ou desborrar, se já estiver). Esc para parar.": "Click an element to blur it (or unblur it, if already blurred). Esc to stop.",
  "Nenhum elemento borrado ainda.": "No elements blurred yet.",
  "Modo Holofote": "Spotlight Mode",
  "Ative e segure Ctrl por 2 segundos em qualquer momento para acender um holofote ao redor do mouse, útil pra guiar a atenção em demonstrações e gravações. Soltar Ctrl apaga o holofote suavemente.": "Turn it on and hold Ctrl for 2 seconds at any moment to light up a spotlight around the mouse, useful for directing attention during demos and recordings. Releasing Ctrl fades the spotlight out smoothly.",
  "Ativar": "Enable", "Desativar": "Disable",
  "Efeito": "Effect", "Escurecer": "Darken", "Borrar": "Blur",
  "Opacidade (efeito Escurecer)": "Opacity (Darken effect)",
  "Intensidade do borrão (efeito Borrar)": "Blur strength (Blur effect)",
  "Tamanho do holofote": "Spotlight size",
  "Ative e escolha um modo: linhas guia acompanhando o mouse (cruz, horizontal ou vertical) com uma régua inteligente de clique-para-medir, ou o inspetor de elementos - passe o mouse pra ver o tamanho exato de qualquer elemento da página, role o scroll pra subir/descer entre pai e filho, e clique pra fixar. Também disponível com o botão direito do mouse, em \"Inspecionar com Pixel Perfect\".": "Turn it on and pick a mode: guide lines following the mouse (cross, horizontal, or vertical) with a click-to-measure smart ruler, or the element inspector - hover to see the exact size of any element on the page, scroll to walk up/down between parent and child, and click to pin it. Also reachable with a right-click, via \"Inspect with Pixel Perfect\".",
  "Modo": "Mode", "Linhas guia - cruz (horizontal + vertical)": "Guide lines - cross (horizontal + vertical)", "Linhas guia - somente horizontal": "Guide lines - horizontal only", "Linhas guia - somente vertical": "Guide lines - vertical only",
  "Inspecionar elemento (tamanho em pixels)": "Inspect element (pixel size)",
  "Cor": "Color", "Espessura da linha": "Line thickness",
  "Role o scroll para ir ao elemento pai/filho · Clique para fixar": "Scroll to go to the parent/child element · Click to pin it",
  "Pixel Perfect: role o scroll pra trocar de elemento, clique pra soltar.": "Pixel Perfect: scroll to switch elements, click to release.",
});
Object.assign(QA_SURFACE_TRANSLATIONS.es, {
  "Desativar ferramentas ativas": "Desactivar herramientas activas",
  "Validador de textos": "Validador de textos",
  "Gere o QR localmente para a URL atual ou uma URL concreta salva. Nenhum dado é enviado para serviços externos.": "Genera el QR localmente para la URL actual o una URL concreta guardada. No se envía ningún dato a servicios externos.",
  "Query/hash removidos por segurança": "Query/hash eliminados por seguridad",
  "A URL atual contém parâmetros. Ative a opção abaixo somente se tiver certeza de que não há token ou segredo.": "La URL actual contiene parámetros. Activa la opción siguiente solo si estás seguro de que no hay tokens ni secretos.",
  "Incluir query e hash": "Incluir query y hash", "Aba atual": "Pestaña actual", "Baixar PNG": "Descargar PNG", "Copiar imagem": "Copiar imagen",
  "Imagem copiada.": "Imagen copiada.", "O navegador não permitiu copiar a imagem; use Baixar PNG.": "El navegador no permitió copiar la imagen; usa Descargar PNG.",
  "Protocolo não permitido": "Protocolo no permitido",
  "Importe um JSON de idioma. Cada texto esperado é comparado com o conteúdo visível da página atual; o arquivo nunca é executado nem enviado.": "Importa un JSON de idioma. Cada texto esperado se compara con el contenido visible de la página actual; el archivo nunca se ejecuta ni se envía.",
  "Arquivo JSON": "Archivo JSON", "Validar página": "Validar página", "Revalidar após navegação": "Revalidar después de navegar",
  "Igual": "Coincide", "Ausente/diferente": "Ausente/diferente", "Importe um arquivo JSON válido.": "Importa un archivo JSON válido.",
  "O arquivo deve ter no máximo 2 MB.": "El archivo debe tener como máximo 2 MB.", "Nenhum texto encontrado": "No se encontró ningún texto",
});
Object.assign(QA_SURFACE_TRANSLATIONS.en, {
  "Desativar ferramentas ativas": "Disable active tools",
  "Validador de textos": "Text Validator",
  "Gere o QR localmente para a URL atual ou uma URL concreta salva. Nenhum dado é enviado para serviços externos.": "Generate the QR locally for the current URL or a saved concrete URL. No data is sent to external services.",
  "Query/hash removidos por segurança": "Query/hash removed for safety",
  "A URL atual contém parâmetros. Ative a opção abaixo somente se tiver certeza de que não há token ou segredo.": "The current URL contains parameters. Enable the option below only if you are sure there is no token or secret.",
  "Incluir query e hash": "Include query and hash", "Aba atual": "Current tab", "Baixar PNG": "Download PNG", "Copiar imagem": "Copy image",
  "Imagem copiada.": "Image copied.", "O navegador não permitiu copiar a imagem; use Baixar PNG.": "The browser could not copy the image; use Download PNG.",
  "Protocolo não permitido": "Protocol not allowed",
  "Importe um JSON de idioma. Cada texto esperado é comparado com o conteúdo visível da página atual; o arquivo nunca é executado nem enviado.": "Import a language JSON file. Each expected text is compared with visible content on the current page; the file is never executed or sent.",
  "Arquivo JSON": "JSON file", "Validar página": "Validate page", "Revalidar após navegação": "Revalidate after navigation",
  "Igual": "Match", "Ausente/diferente": "Missing/different", "Importe um arquivo JSON válido.": "Import a valid JSON file.",
  "O arquivo deve ter no máximo 2 MB.": "The file must be no larger than 2 MB.", "Nenhum texto encontrado": "No text found",
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
  if (state.t.locale === "en") translated = translated.replace(/(\d+) etapa\(s\)/g, "$1 step(s)").replace(/(\d+) clique\(s\)/g, "$1 click(s)").replace(/campo\(s\)/g, "field(s)").replace(/sensível\(is\) protegido\(s\)/g, "sensitive field(s) protected").replace(/^(\d+) elemento\(s\) borrado\(s\)\.$/, "$1 element(s) blurred.");
  if (state.t.locale === "es") translated = translated.replace(/(\d+) etapa\(s\)/g, "$1 etapa(s)").replace(/(\d+) clique\(s\)/g, "$1 clic(s)").replace(/sensível\(is\) protegido\(s\)/g, "campo(s) sensible(s) protegido(s)").replace(/^(\d+) elemento\(s\) borrado\(s\)\.$/, "$1 elemento(s) difuminado(s).");
  if (state.t.locale === "en") translated = translated.replace(/^Executando /, "Running ").replace(/^Macro concluída:/, "Macro completed:").replace(/^Macro interrompida:/, "Macro stopped:").replace(/^Não foi possível iniciar a macro com segurança\.$/, "The macro could not be started safely.");
  if (state.t.locale === "es") translated = translated.replace(/^Executando /, "Ejecutando ").replace(/^Macro concluída:/, "Macro completada:").replace(/^Macro interrompida:/, "Macro interrumpida:").replace(/^Não foi possível iniciar a macro com segurança\.$/, "No se pudo iniciar la macro de forma segura.");
  if (state.t.locale === "en") translated = translated.replace(/^Não foi possível gerar:/, "Could not generate:").replace(/^(\d+)\/(\d+) textos encontrados na página atual\.$/, "$1/$2 texts found on the current page.").replace(/^(\d+) textos carregados\.$/, "$1 texts loaded.").replace(/^JSON inválido:/, "Invalid JSON:");
  if (state.t.locale === "es") translated = translated.replace(/^Não foi possível gerar:/, "No se pudo generar:").replace(/^(\d+)\/(\d+) textos encontrados na página atual\.$/, "$1/$2 textos encontrados en la página actual.").replace(/^(\d+) textos carregados\.$/, "$1 textos cargados.").replace(/^JSON inválido:/, "JSON no válido:");
  if (state.t.locale === "en") translated = translated.replace(/^(\d+) requisição\(ões\) capturada\(s\) não corresponderam a nenhum padrão configurado nos Inspectors - confira as rotas\/endpoints cadastrados\.$/, "$1 captured request(s) matched none of the configured Inspectors patterns - check the routes/endpoints you registered.");
  if (state.t.locale === "es") translated = translated.replace(/^(\d+) requisição\(ões\) capturada\(s\) não corresponderam a nenhum padrão configurado nos Inspectors - confira as rotas\/endpoints cadastrados\.$/, "$1 solicitud(es) capturada(s) no coincidieron con ningún patrón configurado en Inspectors - revisa las rutas/endpoints registrados.");
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

// `onBack`: an optional callback that reopens whatever list/parent view led here (e.g. an
// Inspector's captured-response detail passes openInspectorsDrawer) - shows a back arrow in the
// header instead of forcing "close the whole sidebar, then reopen it" to get back to a list.
// openDrawer has no history stack of its own; each caller that drills into a sub-view is
// responsible for passing the one function that rebuilds its own parent view.
function renderMinimizedDrawerShortcut() {
  const tools = state.shadowRoot?.getElementById("extraPinnedTools");
  if (!tools) return;
  tools.querySelector("#minimizedDrawerButton")?.remove();
  const descriptor = state.minimizedDrawer;
  if (!descriptor) return;
  const restore = document.createElement("button");
  restore.id = "minimizedDrawerButton";
  restore.className = "iconOnly isActive";
  restore.type = "button";
  restore.title = `Restaurar ${descriptor.title}`;
  restore.innerHTML = ICON("square");
  restore.addEventListener("click", () => {
    state.minimizedDrawer = null;
    restore.remove();
    openDrawer(descriptor);
  });
  tools.appendChild(restore);
}

function clearDrawerPageOffset() {
  const snapshot = state.drawerPageOffset;
  if (!snapshot || !document.body) return;
  for (const [property, value] of Object.entries(snapshot)) document.body.style[property] = value;
  state.drawerPageOffset = null;
}

function applyDrawerPageOffset(position, drawer, enabled) {
  clearDrawerPageOffset();
  if (!enabled || !document.body || !drawer) return;
  state.drawerPageOffset = {
    paddingLeft: document.body.style.paddingLeft,
    paddingRight: document.body.style.paddingRight,
    paddingTop: document.body.style.paddingTop,
    paddingBottom: document.body.style.paddingBottom,
  };
  const size = drawer.getBoundingClientRect();
  const property = { left: "paddingLeft", right: "paddingRight", top: "paddingTop", bottom: "paddingBottom" }[position];
  document.body.style[property] = `${Math.ceil(["left", "right"].includes(position) ? size.width : size.height)}px`;
}

function openDrawer({ title, bodyHtml, onReady, onBack, view = "", variant = "" }) {
  if (!view && title === stepsCopy().title) view = "stepsRecorder";
  cleanupBreakpointViewer();
  const drawerHost = ensureDrawerHost();
  // Every open must reset (or set) this flag - handleNetworkCaptured()/updateHttpErrorSurfaces()
  // check it to decide whether to live-refresh the Inspectors/Error Monitor list. Leaving a stale
  // "inspectors" value here after switching to a different panel made Inspectors content silently
  // overwrite other drawers.
  drawerHost.dataset.view = view;
  // A detail view (Inspectors' or Error Monitor's "endpoint" screen) reuses the SAME `view` tag as
  // its own list - it's a `onBack`-driven sub-screen, not a different tool - so the live-refresh
  // checks above can't tell a detail screen apart from the list using `view` alone. Found live: a
  // background capture arriving while looking at an endpoint's detail forced the list back onto
  // screen, discarding the drill-down (and, from the search box being gone too, reading as "my
  // filter got undone"). `onBack` is only ever passed for a detail/drill-down screen, so it's
  // already the exact signal needed - nothing new to track.
  drawerHost.dataset.drawerHasBack = String(Boolean(onBack));
  const preferredDrawerPosition = effectiveDrawerPosition();
  const drawerPosition = ["left", "right", "top", "bottom"].includes(preferredDrawerPosition) ? preferredDrawerPosition : "right";
  const detachedWindow = Boolean(state.detachedToolKey);
  const sidebarControls = variant !== "modal" && !detachedWindow;
  drawerHost.innerHTML = `<style>${drawerStyles()}</style>
    <div class="qts-drawer-backdrop${variant === "modal" ? " isModal" : ""}${detachedWindow ? " isDetached" : ""}" id="drawerBackdrop" data-position="${drawerPosition}">
      <div class="qts-drawer">
        ${sidebarControls ? `<span class="qts-drawer-resize" data-edge="left"></span><span class="qts-drawer-resize" data-edge="right"></span><span class="qts-drawer-resize" data-edge="top"></span><span class="qts-drawer-resize" data-edge="bottom"></span>` : ""}
        <div class="qts-drawer-head${onBack ? " hasBack" : ""}">${onBack ? `<button type="button" id="drawerBack" class="qts-icon-btn" title="Voltar">${ICON("arrowLeft")}</button>` : ""}<div class="qts-drawer-title"><h2>${escapeHtml(title)}</h2><span class="qts-drawer-kicker">${variant === "modal" ? "Janela de trabalho" : detachedWindow ? "Ferramenta em janela separada" : "Ferramenta lateral"}</span></div>
          <div class="qts-drawer-controls">${view && !detachedWindow ? `<button type="button" id="drawerDetach" title="Abrir em nova janela" aria-label="Abrir ${escapeHtml(title)} em nova janela">${ICON("resize")}</button>` : ""}
          ${sidebarControls ? `<div class="qts-drawer-position" id="drawerPosition" role="radiogroup" aria-label="Posição do sidebar">${["right", "left", "top", "bottom"].map((side) => `<button type="button" class="qts-drawer-position-btn" data-position="${side}" aria-pressed="${side === drawerPosition}" title="${escapeHtml({ right: "Direita", left: "Esquerda", top: "Cima", bottom: "Baixo" }[side])}">${drawerPositionIcon(side)}</button>`).join("")}</div>` : ""}
          ${sidebarControls ? `<button type="button" id="drawerPin" title="Fixar sidebar" aria-pressed="false">${ICON("pin")}</button>
          <button type="button" id="drawerMinimize" title="Recolher sidebar">${ICON("collapse")}</button>` : ""}
          <button type="button" id="drawerClose" title="${detachedWindow ? "Fechar janela" : variant === "modal" ? "Fechar modal" : "Fechar sidebar"}">${ICON("fail")}</button></div></div>
        ${sidebarControls ? `<div class="qts-drawer-search"><input id="drawerSearch" type="search" placeholder="Buscar neste sidebar…" aria-label="Buscar neste sidebar" /></div>` : ""}
        <div class="qts-drawer-body" id="drawerBody">${bodyHtml}${sidebarControls ? `<div class="qts-drawer-footer-actions" id="drawerFooterActions"></div>` : ""}</div>
      </div>
    </div>`;
  const backdrop = drawerHost.querySelector("#drawerBackdrop");
  const drawer = drawerHost.querySelector(".qts-drawer");
  const pushesSite = sidebarControls && state.workspace?.preferences?.pushSiteContentForDrawer === true;
  const toolbarPosition = effectiveToolbarPosition();
  const toolbarOffset = pushSiteContentEnabled() ? getCurrentHeight() : 0;
  if (drawerPosition === "top" && toolbarPosition === "top") {
    backdrop.style.top = `${toolbarOffset}px`;
    backdrop.style.height = `calc(100% - ${toolbarOffset}px)`;
  } else if (drawerPosition === "bottom" && toolbarPosition === "bottom") {
    backdrop.style.bottom = `${toolbarOffset}px`;
    backdrop.style.height = `calc(100% - ${toolbarOffset}px)`;
  }
  applyDrawerPageOffset(drawerPosition, drawer, pushesSite);
  const positionButtons = [...drawerHost.querySelectorAll(".qts-drawer-position-btn")];
  drawerHost.querySelector("#drawerDetach")?.addEventListener("click", () => openToolInNewTab(view));
  positionButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.position;
      backdrop.dataset.position = value;
      applyDrawerPageOffset(value, drawer, pushesSite);
      positionButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      const preferenceKey = isMobileViewport() ? "mobileDrawerPosition" : "drawerPosition";
      state.workspace.preferences = { ...(state.workspace.preferences || {}), [preferenceKey]: value };
      state.workspace = await saveWorkspace(state.workspace);
    });
  });
  drawerHost.querySelector("#drawerPin")?.addEventListener("click", (event) => {
    const pinned = backdrop.classList.toggle("isPinned");
    event.currentTarget.setAttribute("aria-pressed", String(pinned));
  });
  drawerHost.querySelector("#drawerMinimize")?.addEventListener("click", () => {
    state.minimizedDrawer = { title, bodyHtml, onReady, onBack, view, variant, position: backdrop.dataset.position };
    renderMinimizedDrawerShortcut();
    closeDrawer();
  });
  drawerHost.querySelectorAll(".qts-drawer-resize").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const edge = handle.dataset.edge;
    const start = drawer.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent) => {
      if (edge === "left" || edge === "right") {
        const delta = (edge === "left" ? startX - moveEvent.clientX : moveEvent.clientX - startX);
        drawer.style.width = `${Math.max(280, Math.min(window.innerWidth - 24, start.width + delta))}px`;
      } else {
        const delta = (edge === "top" ? startY - moveEvent.clientY : moveEvent.clientY - startY);
        drawer.style.height = `${Math.max(180, Math.min(window.innerHeight - 24, start.height + delta))}px`;
      }
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }));
  drawerHost.querySelector("#drawerClose").addEventListener("click", () => {
    if (!detachedWindow) {
      closeDrawer();
      return;
    }
    chrome.runtime.sendMessage({ type: "qts:close-detached-window" }, (response) => {
      if (chrome.runtime.lastError || response?.ok !== true) window.close();
    });
  });
  if (onBack) drawerHost.querySelector("#drawerBack").addEventListener("click", onBack);
  backdrop.addEventListener("click", (event) => { if (event.target.id === "drawerBackdrop" && !backdrop.classList.contains("isPinned")) closeDrawer(); });
  drawerHost.querySelector("#drawerSearch")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase();
    const body = drawerHost.querySelector("#drawerBody");
    const candidates = body.querySelectorAll(".qts-card,.qts-net-item,.qts-list-row,.qts-friendly-field,.qts-switch-row,.qts-metric,.qts-step");
    (candidates.length ? candidates : body.children).forEach((element) => {
      element.classList.toggle("qts-friendly-hidden", Boolean(query) && !element.textContent.toLocaleLowerCase().includes(query));
    });
  });
  localizeQaSurface(drawerHost);
  const drawerBody = drawerHost.querySelector("#drawerBody");
  onReady?.(drawerBody);
  const footerActions = drawerHost.querySelector("#drawerFooterActions");
  if (footerActions) {
    const directButtons = [...drawerBody.children].filter((element) => element.matches("button.action"));
    const groupedButtons = [...drawerBody.querySelectorAll(":scope > .qts-card-actions > button.action")];
    [...directButtons, ...groupedButtons].forEach((button) => footerActions.appendChild(button));
    drawerBody.querySelectorAll(":scope > .qts-card-actions:empty").forEach((group) => group.remove());
  }
}

function closeDrawer() {
  const drawerHost = state.shadowRoot?.getElementById("drawerHost");
  if (drawerHost) drawerHost.innerHTML = "";
  clearDrawerPageOffset();
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
    return `{<br>${keys.map((key) => `${"&nbsp;".repeat((depth + 1) * 2)}<span style="color:var(--qts-panel-accent, #ffd700)">${escapeHtml(key)}</span>: ${renderJsonTree(value[key], depth + 1)}`).join(",<br>")}<br>${"&nbsp;".repeat(depth * 2)}}`;
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
  if (value === null || value === undefined) return `<span style="color:#666">-</span>`;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return escapeHtml(String(value));
}

/**
 * Friendly (default) rendering of arbitrary JSON: primitive fields as
 * label/value rows, objects as collapsible sections, arrays as numbered
 * collapsible sections - everything generic, nothing product-specific.
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
// structure) - this only ever looks at leaf elements so a whole-page container never wins
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

// Header names whose values never appear in the "Ver cURL" preview by default (Copy and
// Execute always use the real captured value - those are deliberate, user-initiated actions on
// data the user already has access to; the preview is what might get glanced at or screen-shared).
const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|proxy-authorization|x-api-key|x-auth-token|x-access-token)$/i;

// Single-quotes a value for a POSIX shell; escapes any literal single quote the standard way
// ('\'' closes the quote, inserts an escaped quote, reopens it).
function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildCurlCommand(method, url, headers, body, { redactSensitive = false } = {}) {
  const parts = ["curl"];
  const upperMethod = String(method || "GET").toUpperCase();
  if (upperMethod !== "GET") parts.push("-X", upperMethod);
  parts.push(shQuote(url));
  for (const [key, value] of Object.entries(headers || {})) {
    const shown = redactSensitive && SENSITIVE_HEADER_PATTERN.test(key) ? "[REDACTED]" : value;
    parts.push("-H", shQuote(`${key}: ${shown}`));
  }
  if (body != null && body !== "") parts.push("--data-raw", shQuote(body));
  return parts.join(" \\\n  ");
}

/**
 * Renders a JSON value with a friendly/raw switch (friendly is the default)
 * plus a search box that filters the friendly view, and a "minimizar" toggle
 * that collapses everything down to just the header for a minimal view.
 */
// method/url are optional -- only the three network-entry detail views (Inspectors x2, Error
// Monitor) have a real request to rebuild, so the cURL controls only render when both are given.
// requestHeaders/requestBody are best-effort (pagebridge.js captures them for fetch()/XHR calls
// with a string-shaped body; FormData/Blob bodies are skipped, not guessed at) -- when absent,
// the rebuilt command still works, it's just method+URL only, same as before this existed.
function renderJsonDetail(container, value, method, url, requestHeaders, requestBody) {
  const t = state.t;
  const hasRequest = Boolean(method && url);
  const hasSensitiveHeaders = Object.keys(requestHeaders || {}).some((key) => SENSITIVE_HEADER_PATTERN.test(key));
  container.innerHTML = `
    <div class="qts-toolbar-row">
      <div class="qts-view-switch"><button type="button" data-mode="friendly" class="isSelected">${escapeHtml(t.friendly)}</button><button type="button" data-mode="raw">${escapeHtml(t.raw)}</button></div>
      <input type="search" placeholder="${escapeHtml(t.jsonSearchPlaceholder)}" data-json-search />
      ${hasRequest ? `<button type="button" class="qts-icon-btn" data-json-view-curl title="${escapeHtml(t.viewAsCurl)}">${ICON("braces")}</button>
      <button type="button" class="qts-icon-btn" data-json-copy-curl title="${escapeHtml(t.copyAsCurl)}">${ICON("copy")}</button>
      <button type="button" class="qts-icon-btn" data-json-execute-curl title="${escapeHtml(t.executeCurl)}">${ICON("play")}</button>` : ""}
      <button type="button" class="qts-icon-btn" data-json-minimize title="${escapeHtml(t.minimizeTitle)}">${ICON("collapse")}</button>
    </div>
    ${hasRequest ? `<div class="qts-curl-preview" data-curl-preview hidden>
      <pre data-curl-text></pre>
      ${hasSensitiveHeaders ? `<small class="qts-curl-hint">${escapeHtml(t.curlSensitiveHeadersHidden)}</small>` : ""}
    </div>` : ""}
    <div data-json-content></div>
    ${hasRequest ? `<div class="qts-curl-result" data-curl-result hidden></div>` : ""}
  `;
  const content = container.querySelector("[data-json-content]");
  const searchInput = container.querySelector("[data-json-search]");
  content.addEventListener("click", (event) => {
    const button = event.target.closest("[data-locate-value]");
    if (button) locateValueOnPage(button.dataset.locateValue);
  });
  if (hasRequest) {
    const preview = container.querySelector("[data-curl-preview]");
    const previewText = container.querySelector("[data-curl-text]");
    container.querySelector("[data-json-view-curl]").addEventListener("click", (event) => {
      const willShow = preview.hasAttribute("hidden");
      preview.toggleAttribute("hidden");
      event.currentTarget.classList.toggle("isActive", willShow);
      event.currentTarget.title = willShow ? t.hideCurl : t.viewAsCurl;
      if (willShow) previewText.textContent = buildCurlCommand(method, url, requestHeaders, requestBody, { redactSensitive: true });
    });
    container.querySelector("[data-json-copy-curl]").addEventListener("click", () => {
      const curl = buildCurlCommand(method, url, requestHeaders, requestBody);
      navigator.clipboard?.writeText(curl).then(() => showQaToast(t.copiedAsCurl));
    });
    container.querySelector("[data-json-execute-curl]").addEventListener("click", async () => {
      if (!confirm(t.executeCurlConfirm)) return;
      const resultBox = container.querySelector("[data-curl-result]");
      try {
        const response = await fetch(url, {
          method: String(method || "GET").toUpperCase(),
          headers: requestHeaders || undefined,
          body: requestBody ?? undefined,
        });
        const text = await response.text();
        resultBox.hidden = false;
        resultBox.innerHTML = `<b>${response.status} ${escapeHtml(response.statusText || "")}</b><pre>${escapeHtml(text.slice(0, 20_000))}</pre>`;
        showQaToast(t.curlExecuted);
      } catch (err) {
        resultBox.hidden = false;
        resultBox.innerHTML = `<b>${escapeHtml(t.curlExecuteFailed)}</b><pre>${escapeHtml(String(err?.message || err))}</pre>`;
        showQaToast(t.curlExecuteFailed, "error");
      }
    });
  }
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
// instead of actually navigating/submitting - a safe way to inspect intent.
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
    // the same target - a site's own analytics/handlers - fires from this pick click.
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
  const testId = target.getAttribute("data-testid") || target.getAttribute("data-test-id") || target.getAttribute("data-qa") || target.getAttribute("data-cy");
  return [
    [t.clickSpyElement, target.tagName.toLowerCase()],
    [t.clickSpyText, target.textContent?.trim().slice(0, 80) || "-"],
    [t.clickSpyDestination, anchor ? new URL(anchor.getAttribute("href"), window.location.href).href : "-"],
    [t.clickSpyType, anchor ? t.clickSpyNavigation : target.tagName === "BUTTON" || target.getAttribute("type") === "submit" ? t.clickSpyActionSubmit : t.clickSpyFormControl],
    [t.clickSpyTestId, testId || "-"],
    [t.clickSpyRole, target.getAttribute("role") || "-"],
    [t.clickSpyElementId, target.id || "-"],
  ];
}

let clickSpyTooltipEl = null;

function closeClickSpyTooltip() {
  clickSpyTooltipEl?.remove();
  clickSpyTooltipEl = null;
}

// A small tooltip anchored near the picked element (not the full openDrawer side panel) - lets
// the tester keep seeing the element they picked while reading the result, matching how a
// real inspector would surface this instead of yanking focus to a side drawer.
function showClickSpyTooltip(target, clientX, clientY) {
  closeClickSpyTooltip();
  const t = state.t;
  const description = describeClickSpyTarget(target);
  const tooltip = document.createElement("div");
  tooltip.className = "qts-clickspy-tooltip";
  tooltip.innerHTML = `
    <div class="qts-clickspy-head"><span>${escapeHtml(t.clickSpyResultTitle)}</span><button type="button" class="qts-remove-btn" data-clickspy-close title="${escapeHtml(t.remove)}">${ICON("fail")}</button></div>
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
// window - patching window.fetch/history.pushState/etc. from here would only ever touch that
// isolated copy, invisible to the page's real code (this is exactly why pagebridge.js exists as
// a MAIN-world script for Freeze Clock/Force HTTP). Rather than duplicating that split for this
// one feature, this reuses what's already observable from here: qts:network-captured (fetch/XHR,
// dispatched by pagebridge.js) and qts:location-change (pushState/replaceState/popstate/
// hashchange, also pagebridge.js) are both real DOM CustomEvents, and `submit` is a real DOM
// event too - none of those need MAIN-world access to observe. Only window.open is a bare
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
// only pagebridge.js (MAIN world) can see - the isolated-world toolbar only
// dispatches/listens for CustomEvents on document.
// ---------------------------------------------------------------------------

function toggleFreezeClock() {
  document.dispatchEvent(new CustomEvent("qts:freeze-clock-command", { detail: { freeze: !state.clockFrozen } }));
}

function openForceHttpDialog() {
  const t = state.t;
  openDrawer({
    title: t.forceHttpTitle,
    view: "forceHttp",
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
// Fully generic/declarative - no product-specific endpoint names hardcoded.
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
// just wanted a quick look - the "Todos"/"Meus Inspectors" toggle in renderInspectorsList() is a
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
  const inspectorsDrawerHost = state.shadowRoot?.getElementById("drawerHost");
  if (inspectorsDrawerHost?.dataset.view === "inspectors" && inspectorsDrawerHost.dataset.drawerHasBack !== "true") renderInspectorsList();
}

// "auto" means "not yet manually chosen" - resolved once per drawer session by
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
  // Re-tag already-captured entries immediately - otherwise "Meus Inspectors" would stay empty
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
  if (!status) return "-";
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
  // Each configured inspector is also its own filter chip - lets the founder narrow down to
  // "just what Inspector X caught" regardless of whether they're viewing Todos or Meus Inspectors.
  if (configured.length) fields.push({ key: "inspector", label: "Inspector", options: configured.map((inspector) => ({ value: inspector.id, label: inspector.label || inspector.id })) });
  return fields;
}

// Only ever called for the "Todos" scope now - "Meus Inspectors" is a per-inspector dashboard
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
// recent matching capture or a waiting state), not a filtered capture list - this is what the
// founder compared against the tampermonkey.js reference's own API Inspector drawers: list the
// endpoints you care about, show a plain "still waiting" state with a retry when nothing matched
// yet, and open straight to the response once something did. Retrying doesn't (and can't safely)
// force a new request - it just re-checks whatever's already in state.networkHistory, the same
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
          ? `<small style="display:block;margin-top:3px;color:#42d5c2">${ICON("pass")} ${escapeHtml(entry.method)} ${entry.status || "-"} · ${new Date(entry.capturedAt).toLocaleTimeString()}</small>
             <small style="display:block;margin-top:2px;word-break:break-all">${escapeHtml(entry.url)}</small>`
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
    const inspector = configured.find((item) => item.id === row.dataset.inspectorId);
    // Titled with the name the user gave this Inspector in Configurações (e.g.
    // "in-app-notifications GET200"), not just the bare method+status -- otherwise two pinned
    // Inspectors hitting different endpoints with the same verb/status look identical in the
    // drawer title.
    openDrawer({ title: `${inspector?.label || inspector?.id || ""} ${entry.method}${entry.status}`.trim(), bodyHtml: "", view: "inspectors", onBack: openInspectorsDrawer, onReady: (drawerBody) => renderJsonDetail(drawerBody, entry.payload, entry.method, entry.url, entry.requestHeaders, entry.requestBody) });
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
  const focus = captureListFocus(body);

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
    restoreListFocus(body, focus);
    return;
  }
  const emptyMessage = !state.networkHistory.length ? t.noResponsesYet : t.noFilterResults;
  listBody.innerHTML = filtered.length
    ? filtered.map((entry) => `
        <div class="qts-net-item" data-id="${escapeHtml(entry.id)}" style="display:flex;align-items:center;gap:8px;justify-content:space-between">
          <div style="min-width:0;flex:1">
            <b>${escapeHtml(urlPathFor(entry.url))}</b>
            <small style="display:block;margin-top:2px;color:#42d5c2">${escapeHtml(entry.method)} ${entry.status || "-"}</small>
            <small style="display:block;margin-top:2px;word-break:break-all;color:#888">${escapeHtml(entry.url)}</small>
            ${entry.matchedInspectorIds?.length ? `<small style="color:#42d5c2">${ICON("star")} ${entry.matchedInspectorIds.length} inspector(es)</small>` : ""}
          </div>
          <button type="button" class="qts-icon-btn" data-mark-inspector="${escapeHtml(entry.id)}" title="Marcar como meu inspector" style="width:26px;height:26px;flex:0 0 auto">${ICON("pin")}</button>
        </div>
      `).join("")
    : `<div class="qts-empty">${escapeHtml(emptyMessage)}</div>`;

  listBody.querySelectorAll("[data-id]").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("[data-mark-inspector]")) return;
    const entry = state.networkHistory.find((item) => item.id === row.dataset.id);
    const matchedInspector = configuredInspectors().find((item) => (entry.matchedInspectorIds || []).includes(item.id));
    const title = matchedInspector ? `${matchedInspector.label || matchedInspector.id} ${entry.method}${entry.status}` : `${entry.method} ${entry.status}`;
    openDrawer({ title, bodyHtml: "", view: "inspectors", onBack: openInspectorsDrawer, onReady: (drawerBody) => renderJsonDetail(drawerBody, entry.payload, entry.method, entry.url, entry.requestHeaders, entry.requestBody) });
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
  restoreListFocus(body, focus);
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

// Single place that keeps every HTTP-error surface in sync - the Tools-menu badge, the
// standalone notification bell (badge + its own dropdown list), and the Error Monitor drawer if
// it happens to be open - so none of them can drift out of sync with `state.httpErrors`.
function updateHttpErrorSurfaces() {
  const root = state.shadowRoot;
  if (!root) return;
  const count = state.httpErrors.length + (state.showFirstRunNotification ? 1 : 0) + (state.pendingReleaseNote ? 1 : 0);
  const menuBadge = root.getElementById("errorMonitorBadge");
  if (menuBadge) { menuBadge.textContent = String(state.httpErrors.length); menuBadge.style.display = state.httpErrors.length ? "inline-flex" : "none"; }
  const bellBadge = root.getElementById("notificationBellBadge");
  if (bellBadge) { bellBadge.textContent = count > 99 ? "99+" : String(count); bellBadge.classList.toggle("isVisible", count > 0); }
  if (!root.getElementById("notificationBellPanel")?.classList.contains("isHidden")) renderNotificationBellPanel();
  const errorMonitorDrawerHost = root.getElementById("drawerHost");
  if (errorMonitorDrawerHost?.dataset.view === "errorMonitor" && errorMonitorDrawerHost.dataset.drawerHasBack !== "true") renderErrorMonitorList();
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
  const t = state.t;
  const entries = state.httpErrors.slice(0, 20);
  const introRow = state.showFirstRunNotification ? `
    <button type="button" class="qts-bell-row" data-dismiss-intro>
      <b style="color:var(--qts-ui-primary, #ffd700)">${escapeHtml(t.firstRunTitle)}</b>
      <span>${escapeHtml(t.firstRunBody)}</span>
    </button>
  ` : "";
  const releaseCopy = state.pendingReleaseNote ? releaseNotesCopy() : null;
  const releaseRow = releaseCopy ? `<button type="button" class="qts-bell-row" data-open-release-notes><b style="color:#74e7a5">${escapeHtml(releaseCopy.title)}</b><span>${escapeHtml(releaseCopy.intro)}</span></button>` : "";
  panel.innerHTML = `
    <div class="qts-bell-head"><b>Notificações</b><button type="button" id="notificationBellClear" ${state.httpErrors.length ? "" : "disabled"}>Limpar</button></div>
    ${introRow}
    ${releaseRow}
    ${entries.length ? entries.map((entry) => `
      <button type="button" class="qts-bell-row" data-open-notification>
        <b style="color:${entry.status >= 500 ? "#ff6767" : "#ffb020"}">${entry.status || "-"}</b> ${escapeHtml(entry.method)}
        <span>${escapeHtml(entry.url)}</span>
        <small>${escapeHtml(entry.source)} · ${new Date(entry.capturedAt).toLocaleTimeString()}</small>
      </button>
    `).join("") : (introRow || releaseRow ? "" : `<div class="qts-mini-empty">Nenhuma notificação.</div>`)}
  `;
  panel.querySelector("#notificationBellClear")?.addEventListener("click", () => clearHttpErrors());
  panel.querySelector("[data-dismiss-intro]")?.addEventListener("click", () => dismissFirstRunNotification());
  panel.querySelector("[data-open-release-notes]")?.addEventListener("click", () => { toggleNotificationBellPanel(false); openReleaseNotes(); });
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

// Same message-extraction fallback chain the tampermonkey.js reference used - a plain status
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
  const focus = captureListFocus(body);

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
        <b style="color:${entry.status >= 500 ? "#ff6767" : "#ffb020"}">${entry.status || "-"}</b> ${escapeHtml(entry.method)} <small>${escapeHtml(entry.url)}</small>
        ${message ? `<small style="display:block;margin-top:3px;color:#ddd">${escapeHtml(message)}</small>` : ""}
        <small style="display:block;margin-top:2px;color:#666">${escapeHtml(entry.source)} · ${new Date(entry.capturedAt).toLocaleTimeString()}</small>
      </div>
    `;
    }).join("") : `<div class="qts-empty">${state.httpErrors.length ? t.noFilterResults : t.errorMonitorEmpty}</div>`}</div>
  `;
  body.querySelectorAll("[data-id]").forEach((row) => row.addEventListener("click", () => {
    const entry = state.httpErrors.find((item) => item.id === row.dataset.id);
    if (!entry?.payload) return;
    openDrawer({ title: `${entry.method} ${entry.status}`, bodyHtml: "", view: "errorMonitor", onBack: openErrorMonitorDrawer, onReady: (drawerBody) => renderJsonDetail(drawerBody, entry.payload, entry.method, entry.url, entry.requestHeaders, entry.requestBody) });
  }));
  body.querySelector("#errorMonitorSearch").addEventListener("input", (event) => { errorMonitorFilterState.query = event.target.value; renderErrorMonitorList(); });
  body.querySelector("#errorMonitorCollapseToggle").addEventListener("click", () => { errorMonitorFilterState.collapsed = !errorMonitorFilterState.collapsed; renderErrorMonitorList(); });
  body.querySelector("#errorMonitorClear").addEventListener("click", () => clearHttpErrors());
  wireSmartFilter(body.querySelector("#errorMonitorFilterBar"), (key, value, isSelected) => {
    if (isSelected) errorMonitorFilterState[key].add(value); else errorMonitorFilterState[key].delete(value);
    renderErrorMonitorList();
  });
  restoreListFocus(body, focus);
}

function openErrorMonitorDrawer() {
  openDrawer({ title: state.t.errorMonitorTitle, bodyHtml: "", view: "errorMonitor" });
  renderErrorMonitorList();
}

// ---------------------------------------------------------------------------
// Test accounts: read-only view of the accounts registered (from Settings)
// for the environment matching the current URL. Sandbox-only by design -
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
    const value = field.type === "boolean" ? (field.value ? ICON("pass") : ICON("fail")) : escapeHtml(String(field.value ?? "-"));
    return `<span class="qts-chip"><b>${escapeHtml(field.key)}</b> ${value}</span>`;
  }).join("")}</div>`;
}

// Founder feedback: payment methods already had a one-click "Copiar tudo" per row (every visible
// field, formatted as text) - test accounts only ever copied the username. This brings accounts up
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
    body.innerHTML = `<div class="qts-toolbar-row" style="justify-content:flex-end">${drawerAddButton("testAccount", "Adicionar conta")}</div><div class="qts-empty">${escapeHtml(t.testAccountsNoEnvironment)}</div>`;
    wireDrawerAddButton(body, "testAccount");
    return;
  }

  const allAccounts = (state.workspace.testAccounts || []).filter((account) => (account.environmentIds || []).includes(state.environment.id) && (!account.productIds?.length || account.productIds.includes(state.environment.productId)));
  if (!allAccounts.length) {
    body.innerHTML = `<div class="qts-toolbar-row" style="justify-content:flex-end">${drawerAddButton("testAccount", "Adicionar conta")}</div><div class="qts-empty">${escapeHtml(t.testAccountsEmptyForEnv)}</div>`;
    wireDrawerAddButton(body, "testAccount");
    return;
  }
  const fields = buildTestAccountFilterFields(allAccounts);
  const accounts = allAccounts.filter(matchesTestAccountFilters);
  const focus = captureListFocus(body);

  body.innerHTML = `
    <div class="qts-toolbar-row">
      <input type="search" placeholder="${escapeHtml(t.testAccountsSearchPlaceholder)}" id="testAccountsSearch" value="${escapeHtml(testAccountsFilterState.query)}" class="qts-toolbar-search" />
      <button type="button" class="qts-icon-btn ${testAccountsFilterState.collapsed ? "isActive" : ""}" id="testAccountsCollapseToggle" title="${escapeHtml(t.toggleFilters)}">${ICON("collapse")}</button>
      ${drawerAddButton("testAccount", "Adicionar")}
    </div>
    <div class="qts-filter-bar ${testAccountsFilterState.collapsed ? "isCollapsed" : ""}" id="testAccountsFilterBar">
      ${fields.map((field) => renderSmartFilter(field, testAccountsFilterState[field.key], null)).join("")}
    </div>
    <div id="testAccountsListBody" style="display:grid;gap:10px">${accounts.length ? accounts.map((account) => {
      const revealed = revealedTestAccountIds.has(account.id);
      const passwordDisplay = account.password ? (revealed ? escapeHtml(account.password) : "•".repeat(Math.min(10, account.password.length))) : "-";
      return `
        <div class="qts-net-item" data-account-id="${escapeHtml(account.id)}" style="cursor:default">
          <div style="display:flex;align-items:center;gap:6px">
            ${account.accountTypeImage ? `<img src="${escapeHtml(account.accountTypeImage)}" alt="" style="width:18px;height:18px;border-radius:4px;object-fit:cover" />` : ""}
            <b>${escapeHtml(account.label)}</b>${account.accountType ? ` <span style="color:var(--qts-panel-accent, #ffd700)">${escapeHtml(account.accountType)}</span>` : ""}
          </div>
          <div style="margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <small>${escapeHtml(account.username || "-")}</small>
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
  wireDrawerAddButton(body, "testAccount");

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
  restoreListFocus(body, focus);
}

function openTestAccountsDrawer() {
  openDrawer({ title: state.t.testAccountsDrawerTitle, bodyHtml: "", view: "testAccounts" });
  renderTestAccountsList();
}

// Payment methods and resources are environment-aware, read-only views of
// local configuration. Sensitive payment values remain masked until a direct
// reveal action and never enter the safe workspace export.
const revealedPaymentMethodIds = new Set();

function maskedPaymentValue(value) {
  const raw = String(value || "");
  if (!raw) return "-";
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
    body.innerHTML = `<div class="qts-toolbar-row" style="justify-content:flex-end">${drawerAddButton("paymentMethod", "Adicionar pagamento")}</div><div class="qts-empty">${escapeHtml(state.t.paymentMethodsEmptyForEnv)}</div>`;
    wireDrawerAddButton(body, "paymentMethod");
    return;
  }
  const types = [...new Set(allMethods.map((method) => method.type || "other"))].sort();
  const fields = [{ key: "type", label: "Tipo", options: types.map((value) => ({ value, label: value })) }];
  const methods = allMethods.filter(matchesPaymentMethodFilters);
  const focus = captureListFocus(body);

  body.innerHTML = `
    <div class="qts-toolbar-row">
      <input type="search" placeholder="Buscar meio de pagamento..." id="paymentMethodsSearch" value="${escapeHtml(paymentMethodsFilterState.query)}" class="qts-toolbar-search" />
      <button type="button" class="qts-icon-btn ${paymentMethodsFilterState.collapsed ? "isActive" : ""}" id="paymentMethodsCollapseToggle" title="${escapeHtml(t.toggleFilters)}">${ICON("collapse")}</button>
      ${drawerAddButton("paymentMethod", "Adicionar")}
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
        <b>${escapeHtml(method.label || state.t.paymentMethodFallback)}</b> <span style="color:var(--qts-panel-accent, #ffd700)">${escapeHtml(method.type || "other")}</span>
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
  wireDrawerAddButton(body, "paymentMethod");
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
  restoreListFocus(body, focus);
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
    body.innerHTML = `<div class="qts-toolbar-row" style="justify-content:flex-end">${drawerAddButton("resource", "Adicionar recurso")}</div><div class="qts-empty">${escapeHtml(t.resourcesEmpty)}</div>`;
    wireDrawerAddButton(body, "resource");
    return;
  }
  const categories = [...new Set(allResources.map((resource) => resource.category).filter(Boolean))].sort();
  const fields = categories.length ? [{ key: "category", label: t.filterCategory, options: categories.map((value) => ({ value, label: value })) }] : [];
  const resources = allResources.filter(matchesResourceFilters);
  const focus = captureListFocus(body);

  body.innerHTML = `
    <div class="qts-toolbar-row">
      <input type="search" placeholder="${escapeHtml(t.resourcesSearchPlaceholder)}" id="resourcesSearch" value="${escapeHtml(resourcesFilterState.query)}" class="qts-toolbar-search" />
      <button type="button" class="qts-icon-btn ${resourcesFilterState.collapsed ? "isActive" : ""}" id="resourcesCollapseToggle" title="${escapeHtml(t.toggleFilters)}">${ICON("collapse")}</button>
      ${drawerAddButton("resource", "Adicionar")}
    </div>
    <div class="qts-filter-bar ${resourcesFilterState.collapsed ? "isCollapsed" : ""}" id="resourcesFilterBar">
      ${fields.map((field) => renderSmartFilter(field, resourcesFilterState[field.key], null)).join("")}
    </div>
    <div style="display:grid;gap:10px">${resources.length ? resources.map((resource) => `
      <a class="qts-net-item" href="${escapeHtml(resource.safeUrl)}" target="_blank" rel="noopener noreferrer" style="display:block;color:#fff;text-decoration:none">
        ${resource.icon ? `<img src="${escapeHtml(resource.icon)}" alt="" style="width:16px;height:16px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:4px" />` : ""}<b>${escapeHtml(resource.label || resource.safeUrl)}</b>${resource.category ? ` <span style="color:var(--qts-panel-accent, #ffd700)">${escapeHtml(resource.category)}</span>` : ""}
        <small style="display:block;margin-top:4px;color:#888">${escapeHtml(resource.safeUrl)}</small>
      </a>
    `).join("") : `<div class="qts-empty">${escapeHtml(t.noFilterResults)}</div>`}</div>
  `;
  wireDrawerAddButton(body, "resource");
  body.querySelector("#resourcesSearch").addEventListener("input", (event) => { resourcesFilterState.query = event.target.value; renderResourcesList(); });
  body.querySelector("#resourcesCollapseToggle").addEventListener("click", () => { resourcesFilterState.collapsed = !resourcesFilterState.collapsed; renderResourcesList(); });
  wireSmartFilter(body.querySelector("#resourcesFilterBar"), (key, value, isSelected) => {
    if (isSelected) resourcesFilterState[key].add(value); else resourcesFilterState[key].delete(value);
    renderResourcesList();
  });
  restoreListFocus(body, focus);
}

function openResourcesDrawer() {
  openDrawer({ title: state.t.resourcesDrawerTitle, bodyHtml: "", view: "resources" });
  renderResourcesList();
}

// ---------------------------------------------------------------------------
// JSON Studio: format/compact/copy any pasted JSON.
// ---------------------------------------------------------------------------

// Recursive structural diff between two parsed JSON values - the original spec (see
// docs/handoff/archive/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md's jsonDiff.enabled capability) called for real
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
  if (!diffs.length) return `<div class="qts-empty">Nenhuma diferença - os dois JSONs são equivalentes.</div>`;
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
    view: "jsonStudio",
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
// Breakpoint Viewer: full-screen device-frame comparison (not a sidebar) -
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
    .qts-bp-overlay { --bp-bg:#050505;--bp-surface:#111;--bp-control:#1a1a1a;--bp-border:#333;--bp-text:#fff;--bp-muted:#ccc; position: fixed; inset: 0; z-index: 2147483647; background: var(--bp-bg); display: flex; flex-direction: column; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--bp-text); }
    :host([data-theme="light"]) .qts-bp-overlay { --bp-bg:#eef1f6;--bp-surface:#fff;--bp-control:#f7f9fc;--bp-border:#b8c2d3;--bp-text:#171a24;--bp-muted:#536078; }
    @media (prefers-color-scheme:light) { :host([data-theme="system"]) .qts-bp-overlay { --bp-bg:#eef1f6;--bp-surface:#fff;--bp-control:#f7f9fc;--bp-border:#b8c2d3;--bp-text:#171a24;--bp-muted:#536078; } }
    .qts-bp-topbar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--bp-border); background: var(--bp-surface); flex-wrap: wrap; }
    .qts-bp-topbar input[type="url"] { flex: 1 1 220px; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--bp-border); border-radius: 8px; background: var(--bp-control); color: var(--bp-text); }
    .qts-bp-topbar select { height: 34px; padding: 0 8px; border: 1px solid var(--bp-border); border-radius: 8px; background: var(--bp-control); color: var(--bp-text); }
    .qts-bp-toggle { height: 34px; padding: 0 12px; border: 1px solid var(--bp-border); border-radius: 8px; background: var(--bp-control); color: var(--bp-muted); cursor: pointer; font-weight: 700; }
    .qts-bp-zoom { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px; border: 1px solid var(--bp-border); border-radius: 8px; background: var(--bp-control); }
    .qts-bp-zoom-btn { all: unset; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 5px; background: #262626; color: #fff; cursor: pointer; font-weight: 900; }
    .qts-bp-zoom-btn:hover { background: #333; }
    .qts-bp-zoom input[type="range"] { width: 90px; }
    #bpZoomLabel { min-width: 38px; text-align: center; color: var(--bp-muted); font-variant-numeric: tabular-nums; }
    .qts-bp-toggle.isOn { background: #147b49; border-color: #1ca868; color: #fff; }
    .qts-bp-close { width: 34px; height: 34px; border: 0; border-radius: 8px; background: var(--qts-ui-danger, #c70e0e); color:#fff; font-size: 18px; cursor: pointer; display:flex; align-items:center; justify-content:center; }
    .qts-bp-stage { flex: 1; display: flex; align-items: center; align-content: center; justify-content: center; flex-wrap: wrap; gap: 26px; overflow: auto; padding: 20px; }
    .qts-bp-pane { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 0 1 auto; min-width: 0; max-width: 100%; }
    .qts-bp-frame { display: flex; flex-direction: column; align-items: center; background: var(--bp-control); border-radius: 14px; padding: 8px; box-shadow: 0 30px 70px rgba(0,0,0,.25); }
    .qts-bp-frame.kind-phone { border-radius: 34px; padding: 14px 8px; border: 2px solid #2c2c2c; }
    .qts-bp-laptop-bar { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
    .qts-bp-laptop-bar .dot { width: 8px; height: 8px; border-radius: 50%; }
    .qts-bp-laptop-bar .dot.r { background: #ff5f57; } .qts-bp-laptop-bar .dot.y { background: #febc2e; } .qts-bp-laptop-bar .dot.g { background: #28c840; }
    .qts-bp-address { margin-left: 8px; padding: 3px 10px; border-radius: 6px; background: var(--bp-surface); color: var(--bp-muted); font-size: 10px; }
    .qts-bp-phone-status { width: 100%; display: flex; justify-content: space-between; padding: 4px 14px; color: var(--bp-muted); font-size: 10px; }
    .qts-bp-viewport-wrap { position: relative; overflow: hidden; background: #fff; border-radius: 4px; }
    .qts-bp-viewport-wrap iframe { position: absolute; top: 0; left: 0; transform-origin: top left; border: 0; }
    .qts-bp-home-indicator { width: 90px; height: 4px; border-radius: 99px; background: #444; margin-top: 8px; }
    .qts-bp-scale-label { color: var(--bp-muted); font-size: 10px; }
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
        <button type="button" class="qts-bp-toggle" id="bpReload" title="Recarregar as duas visualizações">${ICON("undo")} Recarregar</button>
        <div class="qts-bp-zoom">
          <button type="button" class="qts-bp-zoom-btn" id="bpZoomOut" title="Reduzir zoom">−</button>
          <input type="range" id="bpZoom" min="50" max="200" step="10" value="100" title="Zoom" />
          <span id="bpZoomLabel">100%</span>
          <button type="button" class="qts-bp-zoom-btn" id="bpZoomIn" title="Aumentar zoom">+</button>
        </div>
        <button type="button" class="qts-bp-toggle" id="bpSyncScroll">${escapeHtml(t.syncScroll)}</button>
        <button type="button" class="qts-bp-toggle" id="bpSyncClick">${escapeHtml(t.syncClick)}</button>
        <button type="button" class="qts-bp-toggle" id="bpRecord">${ICON("recordStart")} Gravar tela cheia</button>
        <button type="button" class="qts-bp-close" id="bpClose">${ICON("fail")}</button>
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
  drawerHost.querySelector("#bpRecord").addEventListener("click", () => {
    if (recordingState.status === "idle") startEvidenceRecording("video");
    else handleRecordToggle();
  });
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
    // relative real-world proportions intact - a 1280px monitor must always
    // render bigger than a 379px phone at the same zoom. Fitting each device
    // to its own box independently (the previous bug) let the phone claim
    // ~100% while the monitor was squeezed down, inverting their real sizes.
    const paneWidthBudget = stage.clientWidth / 2 - 50;
    const paneHeightBudget = stage.clientHeight - 70;
    const widestDevice = Math.max(deviceA.width, deviceB.width);
    const tallestDevice = Math.max(deviceA.height, deviceB.height);
    // The zoom control (breakpointViewerState.zoomMultiplier) is a separate, user-driven
    // multiplier layered on top of the auto-fit base scale, applied identically to both panes -
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
    const light = state.workspace?.preferences?.appearanceTheme === "light";
    toast.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:${light ? "#fff" : "#101010"};color:${light ? "#171a24" : "#fff"};border:1px solid var(--qts-ui-primary, ${light ? "#5b35e8" : "#ffd700"});border-radius:999px;padding:10px 16px;z-index:2147483647;font-size:12px;max-width:80vw;text-align:center;box-shadow:0 12px 30px rgba(0,0,0,.24)`;
    drawerHost.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3500);
  }

  urlInput.addEventListener("change", fitAndLoad);
  drawerHost.querySelector("#bpReload").addEventListener("click", () => {
    const url = normalizedPreviewUrl();
    if (!url) { showToolbarToast("Informe uma URL HTTP ou HTTPS válida."); return; }
    stage.querySelectorAll("[data-bp-iframe]").forEach((iframe) => {
      iframe.src = "about:blank";
      window.setTimeout(() => { iframe.src = url; }, 0);
    });
  });
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

const REPEAT_WINDOW_MS = 900; // max gap between presses that still counts as "the same run"
const REPEAT_VISIBLE_MS = 3_000; // how long the badge lingers after the run stops, before it fades

// Shared by mouse clicks/scroll and keyboard combos: bumps the count while presses keep landing
// inside REPEAT_WINDOW_MS of each other, restarts the same window on every new press (so the badge
// only starts its 3s countdown once presses actually stop), then fades and zeroes the counter.
function registerRepeat(tracker, signature, onCount, onFadeStart, onReset) {
  const now = Date.now();
  tracker.count = tracker.signature === signature && now - (tracker.lastAt || 0) < REPEAT_WINDOW_MS ? tracker.count + 1 : 1;
  tracker.signature = signature;
  tracker.lastAt = now;
  onCount(tracker.count);
  window.clearTimeout(tracker.resetTimer);
  tracker.resetTimer = window.setTimeout(() => {
    onFadeStart();
    window.setTimeout(() => { tracker.count = 0; tracker.signature = null; onReset(); }, 500);
  }, REPEAT_VISIBLE_MS);
}

function updateCountBadge(badge, count) {
  if (!badge) return;
  if (count > 1) { badge.textContent = `×${count}`; badge.classList.remove("isFading"); badge.classList.add("isVisible"); }
  else { badge.classList.remove("isVisible"); badge.classList.remove("isFading"); }
}

function showKeyViewShortcut(labels) {
  if (!labels.length) return;
  const overlay = ensureKeyViewOverlay();
  const shortcut = overlay.querySelector("[data-key-view-shortcut]");
  const preferences = getKeyViewPreferences();
  shortcut.innerHTML = labels.map((label) => keycapSvg(label, preferences.keySize)).join('<span class="qts-key-plus">+</span>') + '<span class="qts-key-view-count-badge" data-key-count></span>';
  shortcut.classList.toggle("isPressed", true);
  shortcut.querySelectorAll(".qts-keycap").forEach((keycap) => keycap.classList.add("isPressed"));
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
  const badge = shortcut.querySelector("[data-key-count]");
  registerRepeat(
    state.keyView.keyRepeat,
    labels.join("+"),
    (count) => updateCountBadge(badge, count),
    () => badge?.classList.add("isFading"),
    () => updateCountBadge(badge, 0),
  );
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
  </svg><span class="qts-mouse-count-badge" data-mouse-count></span>`;
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
  // duration=null means "sticky": a real mousedown/mouseup pair drives visibility (see
  // onMouseDown/onMouseUp below) instead of a fixed timer, so holding the button down keeps the
  // pressed visual instead of it fading out from under a still-held button.
  if (duration !== null) state.keyView.mouseTimer = window.setTimeout(() => overlay.classList.remove("isVisible"), duration);
  return overlay;
}

function bumpMouseRepeat(overlay, action) {
  const badge = overlay?.querySelector("[data-mouse-count]");
  registerRepeat(
    state.keyView.mouseRepeat,
    action,
    (count) => updateCountBadge(badge, count),
    () => badge?.classList.add("isFading"),
    () => updateCountBadge(badge, 0),
  );
}

function handleKeyViewKeydown(event) {
  if (isKeyViewOwnSurface(event)) return;
  const sensitive = isSensitiveTypingTarget(event.target);
  const labels = shortcutLabels(event);
  const namedOrModified = event.ctrlKey || event.altKey || event.metaKey || event.key.length > 1 || event.key === " ";
  // Named keys/combos (Enter, Ctrl+C, arrows...) never reveal typed content, so they always flash --
  // but a bare printable character would, letter by letter, replay a password on screen for anyone
  // watching a recording. Everywhere else (every other key, every non-sensitive field) now flashes,
  // matching the "show every keystroke" ask; sensitive fields are the one deliberate exception.
  const revealsSensitiveContent = !namedOrModified && event.key.length === 1 && sensitive;
  // event.repeat (the OS auto-repeating a physically held key) isn't a new press -- counting it
  // would make the badge spin up just from holding a key, and re-flashing on every repeat is what
  // made a held key "look stuck" before. A genuinely new press always clears repeat first.
  if (labels.length && !event.repeat && !revealsSensitiveContent) { state.keyView.heldKeys.set(event.code, true); showKeyViewShortcut(labels); }
  if (!getKeyViewPreferences().typingMode || sensitive || editableTypingTarget(event.target)) return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key.length === 1) appendKeyViewTyping(event.key);
  else if (event.key === "Enter") appendKeyViewTyping("\n");
  else if (event.key === "Tab") appendKeyViewTyping("\t");
  else if (event.key === "Backspace") deleteKeyViewTypingCharacter();
}

function handleKeyViewKeyup(event) {
  if (isKeyViewOwnSurface(event)) return;
  state.keyView.heldKeys.delete(event.code);
  if (state.keyView.heldKeys.size) return;
  const overlay = document.getElementById("qts-key-view-overlay");
  const shortcut = overlay?.querySelector("[data-key-view-shortcut]");
  shortcut?.classList.remove("isPressed");
  shortcut?.querySelectorAll(".qts-keycap.isPressed").forEach((keycap) => keycap.classList.remove("isPressed"));
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
    const action = event.button === 2 ? "right" : event.button === 1 ? "middle" : "left";
    const overlay = showMouseView(action, null);
    overlay?.classList.add("isPressed");
    bumpMouseRepeat(overlay, action);
  };
  const onMouseUp = () => {
    const overlay = document.getElementById("qts-mouse-view-overlay");
    if (!overlay) return;
    overlay.classList.remove("isPressed");
    window.clearTimeout(state.keyView.mouseTimer);
    state.keyView.mouseTimer = window.setTimeout(() => overlay.classList.remove("isVisible"), 320);
  };
  const onWheel = (event) => {
    if (isKeyViewOwnSurface(event) || event.deltaY === 0) return;
    state.keyView.pointerX = event.clientX; state.keyView.pointerY = event.clientY;
    const action = event.deltaY < 0 ? "scroll-up" : "scroll-down";
    const overlay = showMouseView(action, 750);
    bumpMouseRepeat(overlay, action);
  };
  document.addEventListener("keydown", handleKeyViewKeydown, true);
  document.addEventListener("keyup", handleKeyViewKeyup, true);
  document.addEventListener("beforeinput", handleKeyViewBeforeInput, true);
  document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  document.addEventListener("mousedown", onMouseDown, { capture: true, passive: true });
  document.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
  document.addEventListener("wheel", onWheel, { capture: true, passive: true });
  state.keyView.cleanup = () => {
    document.removeEventListener("keydown", handleKeyViewKeydown, true);
    document.removeEventListener("keyup", handleKeyViewKeyup, true);
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
  state.keyView.heldKeys.clear();
  window.clearTimeout(state.keyView.shortcutTimer);
  window.clearTimeout(state.keyView.mouseTimer);
  window.clearTimeout(state.keyView.keyRepeat.resetTimer);
  window.clearTimeout(state.keyView.mouseRepeat.resetTimer);
  state.keyView.keyRepeat = { signature: null, count: 0, resetTimer: null };
  state.keyView.mouseRepeat = { signature: null, count: 0, resetTimer: null };
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
    view: "keyView",
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
      const persistSwitch = async (input, preference) => {
        input.disabled = true;
        await saveKeyViewPreferences({ [preference]: input.checked });
        input.disabled = false;
        body.querySelector("#keyViewStatus").textContent = translateQaSurfaceText("Configurações salvas.");
      };
      body.querySelector("#keyViewTyping").addEventListener("change", (event) => persistSwitch(event.currentTarget, "typingMode"));
      body.querySelector("#keyViewMouse").addEventListener("change", (event) => persistSwitch(event.currentTarget, "mouseEffects"));
      body.querySelector("#keyViewSave").addEventListener("click", async () => {
        await saveKeyViewPreferences({ typingMode: body.querySelector("#keyViewTyping").checked, mouseEffects: body.querySelector("#keyViewMouse").checked, theme: theme.value, position: selectedPosition, keySize: keySize.value, mouseSize: mouseSize.value });
        body.querySelector("#keyViewStatus").textContent = translateQaSurfaceText("Configurações salvas.");
      });
      body.querySelector("#keyViewClear").addEventListener("click", () => { clearKeyViewTyping(); body.querySelector("#keyViewStatus").textContent = translateQaSurfaceText("Texto limpo."); });
    },
  });
}

// A shared, persistent stacking container instead of each toast positioning itself independently
// -- previously two toasts fired close together (a common case: an action's own confirmation plus
// a follow-up warning) landed on top of each other at the same fixed spot. column-reverse means a
// new toast grows the stack upward from the anchored bottom position, like a real toast stack.
function ensureToastContainer() {
  if (!state.shadowRoot) return null;
  let container = state.shadowRoot.getElementById("qtsToastContainer");
  if (container) return container;
  container = document.createElement("div");
  container.id = "qtsToastContainer";
  container.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;display:flex;flex-direction:column-reverse;gap:8px;align-items:center;pointer-events:none;max-width:min(620px,88vw)";
  state.shadowRoot.appendChild(container);
  return container;
}

function showQaToast(message, tone = "info") {
  const container = ensureToastContainer();
  if (!container) return;
  const light = state.workspace?.preferences?.appearanceTheme === "light";
  const toast = document.createElement("div");
  toast.textContent = translateQaSurfaceText(message);
  const toastAccent = tone === "error" ? `var(--qts-ui-danger, ${light ? "#c92331" : "#ff6767"})` : `var(--qts-ui-primary, ${light ? "#5b35e8" : "#ffd700"})`;
  toast.style.cssText = `pointer-events:auto;padding:10px 16px;border:1px solid ${toastAccent};border-radius:999px;background:${light ? "#fff" : "#0b0b0b"};color:${light ? "#171a24" : "#fff"};font:700 12px/1.35 sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.28);opacity:0;transform:translateY(14px) scale(.92);transition:opacity 220ms ease,transform 260ms cubic-bezier(.34,1.56,.64,1)`;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0) scale(1)";
  });
  const dismiss = () => {
    toast.style.transition = "opacity 180ms ease,transform 180ms ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px) scale(.94)";
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  };
  window.setTimeout(dismiss, 3_500);
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
// one. Never captures `.value` for any field (privacy) - only structural/locator data for the
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
      testId: element.getAttribute("data-testid") || element.getAttribute("data-test-id") || element.getAttribute("data-qa") || element.getAttribute("data-cy") || "",
      role: element.getAttribute("role") || "",
      cssSelector: window.QTS_QA_TOOLS.uniqueSelector(element),
      xpath: buildXPath(element),
      text: String(element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
      placeholder: element.getAttribute("placeholder") || "",
      // Icon-only buttons/links have no text at all - the closest thing to a "visible label" for
      // those is whatever image they contain (or, if the element itself is one, its own src).
      imagePreview: element.tagName === "IMG" ? element.getAttribute("src") || "" : element.querySelector("img")?.getAttribute("src") || "",
      sensitive: window.QTS_QA_TOOLS.isSensitiveElement(element),
    }));
}

// Element Capture's own "Localizar" - unlike locateValueOnPage's exact-text search (built for
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
  else if (element instanceof HTMLSelectElement) parts.push(["Opção selecionada", element.options[element.selectedIndex]?.text || "-"]);
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
  const headers = ["tag", "type", "name", "id", "test_id", "role", "css_selector", "xpath", "text", "placeholder", "sensitive"];
  const csvKeys = ["tag", "type", "name", "id", "testId", "role", "cssSelector", "xpath", "text", "placeholder", "sensitive"];
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

// "Ver elementos": overlays a small live label on the page next to every captured element,
// showing whichever locator fields the user picked (#id, data-test-id, role, XPath) -- reusing
// the same 200ms-poll-and-reposition pattern attachCharacterCounterBadge already uses instead of
// scroll/resize listeners, since it self-heals for free (a detached element's label just stops
// updating and gets swept on the next tick) and matches this file's existing convention. Runs
// independently of the drawer, same as Holofote/Borrar elementos -- closing the drawer doesn't
// turn it off, only the toggle button (or the toolbar itself going away) does.
const ELEMENT_VIEW_FIELD_LABELS = { id: "ID", testId: "data-test-id", role: "role", xpath: "XPath" };

function enableElementView(rows, fields) {
  disableElementView();
  const container = document.createElement("div");
  container.id = "qts-element-view-overlay";
  container.className = "qts-floating-item";
  document.body.appendChild(container);
  const reposition = () => {
    if (!container.isConnected) return;
    const parts = [];
    for (const row of rows) {
      let element = null;
      try { element = row.cssSelector ? document.querySelector(row.cssSelector) : null; } catch { element = null; }
      if (!element || isInsideToolbarUi(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const lines = [...fields].map((field) => (row[field] ? `${ELEMENT_VIEW_FIELD_LABELS[field]}: ${row[field]}` : null)).filter(Boolean);
      if (!lines.length) continue;
      parts.push(`<div class="qts-element-view-label" style="left:${Math.max(0, rect.left)}px;top:${Math.max(0, rect.top - 16)}px">${escapeHtml(lines.join(" · "))}</div>`);
    }
    container.innerHTML = parts.join("");
  };
  const timer = window.setInterval(() => {
    if (!container.isConnected) { window.clearInterval(timer); return; }
    reposition();
  }, 200);
  reposition();
  state.elementViewCleanup = () => { window.clearInterval(timer); container.remove(); state.elementViewCleanup = null; };
}

function disableElementView() {
  state.elementViewCleanup?.();
}

// Complements the Shapes "Borrão" effect (a drawn box over an area) with a per-element blur --
// click a real element (a name, an ID, anything sensitive) to blur it in place, click it again to
// undo. Reuses selectPageElement's existing hover/click/Esc selection UI instead of building a
// second one, and re-arms itself after each pick so the user can blur several elements in one go.
function toggleElementBlur(element) {
  if (!state.blurredElements) state.blurredElements = new Set();
  if (state.blurredElements.has(element)) { element.classList.remove("qts-blurred-element"); state.blurredElements.delete(element); }
  else { element.classList.add("qts-blurred-element"); state.blurredElements.add(element); }
}

function drawerAddButton(kind, label) {
  return `<button type="button" class="action primary" data-add-workspace-item="${escapeHtml(kind)}">+ ${escapeHtml(label)}</button>`;
}

function wireDrawerAddButton(body, kind) {
  body.querySelector(`[data-add-workspace-item="${kind}"]`)?.addEventListener("click", () => openWorkspaceQuickComposer(kind));
}

function openWorkspaceQuickComposer(kind) {
  const definitions = {
    testAccount: { title: "Adicionar conta de teste", collection: "testAccounts", reopen: openTestAccountsDrawer,
      fields: `<label>Nome<input name="label" required maxlength="120" /></label><label>Tipo<input name="accountType" maxlength="60" /></label><label>Usuário / e-mail<input name="username" maxlength="200" autocomplete="off" /></label><label>Senha sandbox<input name="password" type="password" maxlength="200" autocomplete="new-password" /></label><label>Observações<textarea name="notes" maxlength="1000"></textarea></label>`,
      build: v => ({ id: crypto.randomUUID(), environmentIds: [state.environment.id], productIds: state.environment.productId ? [state.environment.productId] : [], label: v.label, accountType: v.accountType, username: v.username, password: v.password, notes: v.notes, customFields: [], active: true }) },
    paymentMethod: { title: "Adicionar pagamento sandbox", collection: "paymentMethods", reopen: openPaymentMethodsDrawer,
      fields: `<label>Nome<input name="label" required maxlength="120" /></label><label>Tipo<select name="type"><option value="card">Cartão</option><option value="pix">PIX</option><option value="bank">Conta bancária</option><option value="other">Outro</option></select></label><label>Número ou token sandbox<input name="value" maxlength="240" autocomplete="off" /></label><label>Titular<input name="holder" maxlength="120" /></label><label>Validade<input name="expiry" maxlength="20" placeholder="MM/AA" /></label><label>CVV sandbox<input name="cvv" maxlength="20" autocomplete="off" /></label><label>Observações<textarea name="notes" maxlength="1000"></textarea></label>`,
      build: v => ({ id: crypto.randomUUID(), environmentIds: state.environment ? [state.environment.id] : [], productIds: state.environment?.productId ? [state.environment.productId] : [], label: v.label, type: v.type, value: v.value, holder: v.holder, expiry: v.expiry, cvv: v.cvv, notes: v.notes, active: true }) },
    resource: { title: "Adicionar recurso ou link", collection: "resources", reopen: openResourcesDrawer,
      fields: `<label>Nome<input name="label" required maxlength="120" /></label><label>URL<input name="url" type="url" required maxlength="2048" placeholder="https://..." /></label><label>Categoria<input name="category" maxlength="60" /></label>`,
      build: v => ({ id: crypto.randomUUID(), label: v.label, url: v.url, category: v.category, active: true }) },
  };
  const definition = definitions[kind];
  if (!definition) return;
  if (kind === "testAccount" && !state.environment) { showQaToast("Vincule esta página a um ambiente antes de criar uma conta.", "error"); return; }
  openDrawer({ title: definition.title, variant: "modal", bodyHtml: `<p class="qts-tool-lead">Salvo no mesmo workspace das Configurações e carregado imediatamente.</p><form id="workspaceQuickComposer" style="display:grid;gap:12px">${definition.fields}<div class="qts-toolbar-row" style="justify-content:flex-end"><button type="button" class="action" id="quickComposerCancel">Cancelar</button><button type="submit" class="action primary">Salvar</button></div></form>`, onReady(body) {
    body.querySelector("#quickComposerCancel").addEventListener("click", definition.reopen);
    body.querySelector("#workspaceQuickComposer").addEventListener("submit", async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); state.workspace[definition.collection] = [...(state.workspace[definition.collection] || []), definition.build(values)]; state.workspace = await saveWorkspace(state.workspace); definition.reopen(); showQaToast("Item salvo e carregado no sidebar."); });
  } });
}

function syncModeShortcutStates() {
  const blurActive = state.blurSelectionActive === true;
  const blurQuick = state.shadowRoot?.getElementById("blurQuickButton");
  blurQuick?.classList.toggle("isActive", blurActive);
  blurQuick?.setAttribute("aria-pressed", String(blurActive));
  state.shadowRoot?.getElementById("blurElementsMenuItem")?.classList.toggle("isActive", blurActive);
  const holofoteQuick = state.shadowRoot?.getElementById("holofoteQuickButton");
  holofoteQuick?.classList.toggle("isActive", state.holofoteActive === true);
  holofoteQuick?.setAttribute("aria-pressed", String(state.holofoteActive === true));
}

function armBlurSelection(onChanged) {
  selectPageElement({
    instruction: "Clique num elemento para borrar (ou desborrar, se já estiver). Esc para parar.",
    onSelected: (element) => {
      toggleElementBlur(element);
      onChanged?.();
      armBlurSelection(onChanged);
    },
    onCleanup: () => {
      state.blurSelectionActive = false;
      syncModeShortcutStates();
    },
  });
  state.blurSelectionActive = true;
  syncModeShortcutStates();
}

function toggleBlurSelectionMode() {
  if (state.blurSelectionActive) {
    cancelElementSelection();
    state.blurSelectionActive = false;
    syncModeShortcutStates();
    return;
  }
  armBlurSelection();
}

function clearAllBlurredElements() {
  if (!state.blurredElements) return;
  for (const element of state.blurredElements) element.classList.remove("qts-blurred-element");
  state.blurredElements.clear();
}

function openBlurElementsTool() {
  openDrawer({
    title: "Borrar elementos",
    view: "blurElements",
    bodyHtml: `<p class="qts-tool-lead">Clique em elementos da página para borrar informações sensíveis antes de um screenshot ou gravação, ou clique com o botão direito num elemento e escolha "Borrar / desborrar este elemento" no menu QA Sandbox.</p>
      <div class="qts-card-actions"><button class="action primary" id="blurSelectElement" type="button">Selecionar elemento</button><button class="action" id="blurClearAll" type="button">Limpar todos os borrados</button></div>
      <div class="qts-status" id="blurStatus"></div>
      <div class="qts-list" id="blurList"></div>`,
    onReady(body) {
      const status = body.querySelector("#blurStatus");
      const list = body.querySelector("#blurList");
      const render = () => {
        const elements = [...(state.blurredElements || [])];
        status.textContent = elements.length ? translateQaSurfaceText(`${elements.length} elemento(s) borrado(s).`) : translateQaSurfaceText("Nenhum elemento borrado ainda.");
        list.innerHTML = elements.map((element, index) => `
          <div class="qts-list-row" data-blur-row="${index}">
            <span>${escapeHtml(describeElementForMacro(element))}</span>
            <button type="button" data-blur-remove="${index}" title="${escapeHtml(state.t.remove)}">${ICON("fail")}</button>
          </div>
        `).join("");
        list.querySelectorAll("[data-blur-remove]").forEach((button) => {
          button.addEventListener("click", () => {
            const element = elements[Number(button.dataset.blurRemove)];
            if (element) toggleElementBlur(element);
            render();
          });
        });
      };
      body.querySelector("#blurSelectElement").addEventListener("click", () => armBlurSelection(render));
      body.querySelector("#blurClearAll").addEventListener("click", () => { clearAllBlurredElements(); render(); });
      render();
    },
  });
}

// Holding the mouse for 3s anywhere on the page shows a spotlight around the cursor (darken or
// blur outside a circle that follows the mouse), fading in on the way up and taking a slow 3s
// fade back out on release -- never preventDefault's the actual mousedown/mouseup/click, so the
// page underneath keeps working normally the whole time (this is a passive visual layer, not a
// selection mode like Borrar/Element Capture).
const HOLOFOTE_HOLD_MS = 2_000;
const HOLOFOTE_FADE_MS = 3_000;
let holofoteSettings = { effect: "darken", size: 140, opacity: 70, blur: 10 };
let holofoteHoldTimer = null;
let holofoteFadeTimer = null;

function ensureHolofoteOverlay() {
  let overlay = document.getElementById("qts-holofote-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "qts-holofote-overlay";
  overlay.className = "qts-floating-item";
  document.body.appendChild(overlay);
  return overlay;
}

function applyHolofoteSettings(overlay) {
  overlay.style.setProperty("--qts-holofote-size", `${holofoteSettings.size}px`);
  if (holofoteSettings.effect === "blur") {
    overlay.style.setProperty("--qts-holofote-bg", "rgba(0,0,0,.05)");
    overlay.style.setProperty("--qts-holofote-blur", `blur(${holofoteSettings.blur}px)`);
  } else {
    overlay.style.setProperty("--qts-holofote-bg", `rgba(0,0,0,${holofoteSettings.opacity / 100})`);
    overlay.style.setProperty("--qts-holofote-blur", "none");
  }
}

function moveHolofote(x, y) {
  const overlay = ensureHolofoteOverlay();
  overlay.style.setProperty("--qts-holofote-x", `${x}px`);
  overlay.style.setProperty("--qts-holofote-y", `${y}px`);
}

// Activation moved from click-and-hold to Ctrl-and-hold after founder feedback that click-hold
// felt wrong for a passive visual aid (it competed with actually clicking things on the page).
// Holding Ctrl has real collisions with browser/OS shortcuts (Ctrl+C, Ctrl+F, Ctrl+Tab...), so the
// hold timer is cancelled the moment any other key goes down alongside it, or when focus is in a
// text field where Ctrl shortcuts are routine - a stray shortcut should never light up the overlay.
function isEditableFocus() {
  const active = document.activeElement;
  return Boolean(active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable));
}

function enableHolofoteMode() {
  if (state.holofoteActive) return;
  state.holofoteActive = true;
  state.shadowRoot?.getElementById("holofoteMenuItem")?.classList.add("isActive");
  syncModeShortcutStates();
  let lastMouseX = window.innerWidth / 2;
  let lastMouseY = window.innerHeight / 2;
  const clearHold = () => {
    clearTimeout(holofoteHoldTimer);
    holofoteHoldTimer = null;
  };
  const fadeOut = () => {
    const overlay = document.getElementById("qts-holofote-overlay");
    if (overlay?.classList.contains("isVisible")) {
      overlay.style.transitionDuration = `${HOLOFOTE_FADE_MS}ms`;
      overlay.classList.remove("isVisible");
    }
  };
  const moveHandler = (event) => { lastMouseX = event.clientX; lastMouseY = event.clientY; moveHolofote(lastMouseX, lastMouseY); };
  const keyDownHandler = (event) => {
    if (event.key !== "Control" || event.repeat || holofoteHoldTimer || isEditableFocus()) return;
    clearTimeout(holofoteFadeTimer);
    holofoteHoldTimer = setTimeout(() => {
      const overlay = ensureHolofoteOverlay();
      applyHolofoteSettings(overlay);
      moveHolofote(lastMouseX, lastMouseY);
      overlay.style.transitionDuration = "220ms";
      overlay.classList.add("isVisible");
    }, HOLOFOTE_HOLD_MS);
  };
  // Any other key pressed while Ctrl is down means this is a real shortcut (Ctrl+C, Ctrl+F...),
  // not someone holding Ctrl on its own to summon the spotlight - cancel the pending hold.
  const otherKeyHandler = (event) => { if (event.key !== "Control" && event.ctrlKey) clearHold(); };
  const keyUpHandler = (event) => {
    if (event.key !== "Control") return;
    clearHold();
    fadeOut();
  };
  const blurHandler = () => { clearHold(); fadeOut(); };
  document.addEventListener("mousemove", moveHandler, true);
  document.addEventListener("keydown", keyDownHandler, true);
  document.addEventListener("keydown", otherKeyHandler, true);
  document.addEventListener("keyup", keyUpHandler, true);
  window.addEventListener("blur", blurHandler);
  state.holofoteCleanup = () => {
    document.removeEventListener("mousemove", moveHandler, true);
    document.removeEventListener("keydown", keyDownHandler, true);
    document.removeEventListener("keydown", otherKeyHandler, true);
    document.removeEventListener("keyup", keyUpHandler, true);
    window.removeEventListener("blur", blurHandler);
    clearHold();
    document.getElementById("qts-holofote-overlay")?.classList.remove("isVisible");
  };
}

function disableHolofoteMode() {
  state.holofoteActive = false;
  state.shadowRoot?.getElementById("holofoteMenuItem")?.classList.remove("isActive");
  state.holofoteCleanup?.();
  state.holofoteCleanup = null;
  syncModeShortcutStates();
}

function toggleHolofoteMode() {
  if (state.holofoteActive) disableHolofoteMode();
  else enableHolofoteMode();
}

function openHolofoteTool() {
  openDrawer({
    title: "Modo Holofote",
    view: "holofote",
    bodyHtml: `<p class="qts-tool-lead">Ative e segure Ctrl por 2 segundos em qualquer momento para acender um holofote ao redor do mouse, útil pra guiar a atenção em demonstrações e gravações. Soltar Ctrl apaga o holofote suavemente.</p>
      <div class="qts-card-actions"><button class="action ${state.holofoteActive ? "" : "primary"}" id="holofoteToggle" type="button">${state.holofoteActive ? "Desativar" : "Ativar"}</button></div>
      <label>Efeito<select id="holofoteEffect">
        <option value="darken">Escurecer</option>
        <option value="blur">Borrar</option>
      </select></label>
      <label>Opacidade (efeito Escurecer)<input type="range" min="20" max="95" id="holofoteOpacity" /></label>
      <label>Intensidade do borrão (efeito Borrar)<input type="range" min="2" max="24" id="holofoteBlur" /></label>
      <label>Tamanho do holofote<input type="range" min="60" max="320" id="holofoteSize" /></label>`,
    onReady(body) {
      const toggle = body.querySelector("#holofoteToggle");
      const effectInput = body.querySelector("#holofoteEffect");
      const opacityInput = body.querySelector("#holofoteOpacity");
      const blurInput = body.querySelector("#holofoteBlur");
      const sizeInput = body.querySelector("#holofoteSize");
      effectInput.value = holofoteSettings.effect;
      opacityInput.value = holofoteSettings.opacity;
      blurInput.value = holofoteSettings.blur;
      sizeInput.value = holofoteSettings.size;
      const applyFromInputs = () => {
        holofoteSettings = { effect: effectInput.value, opacity: Number(opacityInput.value), blur: Number(blurInput.value), size: Number(sizeInput.value) };
      };
      [effectInput, opacityInput, blurInput, sizeInput].forEach((input) => input.addEventListener("input", applyFromInputs));
      toggle.addEventListener("click", () => {
        if (state.holofoteActive) disableHolofoteMode();
        else enableHolofoteMode();
        toggle.textContent = translateQaSurfaceText(state.holofoteActive ? "Desativar" : "Ativar");
        toggle.classList.toggle("primary", !state.holofoteActive);
      });
    },
  });
}

// Pixel Perfect: crosshair/horizontal/vertical guide lines that follow the mouse (color and
// thickness configurable) with a click-to-anchor "smart ruler" that measures the distance from
// the anchor to the live cursor position, plus a dedicated element-inspector "bounds" mode --
// hover snaps a box to whatever real element sits under the cursor and shows its exact pixel
// size, and the scroll wheel walks that box up/down the DOM ancestor chain (bigger container per
// notch one way, back down toward the innermost element the other) -- modeled directly on
// PowerToys' Screen Ruler, referenced per the founder's request. Never preventDefault's real
// clicks in the line modes (same passive-layer philosophy as Holofote/Click Spy); bounds mode
// does swallow clicks while active, same as every other click-to-select tool here (Borrar
// elementos, Multiclick), since a click there means "pin this element", not "activate it".
let pixelPerfectSettings = { mode: "cross", color: null, thickness: 1 };
let pixelPerfectMeasureAnchor = null;
let pixelPerfectBoundsChain = [];
let pixelPerfectBoundsIndex = 0;
let pixelPerfectBoundsPinned = false;

function ensurePixelPerfectOverlay() {
  let overlay = document.getElementById("qts-pixelperfect-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "qts-pixelperfect-overlay";
  overlay.className = "qts-floating-item";
  overlay.innerHTML = `
    <div class="qts-pp-line-h"></div>
    <div class="qts-pp-line-v"></div>
    <div class="qts-pp-coords"></div>
    <div class="qts-pp-measure-line isHidden"></div>
    <div class="qts-pp-measure-label isHidden"></div>
    <div class="qts-pp-bounds-box isHidden"></div>
    <div class="qts-pp-bounds-label isHidden"></div>
    <div class="qts-pp-bounds-hint isHidden"></div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function applyPixelPerfectSettings(overlay) {
  overlay.style.setProperty("--qts-pp-color", effectivePixelPerfectColor());
  overlay.style.setProperty("--qts-pp-thickness", `${pixelPerfectSettings.thickness}px`);
  const isBounds = pixelPerfectSettings.mode === "bounds";
  // classList, not style.display: a plain inline style always loses to this file's
  // `all: revert !important` reset (see the .isHidden rule next to .qts-pp-line-h/-v in
  // toolbar.css), which silently kept both lines visible in every mode until now.
  overlay.querySelector(".qts-pp-line-h").classList.toggle("isHidden", isBounds || pixelPerfectSettings.mode === "vertical");
  overlay.querySelector(".qts-pp-line-v").classList.toggle("isHidden", isBounds || pixelPerfectSettings.mode === "horizontal");
  overlay.querySelector(".qts-pp-coords").style.display = isBounds ? "none" : "block";
  const hint = overlay.querySelector(".qts-pp-bounds-hint");
  if (isBounds) {
    hint.classList.remove("isHidden");
    hint.textContent = translateQaSurfaceText("Role o scroll para ir ao elemento pai/filho · Clique para fixar");
  } else {
    hint.classList.add("isHidden");
    overlay.querySelector(".qts-pp-bounds-box").classList.add("isHidden");
    overlay.querySelector(".qts-pp-bounds-label").classList.add("isHidden");
    pixelPerfectBoundsChain = [];
    pixelPerfectBoundsIndex = 0;
    pixelPerfectBoundsPinned = false;
  }
}

function effectivePixelPerfectColor() {
  if (pixelPerfectSettings.color) return pixelPerfectSettings.color;
  return THEME_PRESETS.find((item) => item.id === state.workspace?.preferences?.colorTheme)?.primary || "#2563eb";
}

function updatePixelPerfectCrosshair(x, y) {
  const overlay = ensurePixelPerfectOverlay();
  overlay.style.setProperty("--qts-pp-x", `${x}px`);
  overlay.style.setProperty("--qts-pp-y", `${y}px`);
  const coords = overlay.querySelector(".qts-pp-coords");
  coords.textContent = `X: ${Math.round(x)}px  Y: ${Math.round(y)}px`;
  const line = overlay.querySelector(".qts-pp-measure-line");
  const label = overlay.querySelector(".qts-pp-measure-label");
  if (pixelPerfectMeasureAnchor) {
    const dx = Math.round(x - pixelPerfectMeasureAnchor.x);
    const dy = Math.round(y - pixelPerfectMeasureAnchor.y);
    const length = Math.hypot(x - pixelPerfectMeasureAnchor.x, y - pixelPerfectMeasureAnchor.y);
    const angle = (Math.atan2(y - pixelPerfectMeasureAnchor.y, x - pixelPerfectMeasureAnchor.x) * 180) / Math.PI;
    line.classList.remove("isHidden");
    line.style.setProperty("--qts-pp-line-left", `${pixelPerfectMeasureAnchor.x}px`);
    line.style.setProperty("--qts-pp-line-top", `${pixelPerfectMeasureAnchor.y}px`);
    line.style.setProperty("--qts-pp-line-width", `${length}px`);
    line.style.setProperty("--qts-pp-line-angle", `${angle}deg`);
    label.classList.remove("isHidden");
    label.style.setProperty("--qts-pp-label-left", `${(x + pixelPerfectMeasureAnchor.x) / 2}px`);
    label.style.setProperty("--qts-pp-label-top", `${(y + pixelPerfectMeasureAnchor.y) / 2}px`);
    label.textContent = `${Math.abs(dx)}×${Math.abs(dy)}px · ${Math.round(length)}px`;
  } else {
    line.classList.add("isHidden");
    label.classList.add("isHidden");
  }
}

// Only real page content is a valid inspection target -- our own overlay is pointer-events:none
// so elementFromPoint already passes through it, but the toolbar's actual clickable chrome
// (button/menu/drawer) is not, and would otherwise get boxed as if it were page content.
function resolvePixelPerfectHoverElement(x, y) {
  const element = document.elementFromPoint(x, y);
  if (!element || element === document.documentElement || element === document.body) return null;
  if (isInsideToolbarUi(element)) return null;
  return element;
}

function buildPixelPerfectBoundsChain(element) {
  const chain = [];
  let node = element;
  while (node instanceof Element) {
    chain.push(node);
    if (node === document.documentElement) break;
    node = node.parentElement;
  }
  return chain;
}

function renderPixelPerfectBounds(overlay) {
  const box = overlay.querySelector(".qts-pp-bounds-box");
  const label = overlay.querySelector(".qts-pp-bounds-label");
  const element = pixelPerfectBoundsChain[pixelPerfectBoundsIndex];
  if (!element) {
    box.classList.add("isHidden");
    label.classList.add("isHidden");
    return;
  }
  const rect = element.getBoundingClientRect();
  box.classList.remove("isHidden");
  box.classList.toggle("isPinned", pixelPerfectBoundsPinned);
  box.style.setProperty("--qts-pp-bounds-left", `${rect.left}px`);
  box.style.setProperty("--qts-pp-bounds-top", `${rect.top}px`);
  box.style.setProperty("--qts-pp-bounds-width", `${rect.width}px`);
  box.style.setProperty("--qts-pp-bounds-height", `${rect.height}px`);
  label.classList.remove("isHidden");
  label.style.setProperty("--qts-pp-bounds-label-left", `${rect.left + rect.width / 2}px`);
  label.style.setProperty("--qts-pp-bounds-label-top", `${Math.max(rect.top - 8, 22)}px`);
  const identity = element.id ? `#${element.id}` : (typeof element.className === "string" && element.className.trim() ? `.${element.className.trim().split(/\s+/)[0]}` : "");
  label.textContent = `${element.tagName.toLowerCase()}${identity} · ${Math.round(rect.width)}×${Math.round(rect.height)}px`;
}

function updatePixelPerfectBounds(x, y) {
  const overlay = ensurePixelPerfectOverlay();
  if (!pixelPerfectBoundsPinned) {
    const hovered = resolvePixelPerfectHoverElement(x, y);
    if (!hovered) {
      pixelPerfectBoundsChain = [];
      pixelPerfectBoundsIndex = 0;
    } else if (pixelPerfectBoundsChain[0] !== hovered) {
      pixelPerfectBoundsChain = buildPixelPerfectBoundsChain(hovered);
      pixelPerfectBoundsIndex = 0;
    }
  }
  renderPixelPerfectBounds(overlay);
}

// Pins the inspector on a specific element right away (skips hover) -- used by the "Inspecionar
// com Pixel Perfect" right-click action so a single click on the target is enough to see its size.
function pinPixelPerfectBounds(element) {
  pixelPerfectSettings = { ...pixelPerfectSettings, mode: "bounds" };
  pixelPerfectBoundsChain = buildPixelPerfectBoundsChain(element);
  pixelPerfectBoundsIndex = 0;
  pixelPerfectBoundsPinned = true;
  const overlay = ensurePixelPerfectOverlay();
  applyPixelPerfectSettings(overlay);
  renderPixelPerfectBounds(overlay);
}

function enablePixelPerfectMode() {
  if (state.pixelPerfectActive) return;
  state.pixelPerfectActive = true;
  state.shadowRoot?.getElementById("pixelPerfectMenuItem")?.classList.add("isActive");
  pixelPerfectMeasureAnchor = null;
  const overlay = ensurePixelPerfectOverlay();
  applyPixelPerfectSettings(overlay);
  overlay.classList.add("isVisible");
  const moveHandler = (event) => {
    if (pixelPerfectSettings.mode === "bounds") updatePixelPerfectBounds(event.clientX, event.clientY);
    else updatePixelPerfectCrosshair(event.clientX, event.clientY);
  };
  const clickHandler = (event) => {
    if (isInsideToolbarUi(event.target)) return;
    if (pixelPerfectSettings.mode === "bounds") {
      if (!pixelPerfectBoundsChain.length) return;
      event.preventDefault();
      event.stopPropagation();
      pixelPerfectBoundsPinned = !pixelPerfectBoundsPinned;
      renderPixelPerfectBounds(ensurePixelPerfectOverlay());
      return;
    }
    pixelPerfectMeasureAnchor = pixelPerfectMeasureAnchor ? null : { x: event.clientX, y: event.clientY };
    updatePixelPerfectCrosshair(event.clientX, event.clientY);
  };
  // Bounds mode: each notch walks the highlighted box one level up (bigger, toward the root) or
  // down (smaller, back toward the innermost element under the cursor) the DOM ancestor chain --
  // this is the "scroll migrates between elements, walls within walls" behavior modeled on
  // PowerToys. Line modes: once an anchor is set, the wheel instead nudges it 1px per notch, a
  // fine-adjustment for lining an edge up exactly since chasing a single pixel with the mouse
  // alone is unreliable.
  const wheelHandler = (event) => {
    if (pixelPerfectSettings.mode === "bounds") {
      if (!pixelPerfectBoundsChain.length) return;
      event.preventDefault();
      pixelPerfectBoundsIndex = Math.min(Math.max(pixelPerfectBoundsIndex + (event.deltaY > 0 ? 1 : -1), 0), pixelPerfectBoundsChain.length - 1);
      renderPixelPerfectBounds(ensurePixelPerfectOverlay());
      return;
    }
    if (!pixelPerfectMeasureAnchor) return;
    event.preventDefault();
    pixelPerfectMeasureAnchor = { x: pixelPerfectMeasureAnchor.x, y: pixelPerfectMeasureAnchor.y + (event.deltaY > 0 ? 1 : -1) };
    updatePixelPerfectCrosshair(event.clientX, event.clientY);
  };
  const keyHandler = (event) => {
    if (event.key !== "Escape") return;
    if (pixelPerfectSettings.mode === "bounds") {
      if (!pixelPerfectBoundsPinned) return;
      pixelPerfectBoundsPinned = false;
      return;
    }
    if (!pixelPerfectMeasureAnchor) return;
    pixelPerfectMeasureAnchor = null;
    const rect = overlay.getBoundingClientRect();
    updatePixelPerfectCrosshair(rect.width / 2, rect.height / 2);
  };
  document.addEventListener("mousemove", moveHandler, true);
  document.addEventListener("click", clickHandler, true);
  document.addEventListener("wheel", wheelHandler, { passive: false, capture: true });
  document.addEventListener("keydown", keyHandler, true);
  state.pixelPerfectCleanup = () => {
    document.removeEventListener("mousemove", moveHandler, true);
    document.removeEventListener("click", clickHandler, true);
    document.removeEventListener("wheel", wheelHandler, true);
    document.removeEventListener("keydown", keyHandler, true);
    document.getElementById("qts-pixelperfect-overlay")?.remove();
    pixelPerfectMeasureAnchor = null;
    pixelPerfectBoundsChain = [];
    pixelPerfectBoundsIndex = 0;
    pixelPerfectBoundsPinned = false;
  };
}

function disablePixelPerfectMode() {
  state.pixelPerfectActive = false;
  state.shadowRoot?.getElementById("pixelPerfectMenuItem")?.classList.remove("isActive");
  state.pixelPerfectCleanup?.();
  state.pixelPerfectCleanup = null;
}

// Right-click "Inspecionar com Pixel Perfect": turns the tool on already pinned to whatever
// element was right-clicked, so the size shows up after a single click -- no need to open the
// drawer, switch to bounds mode and hover it manually first.
function inspectElementWithPixelPerfect(element) {
  if (!element) { showQaToast(translateQaSurfaceText("Nenhum elemento selecionado."), "error"); return; }
  if (!state.pixelPerfectActive) enablePixelPerfectMode();
  pinPixelPerfectBounds(element);
  showQaToast(translateQaSurfaceText("Pixel Perfect: role o scroll pra trocar de elemento, clique pra soltar."));
}

function openPixelPerfectTool() {
  openDrawer({
    title: "Pixel Perfect",
    view: "pixelPerfect",
    bodyHtml: `<p class="qts-tool-lead">Use guias precisas para alinhar a interface ou inspecione o tamanho real de qualquer elemento. Clique para medir e fixar; no modo elemento, use o scroll para navegar entre pai e filho.</p>
      <div class="qts-tool-state"><div class="qts-tool-state-copy"><b>Pixel Perfect</b><small id="pixelPerfectStatus">${state.pixelPerfectActive ? "Ativo na página" : "Pronto para usar"}</small></div><button class="action ${state.pixelPerfectActive ? "" : "primary"}" id="pixelPerfectToggle" type="button">${state.pixelPerfectActive ? "Desativar" : "Ativar"}</button></div>
      <fieldset class="qts-mode-fieldset"><legend>Modo de inspeção</legend><div class="qts-mode-grid" role="radiogroup" aria-label="Modo do Pixel Perfect">
        <button class="qts-mode-option" type="button" role="radio" data-pp-mode="cross"><span class="qts-mode-icon">+</span><span class="qts-mode-copy"><b>Cruz</b><small>Horizontal + vertical</small></span></button>
        <button class="qts-mode-option" type="button" role="radio" data-pp-mode="horizontal"><span class="qts-mode-icon">−</span><span class="qts-mode-copy"><b>Horizontal</b><small>Linha de largura total</small></span></button>
        <button class="qts-mode-option" type="button" role="radio" data-pp-mode="vertical"><span class="qts-mode-icon">|</span><span class="qts-mode-copy"><b>Vertical</b><small>Linha de altura total</small></span></button>
        <button class="qts-mode-option" type="button" role="radio" data-pp-mode="bounds"><span class="qts-mode-icon">${ICON("elementCapture")}</span><span class="qts-mode-copy"><b>Elemento</b><small>Tamanho em pixels</small></span></button>
      </div></fieldset>
      <select id="pixelPerfectMode" class="qts-visually-hidden" aria-hidden="true" tabindex="-1">
        <option value="cross">Linhas guia - cruz (horizontal + vertical)</option>
        <option value="horizontal">Linhas guia - somente horizontal</option>
        <option value="vertical">Linhas guia - somente vertical</option>
        <option value="bounds">Inspecionar elemento (tamanho em pixels)</option>
      </select>
      <label>Cor da guia
        <div class="qts-pp-color-row">
          <input type="color" id="pixelPerfectColor" />
          <span class="qts-pp-color-hex" id="pixelPerfectColorHex"></span>
          <button class="action" id="pixelPerfectThemeColor" type="button">Usar cor do tema</button>
        </div>
      </label>
      <label data-pp-thickness-row>Espessura da linha<input type="range" min="1" max="5" id="pixelPerfectThickness" /></label>`,
    onReady(body) {
      const toggle = body.querySelector("#pixelPerfectToggle");
      const modeInput = body.querySelector("#pixelPerfectMode");
      const colorInput = body.querySelector("#pixelPerfectColor");
      const colorHex = body.querySelector("#pixelPerfectColorHex");
      const themeColorButton = body.querySelector("#pixelPerfectThemeColor");
      const status = body.querySelector("#pixelPerfectStatus");
      const thicknessInput = body.querySelector("#pixelPerfectThickness");
      const thicknessRow = body.querySelector("[data-pp-thickness-row]");
      modeInput.value = pixelPerfectSettings.mode;
      colorInput.value = effectivePixelPerfectColor();
      colorHex.textContent = effectivePixelPerfectColor().toUpperCase();
      thicknessInput.value = pixelPerfectSettings.thickness;
      thicknessRow.style.display = pixelPerfectSettings.mode === "bounds" ? "none" : "grid";
      const syncModes = () => body.querySelectorAll("[data-pp-mode]").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.ppMode === modeInput.value)));
      const applyFromInputs = (event) => {
        pixelPerfectSettings = { mode: modeInput.value, color: event?.target === colorInput ? colorInput.value : pixelPerfectSettings.color, thickness: Number(thicknessInput.value) };
        colorHex.textContent = colorInput.value.toUpperCase();
        thicknessRow.style.display = pixelPerfectSettings.mode === "bounds" ? "none" : "grid";
        syncModes();
        const overlay = document.getElementById("qts-pixelperfect-overlay");
        if (overlay) applyPixelPerfectSettings(overlay);
      };
      [modeInput, colorInput, thicknessInput].forEach((input) => input.addEventListener("input", applyFromInputs));
      body.querySelectorAll("[data-pp-mode]").forEach((button) => button.addEventListener("click", () => {
        modeInput.value = button.dataset.ppMode;
        modeInput.dispatchEvent(new Event("input", { bubbles: true }));
      }));
      themeColorButton.addEventListener("click", () => {
        pixelPerfectSettings.color = null;
        colorInput.value = effectivePixelPerfectColor();
        colorHex.textContent = effectivePixelPerfectColor().toUpperCase();
        const overlay = document.getElementById("qts-pixelperfect-overlay");
        if (overlay) applyPixelPerfectSettings(overlay);
      });
      syncModes();
      toggle.addEventListener("click", () => {
        if (state.pixelPerfectActive) disablePixelPerfectMode();
        else enablePixelPerfectMode();
        toggle.textContent = translateQaSurfaceText(state.pixelPerfectActive ? "Desativar" : "Ativar");
        toggle.classList.toggle("primary", !state.pixelPerfectActive);
        status.textContent = state.pixelPerfectActive ? "Ativo na página" : "Pronto para usar";
      });
    },
  });
}

function openElementCapture() {
  if (!requirePlanFeature("elementCapture")) return;
  let rows = captureVisibleElements();
  let query = "";
  // Persisted on `state` (not a local var) so reopening the drawer while "Ver elementos" is still
  // running on the page reflects the real filter selection instead of resetting to the defaults.
  if (!state.elementViewFields) state.elementViewFields = new Set(["id", "testId"]);
  const viewFields = state.elementViewFields;
  openDrawer({
    title: "Capturar elementos",
    view: "elementCapture",
    bodyHtml: `<p class="qts-tool-lead">Captura todos os elementos interativos da página atual (links, botões, inputs, selects) com seletor CSS e XPath prontos para automação. Nenhum valor digitado é exportado.</p>
      <div class="qts-card-actions"><button class="action" id="elementCaptureRescan" type="button">Recapturar</button><button class="action" id="elementViewToggle" type="button">Ver elementos</button><button class="action primary" id="elementCaptureExport" type="button">Exportar CSV</button></div>
      <div class="qts-toolbar-row" id="elementViewFilters" hidden>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px"><input type="checkbox" data-view-field="id" checked /> #id</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px"><input type="checkbox" data-view-field="testId" checked /> data-test-id</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px"><input type="checkbox" data-view-field="role" /> role</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px"><input type="checkbox" data-view-field="xpath" /> XPath</label>
      </div>
      <div class="qts-toolbar-row"><input type="search" id="elementCaptureSearch" class="qts-toolbar-search" placeholder="Buscar por texto, tag, test-id, CSS ou XPath..." /></div>
      <div class="qts-status" id="elementCaptureStatus"></div>
      <div style="display:grid;gap:8px;max-height:360px;overflow:auto" id="elementCapturePreview"></div>`,
    onReady(body) {
      const status = body.querySelector("#elementCaptureStatus");
      const preview = body.querySelector("#elementCapturePreview");
      const exportButton = body.querySelector("#elementCaptureExport");
      const searchInput = body.querySelector("#elementCaptureSearch");
      const viewToggle = body.querySelector("#elementViewToggle");
      const viewFilters = body.querySelector("#elementViewFilters");
      const refreshElementView = () => { if (state.elementViewCleanup) enableElementView(rows, viewFields); };
      // Reflects whether "Ver elementos" is already running (e.g. left on from before the drawer
      // was closed and reopened) instead of assuming it's off.
      const alreadyActive = Boolean(state.elementViewCleanup);
      viewToggle.classList.toggle("primary", alreadyActive);
      viewFilters.hidden = !alreadyActive;
      viewFilters.querySelectorAll("[data-view-field]").forEach((checkbox) => { checkbox.checked = viewFields.has(checkbox.dataset.viewField); });
      if (alreadyActive) refreshElementView();
      viewToggle.addEventListener("click", () => {
        if (state.elementViewCleanup) { disableElementView(); viewToggle.classList.remove("primary"); viewFilters.hidden = true; return; }
        enableElementView(rows, viewFields);
        viewToggle.classList.add("primary");
        viewFilters.hidden = false;
      });
      viewFilters.querySelectorAll("[data-view-field]").forEach((checkbox) => checkbox.addEventListener("change", () => {
        if (checkbox.checked) viewFields.add(checkbox.dataset.viewField);
        else viewFields.delete(checkbox.dataset.viewField);
        refreshElementView();
      }));
      const matchesQuery = (row) => {
        if (!query) return true;
        const haystack = `${row.tag} ${row.type} ${row.name} ${row.id} ${row.testId} ${row.role} ${row.cssSelector} ${row.xpath} ${row.text} ${row.placeholder}`.toLowerCase();
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
                    <div style="min-width:0"><b>${escapeHtml(row.tag)}${row.type ? `[${escapeHtml(row.type)}]` : ""}</b> ${labelHtml}${row.sensitive ? ` <span style="color:#ff6767">sensível</span>` : ""}${row.testId ? ` <span style="color:#42d5c2">test-id</span>` : ""}${row.role ? ` <span style="color:#42d5c2">role: ${escapeHtml(row.role)}</span>` : ""}</div>
                    <div style="display:flex;gap:4px;flex:0 0 auto">
                      <button type="button" class="qts-icon-btn" data-locate-row title="Localizar elemento" style="width:26px;height:26px">${ICON("cursor")}</button>
                      <button type="button" class="qts-icon-btn" data-state-row title="Ver estado atual" style="width:26px;height:26px">${ICON("eye")}</button>
                    </div>
                  </div>
                  <small>${escapeHtml(row.cssSelector)}</small>
                  <div data-state-body hidden style="margin-top:4px"></div>
                </div>
              `;
            }).join("") + (filtered.length > capped.length ? `<p class="qts-tool-lead">Mostrando 80 de ${filtered.length} - refine a busca para ver outros.</p>` : "")
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
      body.querySelector("#elementCaptureRescan").addEventListener("click", () => { rows = captureVisibleElements(); renderPreview(); refreshElementView(); });
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
// by a 200ms poll rather than scroll/resize listeners - matches this file's existing polling
// pattern (state.locationInterval) and means a badge cleans itself up for free whenever its
// target disappears (SPA re-render) or clearAllFloatingItems() sweeps every `.qts-floating-item`,
// without needing to hook into that sweep separately.
const characterCounterOverlays = new Map();

function attachCharacterCounterBadge(element) {
  const existingCleanup = characterCounterOverlays.get(element);
  if (existingCleanup) { existingCleanup(); characterCounterOverlays.delete(element); return; }
  const badge = document.createElement("div");
  badge.className = "qts-floating-item qts-char-counter-badge";
  badge.innerHTML = `<span data-count>0</span> car.<button type="button" class="qts-remove-btn" data-close aria-label="Remover">${ICON("fail")}</button>`;
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
  // Persists until the user clicks "Remover" - the toast shown when this badge is attached
  // promises exactly that ("Clique no botão Remover do indicador para excluí-lo"), so it must
  // not auto-fade or auto-remove itself on a timer.
  const cleanup = () => { badge.remove(); window.clearInterval(timer); };
  badge.querySelector("[data-close]").addEventListener("click", () => { cleanup(); characterCounterOverlays.delete(element); });
  characterCounterOverlays.set(element, cleanup);
  reposition();
}

function flattenLanguageValues(value, path = "", output = []) {
  if (typeof value === "string") output.push({ key: path || "(raiz)", value });
  else if (Array.isArray(value)) value.forEach((item, index) => flattenLanguageValues(item, `${path}[${index}]`, output));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => flattenLanguageValues(item, path ? `${path}.${key}` : key, output));
  return output;
}

function openQrCodeTool() {
  const current = new URL(window.location.href);
  const hasSensitiveParts = current.search || current.hash;
  if (hasSensitiveParts) { current.search = ""; current.hash = ""; }
  const savedUrls = (state.workspace.urlBindings || []).flatMap((binding) => {
    const candidates = [binding.primaryUrl, ...(binding.patterns || []).filter((pattern) => !pattern.includes("*"))];
    return candidates.map((url) => ({ url, label: binding.label || url })).filter((item) => /^https?:\/\//i.test(item.url || ""));
  });
  openDrawer({
    title: "QR Code",
    view: "qrCode",
    variant: "modal",
    bodyHtml: `<p class="qts-tool-lead">Gere o QR localmente para a URL atual ou uma URL concreta salva. Nenhum dado é enviado para serviços externos.</p>
      ${hasSensitiveParts ? `<div class="qts-card"><b>Query/hash removidos por segurança</b><p class="qts-tool-lead">A URL atual contém parâmetros. Ative a opção abaixo somente se tiver certeza de que não há token ou segredo.</p><label class="qts-switch-row"><input id="qrKeepSensitive" type="checkbox" /><span><b>Incluir query e hash</b></span></label></div>` : ""}
      <label class="qts-field-label">URL<select id="qrUrl"><option value="${escapeHtml(current.href)}">Aba atual - ${escapeHtml(current.href)}</option>${savedUrls.map((item) => `<option value="${escapeHtml(item.url)}">${escapeHtml(item.label)}</option>`).join("")}</select></label>
      <div class="qts-card" style="display:grid;place-items:center"><canvas id="qrCanvas" width="280" height="280" aria-label="QR Code gerado"></canvas></div>
      <div class="qts-card-actions"><button class="action primary" id="qrDownload" type="button">Baixar PNG</button><button class="action" id="qrCopy" type="button">Copiar imagem</button></div><div class="qts-status" id="qrStatus"></div>`,
    onReady(body) {
      const select = body.querySelector("#qrUrl");
      const canvas = body.querySelector("#qrCanvas");
      const status = body.querySelector("#qrStatus");
      const selectedUrl = () => {
        if (select.selectedIndex === 0 && body.querySelector("#qrKeepSensitive")?.checked) return window.location.href;
        return select.value;
      };
      const renderQr = async () => {
        try {
          const url = new URL(selectedUrl());
          if (!["http:", "https:"].includes(url.protocol)) throw new Error("Protocolo não permitido");
          await window.QTS_QRCODE.toCanvas(canvas, url.href);
          status.textContent = url.href;
        } catch (error) { status.textContent = translateQaSurfaceText(`Não foi possível gerar: ${error.message}`); }
      };
      select.addEventListener("change", renderQr);
      body.querySelector("#qrKeepSensitive")?.addEventListener("change", renderQr);
      body.querySelector("#qrDownload").addEventListener("click", () => {
        const anchor = document.createElement("a"); anchor.href = canvas.toDataURL("image/png"); anchor.download = "qa-toolbar-qrcode.png"; anchor.click();
      });
      body.querySelector("#qrCopy").addEventListener("click", async () => {
        try {
          const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, "image/png"));
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          status.textContent = translateQaSurfaceText("Imagem copiada.");
        } catch { status.textContent = translateQaSurfaceText("O navegador não permitiu copiar a imagem; use Baixar PNG."); }
      });
      void renderQr();
    },
  });
}

function visiblePageText() {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll(`#${HOST_ID},script,style,noscript,template,[hidden],[aria-hidden="true"]`).forEach((node) => node.remove());
  return (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
}

function openLanguageValidator() {
  openDrawer({
    title: "Validador de textos",
    view: "languageValidator",
    bodyHtml: `<p class="qts-tool-lead">Importe um JSON de idioma. Cada texto esperado é comparado com o conteúdo visível da página atual; o arquivo nunca é executado nem enviado.</p>
      <label class="qts-field-label">Arquivo JSON<input id="languageFile" type="file" accept="application/json,.json" /></label>
      <div class="qts-card-actions"><button class="action primary" id="languageValidate" type="button" disabled>Validar página</button><button class="action" id="languageRevalidate" type="button" disabled>Revalidar após navegação</button></div>
      <div class="qts-status" id="languageStatus"></div><div class="qts-list" id="languageResults"></div>`,
    onReady(body) {
      let expected = [];
      const render = () => {
        const pageText = visiblePageText();
        const results = expected.map((entry) => ({ ...entry, found: pageText.includes(entry.value.replace(/\s+/g, " ").trim()) }));
        const found = results.filter((entry) => entry.found).length;
        body.querySelector("#languageStatus").textContent = translateQaSurfaceText(`${found}/${results.length} textos encontrados na página atual.`);
        body.querySelector("#languageResults").innerHTML = results.map((entry) => `<div class="qts-list-row"><span><b>${entry.found ? "✓" : "⚠"} ${escapeHtml(entry.key)}</b><small>${escapeHtml(entry.value)}</small></span><span class="qts-chip">${escapeHtml(translateQaSurfaceText(entry.found ? "Igual" : "Ausente/diferente"))}</span></div>`).join("") || `<div class="qts-empty">${escapeHtml(translateQaSurfaceText("Importe um arquivo JSON válido."))}</div>`;
      };
      body.querySelector("#languageFile").addEventListener("change", async (event) => {
        const file = event.currentTarget.files?.[0];
        if (!file) return;
        if (file.size > 2_000_000) { body.querySelector("#languageStatus").textContent = translateQaSurfaceText("O arquivo deve ter no máximo 2 MB."); return; }
        try {
          const parsed = JSON.parse(await file.text());
          expected = flattenLanguageValues(parsed).filter((entry) => entry.value.trim()).slice(0, 5_000);
          if (!expected.length) throw new Error("Nenhum texto encontrado");
          body.querySelector("#languageValidate").disabled = false;
          body.querySelector("#languageRevalidate").disabled = false;
          body.querySelector("#languageStatus").textContent = translateQaSurfaceText(`${expected.length} textos carregados.`);
          render();
        } catch (error) {
          expected = [];
          body.querySelector("#languageStatus").textContent = translateQaSurfaceText(`JSON inválido: ${error.message}`);
        }
      });
      body.querySelector("#languageValidate").addEventListener("click", render);
      body.querySelector("#languageRevalidate").addEventListener("click", render);
    },
  });
}

function openCharacterCounter(initialText = null) {
  if (!requirePlanFeature("characterCounter")) return;
  const selected = initialText ?? String(document.getSelection()?.toString() || "");
  openDrawer({
    title: "Contador de caracteres",
    view: "characterCounter",
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
          showQaToast("Contador anexado ao campo. Clique no botão Remover do indicador para excluí-lo.");
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
// `accepts` even runs - e.g. Input Lab wants clicking anywhere on a floating-label wrapper (a
// common real-world pattern where the visible "input box" is a padded container around a
// smaller <input>) to still resolve to the real <input>, not reject it outright. Defaults to
// identity so callers that already accept the raw target (Multiclick, Faker Fill's own
// `.closest("form")` check) are unaffected.
function selectPageElement({ accepts = () => true, resolve = (target) => target, onSelected, onCleanup, instruction }) {
  closeDrawer();
  cancelElementSelection();
  const style = document.createElement("style");
  style.id = "qts-element-selector-style";
  style.textContent = "html.qts-selecting,html.qts-selecting *{cursor:crosshair!important}.qts-selection-candidate{outline:3px solid var(--qts-ui-primary, #ffd700)!important;outline-offset:2px!important}";
  document.documentElement.appendChild(style);
  document.documentElement.classList.add("qts-selecting");
  // Reinforces that Esc cancels - the first toast (below) gets buried once a few "not
  // compatible" rejection toasts stack up, which previously left the only cancel hint invisible.
  const hint = document.createElement("div");
  hint.className = "qts-floating-item";
  hint.style.cssText = "position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2147483647;background:#0b0b0b;color:var(--qts-ui-primary, #ffd700);border:1px solid var(--qts-ui-primary, #ffd700);border-radius:999px;padding:6px 14px;font:700 11px sans-serif;pointer-events:none";
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
    onCleanup?.();
  };
  const onOver = (event) => {
    if (event.target.closest?.(`#${HOST_ID}`)) return;
    candidate?.classList.remove("qts-selection-candidate");
    // Falls back to the raw hover target so *something* highlights under the cursor generally -
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
// (floating-label patterns, custom-select containers) searches its descendants first - the
// common real case, since the visible "box" is usually the wrapper, not the input - falling back
// to ancestors for the rarer case of clicking a decorative child nested inside the input's own
// wrapper alongside it.
function resolveFormControlTarget(target) {
  if (!(target instanceof Element)) return null;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return target;
  return target.querySelector?.("input,textarea,select") || target.closest?.("input,textarea,select") || null;
}

// Short human-readable confirmation of what a page-picked element actually is, shown in a toast
// right after picking - the closest thing to a "visible label" without persisting a new field on
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
    view: "multiClick",
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
  const infoHtml = info ? `<div class="qts-card"><b>${escapeHtml(info.selector)}</b><div class="qts-tool-grid">${[["Tipo", info.type], ["Obrigatório", info.required ? "Sim" : "Não"], ["Mínimo", info.min ?? info.minLength ?? "-"], ["Máximo", info.max ?? info.maxLength ?? "-"], ["Pattern", info.pattern || "-"]].map(([label, value]) => `<div><small>${label}</small><br><b>${escapeHtml(value)}</b></div>`).join("")}</div></div>` : "";
  openDrawer({
    title: "Input Lab",
    view: "inputLab",
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
    view: "fakerFill",
    bodyHtml: `<p class="qts-tool-lead">Preencha formulários com dados sintéticos locais em um clique. Senhas, cartões, CVV, tokens e campos ocultos são sempre ignorados.</p>
      <div class="qts-card"><b>Escopo</b><p>${selectedRoot ? "Formulário selecionado" : "Página atual"}</p></div>
      <div class="qts-card-actions"><button class="action" id="fakerSelectForm" type="button">Selecionar formulário</button><button class="action primary" id="fakerRun" type="button">Preencher agora</button></div><div class="qts-status" id="fakerStatus"></div><div id="fakerReport"></div>`,
    onReady(body) {
      body.querySelector("#fakerSelectForm").addEventListener("click", () => selectPageElement({ accepts: (element) => Boolean(element.closest("form")), onSelected: (element) => openFakerFill(element.closest("form")), instruction: "Clique dentro do formulário que deseja preencher." }));
      body.querySelector("#fakerRun").addEventListener("click", () => {
        const result = window.QTS_QA_TOOLS.fillWithFakeData(selectedRoot || document);
        body.querySelector("#fakerStatus").textContent = `${result.filled} campo(s) preenchido(s); ${result.protectedCount} sensível(is) protegido(s).`;
        body.querySelector("#fakerReport").innerHTML = result.fields?.length ? `<div class="qts-card" style="margin-top:12px"><b>Campos preenchidos</b><div class="qts-faker-report">${result.fields.map((field) => `<div class="qts-faker-report-row"><span><b>${escapeHtml(field.label)}</b><small>${escapeHtml(field.type)}</small></span><code>${escapeHtml(field.value)}</code></div>`).join("")}</div></div>` : `<div class="qts-mini-empty">Nenhum campo compatível e visível foi encontrado.</div>`;
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
    ["ID", element.id || "-"],
    ["Test ID", testId || "-"],
    ["Name", element.getAttribute("name") || "-"],
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
    <div class="qts-locator-head"><span>Locators</span><button type="button" class="qts-remove-btn" data-close title="${escapeHtml(state.t.remove)}">${ICON("fail")}</button></div>
    <div class="qts-locator-body">
      ${sensitive ? `<p class="qts-locator-warning">${ICON("warning")} Campo sensível - valor não exibido.</p>` : ""}
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
      showQaToast("Contador anexado ao campo. Clique no botão Remover do indicador para excluí-lo.");
      return;
    }
    if (!requirePlanFeature("characterCounter")) return;
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
      showQaToast(result.filled ? "Campo preenchido com dado fake." : "Campo sensível, somente leitura ou desabilitado - não preenchido.", result.filled ? "info" : "error");
      return;
    }
    const scope = target?.closest?.("form") || document;
    const result = window.QTS_QA_TOOLS.fillWithFakeData(scope);
    showQaToast(`${result.filled} campo(s) preenchido(s); ${result.protectedCount} sensível(is) protegido(s).`);
    return;
  }
  if (action === "check-limits") {
    if (!requirePlanFeature("inputLab")) return;
    openInputLab(resolveFormControlTarget(target));
  }
  if (action === "multi-click") {
    if (!target) { showQaToast("Nenhum elemento selecionado.", "error"); return; }
    if (!requirePlanFeature("multiClick")) return;
    openMultiClick(target);
  }
  if (action === "toggle-blur") {
    if (!target) { showQaToast("Nenhum elemento selecionado.", "error"); return; }
    toggleElementBlur(target);
    showQaToast(target.classList.contains("qts-blurred-element") ? "Elemento borrado." : "Borrão removido do elemento.");
  }
  if (action === "pixel-perfect-inspect") {
    inspectElementWithPixelPerfect(target);
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
  persistMacroRecordingRun();
}

// Snapshot of the in-progress macro recording, so a page reload mid-capture has something to
// resume from - mirrors playMacro/continueMacroRun's own chrome.storage.session persistence for
// *replay*, which this recording phase never had. Written synchronously (not debounced) on every
// call: a reload can happen at any moment, including right after the very first captured step, and
// a debounce timer doesn't survive the reload it's racing against - each individual action here is
// already coalesced upstream (e.g. onInput's own 350ms debounce before it ever calls append), so
// this isn't actually a write-per-keystroke.
function persistMacroRecordingRun() {
  const recording = state.macroRecording;
  if (!recording) return;
  void recordingRunRequest("macro", "set", { steps: recording.steps, lastAt: recording.lastAt, paused: recording.paused, expiresAt: Date.now() + 60 * 60_000 });
}

// One-line human description for the recording history panel - mirrors the same action set
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
    ? steps.map((step, index) => `<div class="qts-macro-hist-row"><span>${index + 1}. ${escapeHtml(macroStepLabel(step))}</span><button type="button" data-remove-history-step="${index}" title="Remover esta ação">${ICON("fail")}</button></div>`).join("")
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
  persistMacroRecordingRun();
  showQaToast(recording.paused ? "Gravação pausada." : "Gravação retomada.");
}

function undoLastMacroStep() {
  const recording = state.macroRecording;
  if (!recording?.steps.length) return;
  recording.steps.pop();
  updateMacroRecordingUi();
  persistMacroRecordingRun();
}

function cancelMacroRecording() {
  const recording = state.macroRecording;
  if (!recording) return;
  recording.cleanup();
  state.macroRecording = null;
  updateMacroRecordingUi();
  void recordingRunRequest("macro", "clear");
  showQaToast("Gravação cancelada.");
}

function toggleMacroHistoryPanel() {
  const panel = state.shadowRoot?.getElementById("macroRecHistoryPanel");
  if (!panel) return;
  const willShow = panel.classList.contains("isHidden");
  panel.classList.toggle("isHidden", !willShow);
  if (willShow) renderMacroHistoryPanel();
}

function startMacroRecording(resumeData = null) {
  if (state.macroRecording) return;
  if (!resumeData) closeDrawer();
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
  const cleanup = () => { document.removeEventListener("click", click, true); document.removeEventListener("change", change, true); document.removeEventListener("keydown", keydown, true); };
  state.macroRecording = resumeData
    ? { steps: resumeData.steps || [], lastAt: Date.now(), paused: resumeData.paused === true, cleanup }
    : { steps: [], lastAt: Date.now(), paused: false, cleanup };
  updateMacroRecordingUi();
  showQaToast(resumeData ? "Gravação de macro retomada após o recarregamento da página." : "Gravação iniciada. Senhas e dados sensíveis não serão capturados.");
  if (!resumeData) persistMacroRecordingRun();
}

function stopMacroRecording() {
  const recording = state.macroRecording;
  if (!recording) return;
  recording.cleanup();
  state.macroRecording = null;
  updateMacroRecordingUi();
  void recordingRunRequest("macro", "clear");
  openMacroEditor({ id: crypto.randomUUID(), name: `Macro ${new Date().toLocaleTimeString().slice(0, 5)}`, description: "", steps: recording.steps.filter((step, index, all) => !(step.action === "wait" && index === all.length - 1)) });
}

function macroRunRequest(operation, run) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type: "qts:macro-run", operation, run }, (response) => resolve(chrome.runtime.lastError ? { ok: false } : response || { ok: false })));
}

// Same tab-scoped chrome.storage.session pattern as macroRunRequest (macro *replay*), but for the
// two *recording* phases (Gravador de Passos / Macro Studio) - see qts:recording-run in
// background.js. `kind` is "steps" or "macro".
function recordingRunRequest(kind, operation, run) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type: "qts:recording-run", kind, operation, run }, (response) => resolve(chrome.runtime.lastError ? { ok: false } : response || { ok: false })));
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

function visibleMacroElementOptions() {
  const candidates = [...document.querySelectorAll("a[href],button,input,select,textarea,[role=button],[role=link],[tabindex]")]
    .filter((element) => !element.closest("#qts-toolbar-host") && !element.disabled && element.getClientRects().length)
    .slice(0, 250);
  const seen = new Set();
  return candidates.flatMap((element) => {
    const selector = window.QTS_QA_TOOLS.uniqueSelector(element);
    if (!selector || seen.has(selector)) return [];
    seen.add(selector);
    const label = element.getAttribute("aria-label")
      || element.getAttribute("placeholder")
      || element.getAttribute("title")
      || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80)
      || element.getAttribute("name")
      || element.id
      || element.tagName.toLowerCase();
    return [{ selector, label }];
  });
}

function macroStepFields(step) {
  if (step.action === "wait") return `<input data-field="ms" type="number" min="0" max="30000" value="${Number(step.ms) || 500}" aria-label="Espera em milissegundos" />`;
  if (step.action === "scroll") return `<input data-field="y" type="number" value="${Number(step.y) || 0}" aria-label="Posição vertical" />`;
  if (step.action === "fakerFill") return `<select data-field="scope"><option value="page" ${step.scope !== "form" ? "selected" : ""}>Página</option><option value="form" ${step.scope === "form" ? "selected" : ""}>Primeiro formulário</option></select>`;
  const selector = `<span style="display:flex;gap:5px;align-items:center"><input data-field="selector" list="macroVisibleElements" value="${escapeHtml(step.selector || "")}" placeholder="Buscar ou escolher elemento visível" aria-label="Elemento visível ou seletor CSS" style="flex:1;min-width:0" /><button type="button" class="qts-icon-btn" data-pick-selector style="width:28px;height:28px" title="Selecionar elemento na página">${ICON("cursor")}</button></span>`;
  if (step.action === "check") return `${selector}<select data-field="checked"><option value="true" ${step.checked !== false ? "selected" : ""}>Marcar</option><option value="false" ${step.checked === false ? "selected" : ""}>Desmarcar</option></select>`;
  if (step.action === "multiClick") return `${selector}<span style="display:flex;gap:5px"><input data-field="count" type="number" min="2" max="100" value="${Number(step.count) || 2}" aria-label="Quantidade" /><input data-field="interval" type="number" min="0" max="5000" value="${Number(step.interval) || 100}" aria-label="Intervalo" /></span>`;
  if (["fill", "select", "press"].includes(step.action)) return `${selector}<input data-field="value" value="${escapeHtml(step.value || "")}" placeholder="Valor" aria-label="Valor" />`;
  return selector;
}

function renderMacroFlow(container, steps, refreshCode) {
  const actions = [["click", "Clique"], ["fill", "Escrever"], ["select", "Selecionar"], ["check", "Checkbox"], ["press", "Tecla"], ["wait", "Esperar"], ["scroll", "Scroll"], ["multiClick", "Multiclick"], ["fakerFill", "Faker Fill"]];
  container.innerHTML = steps.length ? steps.map((step, index) => `<div class="qts-step" draggable="true" data-step-index="${index}"><span class="qts-step-index">${index + 1}</span><select data-field="action">${actions.map(([value, label]) => `<option value="${value}" ${step.action === value ? "selected" : ""}>${label}</option>`).join("")}</select><div data-step-fields>${macroStepFields(step)}</div><button class="qts-icon-btn" type="button" data-remove-step title="Remover">${ICON("fail")}</button></div>`).join("") : `<div class="qts-empty">Arraste uma função para cá ou clique em uma opção da paleta.</div>`;
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
  const visibleElements = visibleMacroElementOptions();
  const palette = [["click", `${ICON("cursor")} Clique`], ["fill", `${ICON("keyView")} Escrever`], ["select", `${ICON("chevronDown")} Selecionar`], ["check", `${ICON("checkSquare")} Checkbox`], ["press", `${ICON("key")} Tecla`], ["wait", `${ICON("wait")} Esperar`], ["scroll", `${ICON("scroll")} Scroll`], ["multiClick", `${ICON("multiClick")} Multiclick`], ["fakerFill", `${ICON("fakerFill")} Faker Fill`]];
  openDrawer({
    title: "Macro Studio",
    variant: "modal",
    view: "macroStudio",
    bodyHtml: `<datalist id="macroVisibleElements">${visibleElements.map(({ selector, label }) => `<option value="${escapeHtml(selector)}">${escapeHtml(label)}</option>`).join("")}</datalist>
      <div class="qts-toolbar-row"><button class="action" id="macroBack" type="button">${ICON("arrowLeft")} Macros</button><input id="macroName" value="${escapeHtml(macro.name)}" placeholder="Nome da macro" /><button class="action primary" id="macroSave" type="button">Salvar macro</button></div>
      <textarea id="macroDescription" rows="2" placeholder="Descrição opcional">${escapeHtml(macro.description || "")}</textarea>
      <div class="qts-tabs"><button type="button" class="isSelected" data-macro-mode="vibe">Vibe Code</button><button type="button" data-macro-mode="coder">Coder</button></div>
      <section id="vibeMode"><p class="qts-tool-lead">Monte o fluxo arrastando blocos. Em cada seletor, escolha um dos ${visibleElements.length} elementos interativos visíveis ou use o botão de seleção na página.</p><div class="qts-macro-layout"><aside class="qts-palette">${palette.map(([action, label]) => `<button type="button" draggable="true" data-palette-action="${action}">${label}</button>`).join("")}</aside><div class="qts-flow" id="macroFlow"></div></div></section>
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
    view: "macroStudio",
    bodyHtml: `<p class="qts-tool-lead">Grave ações ou monte um fluxo visual. Tudo fica local e só ações declarativas validadas são executadas.</p>
      <div class="qts-toolbar-row"><button class="action primary" id="startMacroRecording" type="button">${ICON("recordStart")} Gravar macro</button><button class="action" id="newMacro" type="button">+ Nova no Vibe Code</button><button class="action" id="importMacros" type="button">Importar</button><button class="action" id="exportAllMacros" type="button" ${macros.length ? "" : "disabled"}>Exportar todas</button><input id="macroFile" type="file" accept="application/json,.json" hidden /></div>
      <div id="macroList">${macros.length ? macros.map((macro) => `<article class="qts-card" data-macro-id="${escapeHtml(macro.id)}"><div class="qts-card-head"><div><b>${escapeHtml(macro.name)}</b><br><small>${macro.steps.length} etapa(s)${macro.description ? ` · ${escapeHtml(macro.description)}` : ""}</small></div><span>${pinned.has(macro.id) ? ICON("pin") : ""}</span></div><div class="qts-card-actions"><button class="action primary" data-macro-action="play" type="button">${ICON("play")} Executar</button><button class="action" data-macro-action="edit" type="button">Editar</button><button class="action" data-macro-action="pin" type="button">${pinned.has(macro.id) ? "Desafixar" : "Fixar no menu"}</button><button class="action" data-macro-action="export" type="button">Exportar</button><button class="action" data-macro-action="delete" type="button">Excluir</button></div></article>`).join("") : `<div class="qts-empty">Nenhuma macro salva. Grave suas ações ou comece no Vibe Code.</div>`}</div><div class="qts-status" id="macroStatus"></div>`,
    onReady(body) {
      body.querySelector("#startMacroRecording").addEventListener("click", () => startMacroRecording());
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
// falling back to WebM otherwise (documented limitation, not a silent one -
// the download filename extension always matches what was actually
// recorded). GIF capture uses a local bounded encoder and 15-second standalone segments.
// ---------------------------------------------------------------------------

const RECORD_PART_DURATION_MS = 30_000;
const GIF_PART_DURATION_MS = 15_000;
const GIF_FPS = 5;
const GIF_MAX_WIDTH = 1280;
const GIF_MAX_HEIGHT = 720;

const recordingState = {
  status: "idle", // idle | recording | paused
  mode: "video", // video | parts | gif
  stream: null,
  recorder: null,
  chunks: [],
  parts: [], // finished segment Blobs, only used when mode === "parts"
  mimeType: "",
  elapsedMs: 0,
  segmentStartedAt: 0,
  timerId: null,
  partTimerId: null,
  gifVideo: null,
  gifCanvas: null,
  gifEncoder: null,
  gifCaptureId: null,
  gifSegmentStartedAt: 0,
  gifLastFrameAt: 0,
  gifPausedAt: 0,
};

function pickRecordingMimeType() {
  const candidates = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) || "";
}

const STEPS_COPY = {
  "pt-BR": { title: "Gravador de Passos", intro: "Cada clique, campo preenchido e mensagem de retorno vira um passo - simples de ler, fácil de repetir.", record: "Gravar passos", manual: "Criar manualmente", numbered: "Passos numerados", gherkin: "Gherkin", start: "Estou na tela", click: "Clicar em", contextmenu: "Clicar com o botão direito em", input: "Preencher o campo", select: "no menu suspenso", check: "Marcar a caixa", uncheck: "Desmarcar a caixa", submit: "Enviar o formulário", key: "Pressionar", navigation: "Navegar para", protected: "Preencher campo protegido", expected: "O que apareceu na tela", add: "Adicionar etapa", save: "Salvar roteiro", export: "Exportar CSV", empty: "Nenhum roteiro salvo.", name: "Nome do roteiro", steps: "passos", saved: "Roteiro salvo.", paused: "Gravação de passos pausada.", resumed: "Gravação de passos retomada.", recording: "Gravação de passos iniciada.", resumedAfterReload: "Gravação de passos retomada após o recarregamento da página.", discard: "Descartar esta gravação de passos?", delete: "Excluir este roteiro?", edit: "Editar", remove: "Excluir", duplicate: "Duplicar", back: "Roteiros", csvSteps: "steps", csvExpected: "resultado esperado", withWord: "com", selectWord: "Selecionar", onWord: "em", occurs: "acontece" },
  "es": { title: "Grabador de pasos", intro: "Cada clic, campo completado y mensaje de retorno se vuelve un paso - simple de leer, fácil de repetir.", record: "Grabar pasos", manual: "Crear manualmente", numbered: "Pasos numerados", gherkin: "Gherkin", start: "Estoy en la pantalla", click: "Hacer clic en", contextmenu: "Hacer clic con el botón derecho en", input: "Completar el campo", select: "en el menú desplegable", check: "Marcar la casilla", uncheck: "Desmarcar la casilla", submit: "Enviar el formulario", key: "Presionar", navigation: "Navegar a", protected: "Completar campo protegido", expected: "Qué apareció en la pantalla", add: "Agregar paso", save: "Guardar guion", export: "Exportar CSV", empty: "No hay guiones guardados.", name: "Nombre del guion", steps: "pasos", saved: "Guion guardado.", paused: "Grabación de pasos pausada.", resumed: "Grabación de pasos reanudada.", recording: "Grabación de pasos iniciada.", resumedAfterReload: "Grabación de pasos reanudada después de recargar la página.", discard: "¿Descartar esta grabación de pasos?", delete: "¿Eliminar este guion?", edit: "Editar", remove: "Eliminar", duplicate: "Duplicar", back: "Guiones", csvSteps: "steps", csvExpected: "resultado esperado", withWord: "con", selectWord: "Seleccionar", onWord: "en", occurs: "ocurre" },
  "en": { title: "Step Recorder", intro: "Every click, filled field and returned message becomes one step - easy to read, easy to repeat.", record: "Record steps", manual: "Create manually", numbered: "Numbered steps", gherkin: "Gherkin", start: "I am on the screen", click: "Click", contextmenu: "Right-click", input: "Fill the field", select: "in the dropdown menu", check: "Check the box", uncheck: "Uncheck the box", submit: "Submit the form", key: "Press", navigation: "Navigate to", protected: "Fill protected field", expected: "What appeared on the screen", add: "Add step", save: "Save scenario", export: "Export CSV", empty: "No saved scenarios.", name: "Scenario name", steps: "steps", saved: "Scenario saved.", paused: "Step recording paused.", resumed: "Step recording resumed.", recording: "Step recording started.", resumedAfterReload: "Step recording resumed after the page reloaded.", discard: "Discard this step recording?", delete: "Delete this scenario?", edit: "Edit", remove: "Delete", duplicate: "Duplicate", back: "Scenarios", csvSteps: "steps", csvExpected: "expected result", withWord: "with", selectWord: "Select", onWord: "on", occurs: "happens" },
};

// Keeps every recorded step in the right Gherkin bucket automatically -- setup actions (filling
// fields, checking boxes) before the first real interaction stay under "Dado"/"E", the first
// click/submit/key/context-menu switches into "Quando", further interactions continue as "E" under
// it, and once a result message is picked up by the DOM observer below the next fresh interaction
// re-opens a new "Quando". The dropdown in the step editor (data-step-keyword) always lets the
// user override a wrong guess by hand, so this only has to be directionally right, not perfect.
const STEPS_TRIGGER_ACTIONS = new Set(["click", "submit", "contextmenu", "key"]);
// `recording` is only actually live while a recording is in progress (state.stepsRecording) --
// makeDocumentedStep is also called with no active recording at all, e.g. the editor's own "+
// Adicionar etapa" button on a manually-created or already-stopped scenario, so this must tolerate
// null rather than assume a recording is always running.
function nextStepsKeyword(recording, action) {
  if (action === "start") return "given";
  if (STEPS_TRIGGER_ACTIONS.has(action)) {
    const keyword = recording?.phase === "when" ? "and" : "when";
    if (recording) recording.phase = "when";
    return keyword;
  }
  return "and";
}

function stepsCopy() {
  const language = state.workspace?.preferences?.language || "pt-BR";
  return STEPS_COPY[language] || STEPS_COPY[language.split("-")[0]] || STEPS_COPY["pt-BR"];
}

function stepsExtraCopy() {
  const language = state.workspace?.preferences?.language || "pt-BR";
  const copy = {
    "pt-BR": { recordVideo: "Passos + vídeo", recordGif: "Passos + GIF", replay: "Repetir fluxo", replayUnavailable: "Este roteiro antigo não possui seletores seguros para repetição.", replayDone: "Fluxo repetido com sucesso.", report: "Criar relatório", device: "Dispositivo testado", noDevice: "Sem dispositivo" },
    es: { recordVideo: "Pasos + vídeo", recordGif: "Pasos + GIF", replay: "Repetir flujo", replayUnavailable: "Este guion antiguo no tiene selectores seguros para repetirlo.", replayDone: "Flujo repetido correctamente.", report: "Crear informe", device: "Dispositivo probado", noDevice: "Sin dispositivo" },
    en: { recordVideo: "Steps + video", recordGif: "Steps + GIF", replay: "Replay flow", replayUnavailable: "This older scenario has no safe selectors for replay.", replayDone: "Flow replayed successfully.", report: "Create report", device: "Tested device", noDevice: "No device" },
  };
  return copy[language] || copy[language.split("-")[0]] || copy["pt-BR"];
}

// Falling straight back to the bare tag name ("div", "span") once no label/text/placeholder is
// found produced steps like "Clique em div" -- unreadable, since a bare tag says nothing about
// which div. Test-id/role/id hooks (the same attributes Revelar test-id/seletor/XPath surfaces)
// are tried next since they identify the element even with no visible label; a real CSS selector
// (uniqueSelector, already used elsewhere for exactly this) is the last resort instead of the tag
// name alone, since "div.qts-card > button:nth-child(2)" is still something a reader can act on.
function stepsTargetName(element) {
  const target = element instanceof Element ? element : null;
  if (!target) return "elemento";
  const testId = target.getAttribute("data-testid") || target.getAttribute("data-test-id") || target.getAttribute("data-qa") || target.getAttribute("data-cy");
  const label = target.labels?.[0]?.innerText
    || target.getAttribute("aria-label")
    || target.getAttribute("title")
    || target.innerText
    || target.getAttribute("placeholder")
    || target.name
    || testId
    || target.id
    || target.getAttribute("alt")
    || target.querySelector?.("img[alt]")?.getAttribute("alt");
  const clean = String(label || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (clean) return clean;
  const hook = testId || target.getAttribute("role") || target.id;
  if (hook) return `${target.tagName.toLowerCase()} [${hook}]`;
  const selector = window.QTS_QA_TOOLS?.uniqueSelector?.(target);
  return selector || target.tagName.toLowerCase();
}

function makeDocumentedStep(action, text, source = "recorded") {
  return { id: crypto.randomUUID(), keyword: nextStepsKeyword(state.stepsRecording, action), action, text: String(text).slice(0, 500), expectedResult: "", url: safeCurrentUrl(), createdAt: new Date().toISOString(), source };
}

function appendDocumentedStep(step) {
  const recording = state.stepsRecording;
  if (!recording || recording.paused || recording.steps.length >= 200) return;
  const previous = recording.steps.at(-1);
  if (previous && previous.action === step.action && previous.targetKey && previous.targetKey === step.targetKey && step.action === "input") Object.assign(previous, step, { id: previous.id });
  else recording.steps.push(step);
  recording.lastActionAt = Date.now();
  updateStepsRecordingUi();
  persistStepsRecordingRun();
}

// chrome.storage.session snapshot of the in-progress steps recording (same rationale as
// persistMacroRecordingRun, including why it's synchronous rather than debounced) - without this,
// a reload mid-recording lost everything captured so far since only the *finished* recording (on
// Salvar) was ever written to storage.
function persistStepsRecordingRun() {
  const recording = state.stepsRecording;
  if (!recording) return;
  void recordingRunRequest("steps", "set", { id: recording.id, name: recording.name, mode: recording.mode, deviceId: recording.deviceId || "", paused: recording.paused, phase: recording.phase, lastActionAt: recording.lastActionAt, steps: recording.steps, expiresAt: Date.now() + 60 * 60_000 });
}

function updateStepsRecordingUi() {
  const root = state.shadowRoot;
  if (!root) return;
  const recording = state.stepsRecording;
  const bar = root.getElementById("stepsRecordingBar");
  bar?.classList.toggle("isHidden", !recording);
  if (!recording) { root.getElementById("stepsRecHistoryPanel")?.classList.add("isHidden"); return; }
  bar.classList.toggle("isPaused", recording.paused);
  root.getElementById("stepsRecCount").textContent = String(recording.steps.length);
  const pause = root.getElementById("stepsRecPauseButton");
  pause.innerHTML = recording.paused ? ICON("play") : ICON("pause");
  if (!root.getElementById("stepsRecHistoryPanel").classList.contains("isHidden")) renderStepsHistory();
}

const STEPS_KEYWORD_LABEL = { given: ["Dado que", "Dado que", "Given"], and: ["E", "Y", "And"], when: ["Quando", "Cuando", "When"], then: ["Então", "Entonces", "Then"] };
function stepsKeywordLabel(keyword) {
  const localeIndex = (state.workspace.preferences.language || "pt-BR").startsWith("en") ? 2 : (state.workspace.preferences.language || "").startsWith("es") ? 1 : 0;
  return STEPS_KEYWORD_LABEL[keyword]?.[localeIndex] || STEPS_KEYWORD_LABEL.when[localeIndex];
}

// Minimal, single-line-per-fact preview: one row per action, and -- only in Gherkin mode, since
// numbered mode has no keyword to justify it -- a second row right under it for the outcome that
// was picked up automatically, so what's on screen while recording matches the exported result.
function renderStepsHistory() {
  const panel = state.shadowRoot?.getElementById("stepsRecHistoryPanel");
  if (!panel) return;
  const recording = state.stepsRecording;
  const steps = recording?.steps || [];
  const isGherkin = recording?.mode === "gherkin";
  panel.innerHTML = steps.map((step, index) => {
    const prefix = isGherkin ? `${stepsKeywordLabel(step.keyword)} ` : `${index + 1}. `;
    const resultRow = isGherkin && step.expectedResult ? `<div class="qts-macro-hist-row qts-macro-hist-result"><span>${escapeHtml(stepsKeywordLabel("then"))} ${escapeHtml(step.expectedResult)} ${escapeHtml(stepsCopy().occurs)}</span></div>` : "";
    return `<div class="qts-macro-hist-row"><span>${escapeHtml(prefix)}${escapeHtml(step.text)}</span></div>${resultRow}`;
  }).join("") || `<div class="qts-macro-hist-empty">${escapeHtml(stepsCopy().empty)}</div>`;
}

function toggleStepsHistory() { const panel = state.shadowRoot?.getElementById("stepsRecHistoryPanel"); if (!panel) return; panel.classList.toggle("isHidden"); renderStepsHistory(); }
function toggleStepsPause() { if (!state.stepsRecording) return; state.stepsRecording.paused = !state.stepsRecording.paused; updateStepsRecordingUi(); persistStepsRecordingRun(); showQaToast(state.stepsRecording.paused ? stepsCopy().paused : stepsCopy().resumed); }
function undoStepsRecording() { state.stepsRecording?.steps.pop(); updateStepsRecordingUi(); persistStepsRecordingRun(); }
function cancelStepsRecording() { if (!state.stepsRecording || !confirm(stepsCopy().discard)) return; const hadMedia = Boolean(state.stepsRecording.mediaMode); state.stepsRecording.cleanup(); state.stepsRecording = null; updateStepsRecordingUi(); void recordingRunRequest("steps", "clear"); if (hadMedia && recordingState.status !== "idle") stopEvidenceRecording(); }

function startStepsRecording({ name, mode, deviceId = "" } = {}, resumeData = null) {
  if (!requirePlanFeature("stepsRecorder") || state.stepsRecording) return;
  if (!resumeData) closeDrawer();
  const copy = stepsCopy();
  const inputTimers = new WeakMap();
  const addInput = (element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
    const sensitive = window.QTS_QA_TOOLS.isSensitiveElement(element);
    const targetName = stepsTargetName(element);
    const isSelect = element instanceof HTMLSelectElement;
    const action = isSelect ? "select" : "input";
    // Selects read out the visible option text ("Mr."), not the raw <option value>, since that's
    // what a human actually sees and picks -- far more readable than an internal value string.
    const value = sensitive ? "" : String((isSelect ? element.selectedOptions[0]?.text : element.value) || "").slice(0, 160);
    const text = sensitive
      ? copy.protected
      : isSelect
        ? (value ? `${copy.selectWord} "${value}" ${copy.select} ${targetName}` : `${copy.selectWord} ${targetName}`)
        : (value ? `${copy.input} ${targetName} ${copy.withWord} "${value}"` : `${copy.input} ${targetName}`);
    appendDocumentedStep({ ...makeDocumentedStep(action, text), targetKey: window.QTS_QA_TOOLS.uniqueSelector(element) || "", value });
  };
  const onInput = (event) => { const element = event.target; clearTimeout(inputTimers.get(element)); inputTimers.set(element, setTimeout(() => addInput(element), 350)); };
  const onChange = (event) => {
    const element = event.target;
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) appendDocumentedStep({ ...makeDocumentedStep("check", `${element.checked ? copy.check : copy.uncheck} ${stepsTargetName(element)}`), targetKey: window.QTS_QA_TOOLS.uniqueSelector(element) || "", checked: element.checked });
    else addInput(element);
  };
  const onClick = (event) => { const element = event.target; if (!(element instanceof Element) || element.closest(`#${HOST_ID}`) || element.matches("input,textarea,select,option")) return; const target = element.closest("button,a,[role=button],label") || element; const label = stepsTargetName(target); const submit = target.matches("button[type=submit],input[type=submit]"); appendDocumentedStep({ ...makeDocumentedStep(submit ? "submit" : "click", `${submit ? copy.submit : copy.click} ${label}`), targetKey: window.QTS_QA_TOOLS.uniqueSelector(target) || "" }); };
  const onContext = (event) => { const element = event.target; if (element instanceof Element && !element.closest(`#${HOST_ID}`)) appendDocumentedStep(makeDocumentedStep("contextmenu", `${copy.contextmenu} ${stepsTargetName(element)}`)); };
  const onSubmit = (event) => appendDocumentedStep({ ...makeDocumentedStep("submit", `${copy.submit} ${stepsTargetName(event.target)}`), targetKey: window.QTS_QA_TOOLS.uniqueSelector(event.target) || "" });
  const onKey = (event) => { if (["Enter", "Tab"].includes(event.key) && event.target instanceof Element && !window.QTS_QA_TOOLS.isSensitiveElement(event.target)) appendDocumentedStep({ ...makeDocumentedStep("key", `${copy.key} "${event.key}" ${copy.onWord} ${stepsTargetName(event.target)}`), targetKey: window.QTS_QA_TOOLS.uniqueSelector(event.target) || "", value: event.key }); };
  const onNavigate = () => appendDocumentedStep(makeDocumentedStep("navigation", `${copy.navigation} ${document.title || safeCurrentUrl()}`));
  // Once a result message is picked up here, the recording's phase resets so the *next*
  // click/submit/key opens a fresh "Quando" instead of continuing to chain onto the one that just
  // got its outcome -- each interaction-then-result pair reads as its own Given/When/Then beat.
  const resultObserver = new MutationObserver((mutations) => {
    const recording = state.stepsRecording;
    if (!recording || recording.paused || Date.now() - Number(recording.lastActionAt || 0) > 3_000) return;
    const step = recording.steps.at(-1);
    if (!step || step.action === "start" || step.expectedResult) return;
    for (const mutation of mutations) {
      const raw = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      const candidate = raw?.closest?.('[role="alert"],[role="status"],[aria-live],.alert,.toast,.notification,.success,.error,#output') || [...mutation.addedNodes].find(node => node instanceof Element && node.innerText?.trim());
      if (!(candidate instanceof Element) || candidate.closest(`#${HOST_ID}`) || window.QTS_QA_TOOLS.isSensitiveElement(candidate)) continue;
      const style = getComputedStyle(candidate); const rect = candidate.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width < 1 || rect.height < 1) continue;
      const result = String(candidate.innerText || candidate.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500);
      if (result.length < 2 || result === step.text) continue;
      step.expectedResult = result;
      recording.phase = "then";
      updateStepsRecordingUi();
      persistStepsRecordingRun();
      break;
    }
  });
  document.addEventListener("input", onInput, true); document.addEventListener("change", onChange, true); document.addEventListener("click", onClick, true); document.addEventListener("contextmenu", onContext, true); document.addEventListener("submit", onSubmit, true); document.addEventListener("keydown", onKey, true); window.addEventListener("popstate", onNavigate); window.addEventListener("hashchange", onNavigate); resultObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  const cleanup = () => { resultObserver.disconnect(); document.removeEventListener("input", onInput, true); document.removeEventListener("change", onChange, true); document.removeEventListener("click", onClick, true); document.removeEventListener("contextmenu", onContext, true); document.removeEventListener("submit", onSubmit, true); document.removeEventListener("keydown", onKey, true); window.removeEventListener("popstate", onNavigate); window.removeEventListener("hashchange", onNavigate); };
  state.stepsRecording = resumeData
    ? { id: resumeData.id, name: resumeData.name, mode: resumeData.mode, deviceId: resumeData.deviceId || "", mediaMode: "", paused: resumeData.paused === true, phase: resumeData.phase || "given", lastActionAt: Date.now(), steps: resumeData.steps || [], cleanup }
    : { id: crypto.randomUUID(), name: String(name || copy.title).slice(0, 100), mode: mode === "gherkin" ? "gherkin" : "numbered", deviceId, mediaMode: "", paused: false, phase: "given", lastActionAt: Date.now(), steps: [makeDocumentedStep("start", `${copy.start} ${document.title || safeCurrentUrl()}`)], cleanup };
  updateStepsRecordingUi();
  showQaToast(resumeData ? copy.resumedAfterReload : copy.recording);
  if (!resumeData) persistStepsRecordingRun();
}

async function startStepsWithMedia(data, mediaMode) {
  await startEvidenceRecording(mediaMode);
  if (recordingState.status !== "recording") return;
  startStepsRecording(data);
  if (state.stepsRecording) {
    state.stepsRecording.mediaMode = mediaMode;
    persistStepsRecordingRun();
  }
}

async function stopStepsRecording() {
  const recording = state.stepsRecording;
  if (!recording) return;
  recording.cleanup();
  if (state.testSession && !state.testSession.stepRecordingIds.includes(recording.id)) state.testSession.stepRecordingIds.push(recording.id);
  state.stepsRecording = null;
  updateStepsRecordingUi();
  void recordingRunRequest("steps", "clear");
  if (recording.mediaMode && recordingState.status !== "idle") await stopEvidenceRecording();
  openStepsEditor({ id: recording.id, name: recording.name, mode: recording.mode, deviceId: recording.deviceId || "", mediaMode: recording.mediaMode || "", locale: state.workspace.preferences.language, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: recording.steps, context: sessionContextSnapshot() });
}

function csvCell(value) { let text = String(value ?? "").replace(/^([=+\-@\t\r])/, "'$1"); return `"${text.replaceAll('"', '""')}"`; }
// In Gherkin mode, a captured result ("Cadastro realizado com sucesso") becomes its own real
// "Entao ... acontece" line instead of hiding in a side column -- Given/When/Then only reads as a
// scenario if the outcome is actually one of the numbered lines.
function exportStepsCsv(recording) {
  const copy = stepsCopy();
  const keywords = { given: ["Dado que", "Dado que", "Given"], and: ["E", "Y", "And"], when: ["Quando", "Cuando", "When"], then: ["Então", "Entonces", "Then"] };
  const localeIndex = (state.workspace.preferences.language || "pt-BR").startsWith("en") ? 2 : (state.workspace.preferences.language || "").startsWith("es") ? 1 : 0;
  const isGherkin = recording.mode === "gherkin";
  const prefixed = (keyword, text) => `${isGherkin ? `${keywords[keyword]?.[localeIndex] || keywords.when[localeIndex]} ` : ""}${text}`;
  const rows = [["id", copy.csvSteps, copy.csvExpected]];
  for (const step of recording.steps) {
    rows.push([rows.length, prefixed(step.keyword, step.text), isGherkin ? "" : step.expectedResult]);
    if (isGherkin && step.expectedResult) rows.push([rows.length, prefixed("then", `${step.expectedResult} ${copy.occurs}`), ""]);
  }
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const filename = String(recording.name || copy.title).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "passos";
  triggerBlobDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${filename}-passos.csv`);
}

function openStepsEditor(recording) {
  const copy = stepsCopy(); const draft = structuredClone(recording); draft.steps ||= [];
  const renderRows = (body) => { const list = body.querySelector("#stepsEditorList"); list.innerHTML = draft.steps.map((step, index) => `<article class="qts-card" data-doc-step="${index}"><div class="qts-toolbar-row"><b>${index + 1}.</b><select data-step-keyword ${draft.mode === "gherkin" ? "" : "hidden"}>${[["given","Dado que / Given"],["and","E / And"],["when","Quando / When"],["then","Então / Then"]].map(([value,label]) => `<option value="${value}" ${step.keyword === value ? "selected" : ""}>${label}</option>`).join("")}</select><input data-step-text value="${escapeHtml(step.text)}" style="flex:1"/><button class="action" data-duplicate-step type="button">${escapeHtml(copy.duplicate)}</button><button class="action" data-remove-step type="button">${escapeHtml(copy.remove)}</button></div><details><summary>${escapeHtml(copy.expected)}</summary><textarea data-step-expected rows="2" placeholder="${escapeHtml(copy.expected)}">${escapeHtml(step.expectedResult || "")}</textarea></details></article>`).join("") || `<div class="qts-empty">${escapeHtml(copy.empty)}</div>`; list.querySelectorAll("[data-doc-step]").forEach((row) => { const index = Number(row.dataset.docStep); row.querySelector("[data-step-text]").addEventListener("input", e => draft.steps[index].text = e.target.value.slice(0,500)); row.querySelector("[data-step-expected]").addEventListener("input", e => draft.steps[index].expectedResult = e.target.value.slice(0,2000)); row.querySelector("[data-step-keyword]").addEventListener("change", e => draft.steps[index].keyword = e.target.value); row.querySelector("[data-remove-step]").addEventListener("click", () => { draft.steps.splice(index,1); renderRows(body); }); row.querySelector("[data-duplicate-step]").addEventListener("click", () => { draft.steps.splice(index+1,0,{...structuredClone(draft.steps[index]),id:crypto.randomUUID(),source:"manual"}); renderRows(body); }); }); };
  openDrawer({ title: copy.title, variant: "modal", bodyHtml: `<div class="qts-toolbar-row"><button id="stepsBack" class="action" type="button">${escapeHtml(copy.back)}</button><input id="stepsName" value="${escapeHtml(draft.name || "")}" placeholder="${escapeHtml(copy.name)}" style="flex:1"/><select id="stepsMode"><option value="numbered" ${draft.mode !== "gherkin" ? "selected" : ""}>${escapeHtml(copy.numbered)}</option><option value="gherkin" ${draft.mode === "gherkin" ? "selected" : ""}>${escapeHtml(copy.gherkin)}</option></select><button id="stepsExport" class="action" type="button">${escapeHtml(copy.export)}</button><button id="stepsSave" class="action primary" type="button">${escapeHtml(copy.save)}</button></div><div id="stepsEditorList"></div><button id="stepsAdd" class="action" type="button">+ ${escapeHtml(copy.add)}</button>`, onReady(body) { renderRows(body); body.querySelector("#stepsBack").addEventListener("click", openStepsRecorder); body.querySelector("#stepsMode").addEventListener("change", e => { draft.mode=e.target.value; renderRows(body); }); body.querySelector("#stepsAdd").addEventListener("click", () => { draft.steps.push(makeDocumentedStep("manual", "", "manual")); renderRows(body); }); body.querySelector("#stepsExport").addEventListener("click", () => { draft.name=body.querySelector("#stepsName").value; exportStepsCsv(draft); }); body.querySelector("#stepsSave").addEventListener("click", async () => { draft.name=body.querySelector("#stepsName").value.trim() || copy.title; draft.updatedAt=new Date().toISOString(); const index=(state.workspace.stepRecordings || []).findIndex(item=>item.id===draft.id); if(index>=0) state.workspace.stepRecordings[index]=draft; else state.workspace.stepRecordings.push(draft); await persistWorkspaceState(); openStepsRecorder(); showQaToast(copy.saved); }); } });
}

function executableDocumentedSteps(recording) {
  return (recording.steps || []).flatMap((step) => {
    if (!step.targetKey) return [];
    if (step.action === "click" || step.action === "submit") return [{ action: "click", selector: step.targetKey }];
    if (step.action === "input") return [{ action: "fill", selector: step.targetKey, value: String(step.value ?? "") }];
    if (step.action === "select") return [{ action: "select", selector: step.targetKey, value: String(step.value ?? "") }];
    if (step.action === "check") return [{ action: step.checked === false ? "uncheck" : "check", selector: step.targetKey }];
    if (step.action === "key") return [{ action: "press", selector: step.targetKey, value: String(step.value || "Enter") }];
    return [];
  });
}

async function replayDocumentedSteps(recording) {
  const copy = stepsExtraCopy();
  const steps = executableDocumentedSteps(recording);
  if (!steps.length) { showQaToast(copy.replayUnavailable, "error"); return; }
  closeDrawer();
  try {
    for (const step of steps) await window.QTS_QA_TOOLS.executeStep(step);
    showQaToast(copy.replayDone);
  } catch (error) {
    showQaToast(String(error?.message || error), "error");
  }
}

function reportDocumentedSteps(recording) {
  const steps = (recording.steps || []).map((step, index) => `${index + 1}. ${step.text}`).join("\n");
  const device = (state.workspace.devices || []).find((item) => item.id === recording.deviceId);
  openReportBuilder({
    title: recording.name || stepsCopy().title,
    steps,
    description: device ? `${stepsExtraCopy().device}: ${device.label}` : "",
  }, recording.context || sessionContextSnapshot());
}

function openStepsRecorder() {
  if (!requirePlanFeature("stepsRecorder")) return;
  const copy = stepsCopy();
  const extra = stepsExtraCopy();
  const recordings = state.workspace.stepRecordings || [];
  const cards = recordings.map((item) => {
    const canReplay = executableDocumentedSteps(item).length > 0;
    return `<article class="qts-card" data-recording-id="${escapeHtml(item.id)}">
      <div class="qts-card-head"><div><b>${escapeHtml(item.name)}</b><br><small>${item.steps.length} ${escapeHtml(copy.steps)}</small></div></div>
      <div class="qts-card-actions">
        <button class="action primary" data-action="replay" type="button" ${canReplay ? "" : "disabled"} title="${canReplay ? "" : escapeHtml(extra.replayUnavailable)}">${ICON("play")} ${escapeHtml(extra.replay)}</button>
        <button class="action" data-action="edit" type="button">${escapeHtml(copy.edit)}</button>
        <button class="action" data-action="report" type="button">${escapeHtml(extra.report)}</button>
        <button class="action" data-action="export" type="button">${escapeHtml(copy.export)}</button>
        <button class="action" data-action="delete" type="button">${escapeHtml(copy.remove)}</button>
      </div>
    </article>`;
  }).join("");
  openDrawer({
    title: copy.title,
    variant: "modal",
    bodyHtml: `<p class="qts-tool-lead">${escapeHtml(copy.intro)}</p>
      <div class="qts-card">
        <label class="qts-field-label">${escapeHtml(copy.name)}<input id="newStepsName" placeholder="${escapeHtml(copy.name)}"/></label>
        <label class="qts-field-label">${escapeHtml(extra.device)}<select id="newStepsDevice"><option value="">${escapeHtml(extra.noDevice)}</option>${(state.workspace.devices || []).map((device) => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.label)}</option>`).join("")}</select></label>
        <div class="qts-card-actions">
          <button id="startSteps" class="action primary" type="button">${ICON("recordStart")} ${escapeHtml(copy.record)}</button>
          <button id="startStepsVideo" class="action" type="button">${ICON("recordStart")} ${escapeHtml(extra.recordVideo)}</button>
          <button id="startStepsGif" class="action" type="button">${ICON("recordStart")} ${escapeHtml(extra.recordGif)}</button>
          <button id="manualSteps" class="action" type="button">+ ${escapeHtml(copy.manual)}</button>
        </div>
      </div>
      <div id="stepsList">${cards || `<div class="qts-empty">${escapeHtml(copy.empty)}</div>`}</div>`,
    onReady(body) {
      const data = () => ({ name: body.querySelector("#newStepsName").value.trim() || `${copy.title} ${new Date().toLocaleTimeString().slice(0, 5)}`, mode: "numbered", deviceId: body.querySelector("#newStepsDevice").value });
      body.querySelector("#startSteps").addEventListener("click", () => startStepsRecording(data()));
      body.querySelector("#startStepsVideo").addEventListener("click", () => startStepsWithMedia(data(), "video"));
      body.querySelector("#startStepsGif").addEventListener("click", () => startStepsWithMedia(data(), "gif"));
      body.querySelector("#manualSteps").addEventListener("click", () => openStepsEditor({ id: crypto.randomUUID(), ...data(), locale: state.workspace.preferences.language, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [], context: sessionContextSnapshot() }));
      body.querySelectorAll("[data-recording-id]").forEach((card) => card.addEventListener("click", async (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (!action) return;
        const item = state.workspace.stepRecordings.find((value) => value.id === card.dataset.recordingId);
        if (!item) return;
        if (action === "replay") await replayDocumentedSteps(item);
        if (action === "edit") openStepsEditor(item);
        if (action === "report") reportDocumentedSteps(item);
        if (action === "export") exportStepsCsv(item);
        if (action === "delete" && confirm(copy.delete)) {
          state.workspace.stepRecordings = state.workspace.stepRecordings.filter((value) => value.id !== item.id);
          await persistWorkspaceState();
          openStepsRecorder();
        }
      }));
    },
  });
}

function createEvidenceMediaRecorder(stream, mimeType) {
  return new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 4_000_000,
  });
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

function toggleRecordTypeMenu(forceOpen) {
  const menu = state.shadowRoot?.getElementById("recordTypeMenu");
  if (!menu) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : menu.classList.contains("isHidden");
  menu.classList.toggle("isHidden", !shouldOpen);
}

function handleRecordToggle() {
  if (recordingState.status === "idle") { toggleRecordTypeMenu(); return; }
  if (recordingState.status === "recording") { pauseEvidenceRecording(); return; }
  resumeEvidenceRecording();
}

function startPartRotationTimer() {
  if (recordingState.mode !== "parts") return;
  recordingState.partTimerId = window.setTimeout(handlePartRotationTick, RECORD_PART_DURATION_MS);
}

function stopPartRotationTimer() {
  if (recordingState.partTimerId) {
    window.clearTimeout(recordingState.partTimerId);
    recordingState.partTimerId = null;
  }
}

async function handlePartRotationTick() {
  if (recordingState.status !== "recording" || recordingState.mode !== "parts") return;
  await rotateRecordingSegment();
  if (recordingState.status === "recording") startPartRotationTimer();
}

// Finishes the current MediaRecorder segment as its own standalone playable file (a fresh
// MediaRecorder on the same live stream, not a mid-stream split - WebM/MP4 containers need their
// own header, so this is the only reliable way to get N independently-playable chunks) and starts
// the next one immediately so no video time is lost between segments.
async function rotateRecordingSegment() {
  const recorder = recordingState.recorder;
  if (!recorder || !recordingState.stream) return;
  const stopped = new Promise((resolveStop) => recorder.addEventListener("stop", resolveStop, { once: true }));
  recorder.stop();
  await stopped;
  recordingState.parts.push(new Blob(recordingState.chunks, { type: recordingState.mimeType || "video/webm" }));
  recordingState.chunks = [];
  if (recordingState.status !== "recording") return;
  recordingState.recorder = createEvidenceMediaRecorder(recordingState.stream, recordingState.mimeType);
  recordingState.recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) recordingState.chunks.push(event.data);
  });
  // Do not request one Blob every second. In Chromium's MP4 recorder those are media fragments;
  // rebuilding a file by concatenating them can leave duration/index metadata unusable in common
  // players. Let stop() finalize one complete, seekable container for each recording segment.
  recordingState.recorder.start();
}

function stopGifCaptureTimer() {
  if (recordingState.gifCaptureId) window.clearTimeout(recordingState.gifCaptureId);
  recordingState.gifCaptureId = null;
}

function createGifEncoder() {
  return new window.QTS_GIF.GifEncoder(recordingState.gifCanvas.width, recordingState.gifCanvas.height, Math.round(100 / GIF_FPS));
}

function captureGifFrame() {
  if (recordingState.status !== "recording" || recordingState.mode !== "gif") return;
  const started = performance.now();
  const canvas = recordingState.gifCanvas;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.drawImage(recordingState.gifVideo, 0, 0, canvas.width, canvas.height);
  const now = Date.now();
  const delayCs = recordingState.gifLastFrameAt ? Math.round((now - recordingState.gifLastFrameAt) / 10) : Math.round(100 / GIF_FPS);
  recordingState.gifEncoder.addFrame(context.getImageData(0, 0, canvas.width, canvas.height), delayCs);
  recordingState.gifLastFrameAt = now;
  if (Date.now() - recordingState.gifSegmentStartedAt >= GIF_PART_DURATION_MS) {
    recordingState.parts.push(recordingState.gifEncoder.finish());
    recordingState.gifEncoder = createGifEncoder();
    recordingState.gifSegmentStartedAt = Date.now();
    recordingState.gifLastFrameAt = 0;
  }
  // Serial scheduling provides backpressure: a slow device drops capture FPS instead of piling up
  // callbacks and exhausting the page's memory. The GIF remains playable at its declared cadence.
  const remaining = Math.max(0, 1000 / GIF_FPS - (performance.now() - started));
  recordingState.gifCaptureId = window.setTimeout(captureGifFrame, remaining);
}

async function initializeGifCapture(stream) {
  if (!window.QTS_GIF?.GifEncoder) throw new Error("GIF encoder unavailable");
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play();
  const scale = Math.min(1, GIF_MAX_WIDTH / video.videoWidth, GIF_MAX_HEIGHT / video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
  canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
  recordingState.gifVideo = video;
  recordingState.gifCanvas = canvas;
  recordingState.gifEncoder = createGifEncoder();
  recordingState.gifSegmentStartedAt = Date.now();
  recordingState.gifLastFrameAt = 0;
}

async function startEvidenceRecording(mode = "video") {
  if (!navigator.mediaDevices?.getDisplayMedia || (mode !== "gif" && typeof MediaRecorder === "undefined")) {
    openDrawer({ title: state.t.recordingUnavailableTitle, bodyHtml: `<p>${escapeHtml(state.t.recordingUnavailableBody)}</p>` });
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 24, max: 30 } }, audio: false });
  } catch {
    return; // User cancelled the native picker - not an error.
  }
  const mimeType = pickRecordingMimeType();
  recordingState.mode = mode;
  recordingState.stream = stream;
  recordingState.chunks = [];
  recordingState.parts = [];
  recordingState.mimeType = mimeType;
  recordingState.elapsedMs = 0;
  if (mode === "gif") {
    try { await initializeGifCapture(stream); }
    catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      openDrawer({ title: state.t.recordingUnavailableTitle, bodyHtml: `<p>${escapeHtml(error.message)}</p>` });
      return;
    }
    recordingState.recorder = null;
  } else {
    recordingState.recorder = createEvidenceMediaRecorder(stream, mimeType);
    recordingState.mimeType = recordingState.recorder.mimeType || mimeType;
    recordingState.recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) recordingState.chunks.push(event.data);
    });
  }
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (recordingState.status !== "idle") stopEvidenceRecording();
  }, { once: true });

  recordingState.status = "recording";
  recordingState.segmentStartedAt = Date.now();
  if (mode === "gif") captureGifFrame();
  else recordingState.recorder.start();
  recordingState.timerId = window.setInterval(updateRecordTimerDisplay, 500);
  startPartRotationTimer();
  setRecordingUi();
}

function pauseEvidenceRecording() {
  if (recordingState.status !== "recording") return;
  if (recordingState.mode === "gif") stopGifCaptureTimer();
  else if (recordingState.recorder) recordingState.recorder.pause();
  recordingState.elapsedMs += Date.now() - recordingState.segmentStartedAt;
  recordingState.status = "paused";
  if (recordingState.mode === "gif") recordingState.gifPausedAt = Date.now();
  stopPartRotationTimer();
  setRecordingUi();
}

function resumeEvidenceRecording() {
  if (recordingState.status !== "paused") return;
  if (recordingState.mode !== "gif" && recordingState.recorder) recordingState.recorder.resume();
  recordingState.segmentStartedAt = Date.now();
  recordingState.status = "recording";
  if (recordingState.mode === "gif") {
    recordingState.gifSegmentStartedAt += Date.now() - recordingState.gifPausedAt;
    recordingState.gifPausedAt = 0;
    recordingState.gifLastFrameAt = 0;
    captureGifFrame();
  }
  startPartRotationTimer();
  setRecordingUi();
}

// Screen name segment: the current page's own URL path is a far more stable, meaningful label
// than the page <title> (which often carries a site name/suffix noise), and matches what testers
// actually think of as "which screen was this evidence from" (e.g. "/checkout" -> "checkout").
function currentScreenNameSlug() {
  const path = window.location.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "";
  const slug = last.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "pagina";
}

function compactTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// evidencia_{status}_{tela}_{yyyyMMddHHmmss} (status segment only present when one was actually
// attributed to this specific piece of evidence -- never guessed, never left stale from an
// unrelated earlier action).
function buildEvidenceFileBaseName(statusKey) {
  if (state.testSession) state.testSession.evidenceCount += 1;
  const prefix = state.t.recordFilenamePrefix || "evidencia";
  const segments = [prefix];
  if (statusKey) segments.push(statusKey);
  segments.push(currentScreenNameSlug());
  segments.push(compactTimestamp());
  return segments.join("_");
}

// Fallback for evidence captured without the forced status-reminder flow (screenshots always,
// recordings when the "lembrar de atribuir status" preference is off): reuses a status the user
// already marked on this exact page moments ago instead of just leaving the filename unlabeled,
// but only if it's recent and for this URL -- a stale or unrelated status must never get attached.
async function resolveRecentStatusKeyForCurrentPage() {
  try {
    const stored = await chrome.storage.local.get(TEST_STATUS_HISTORY_KEY);
    const history = Array.isArray(stored[TEST_STATUS_HISTORY_KEY]) ? stored[TEST_STATUS_HISTORY_KEY] : [];
    const latest = history[0];
    if (!latest || latest.url !== window.location.href) return null;
    const ageMs = Date.now() - new Date(latest.at).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 5 * 60_000) return null;
    return latest.status || null;
  } catch {
    return null;
  }
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Single segment downloads directly; 2+ segments (mode "parts", recording longer than 30s) get
// packaged into one .zip via window.QTS_ZIP so the user gets one file to attach as evidence
// instead of a scattered pile of part1/part2/... downloads.
async function downloadRecordingResult(parts, extension, statusKey) {
  const baseName = buildEvidenceFileBaseName(statusKey);
  if (parts.length <= 1) {
    triggerBlobDownload(parts[0], `${baseName}.${extension}`);
    return;
  }
  const partWord = state.t.recordFilenamePart || "part";
  const files = await Promise.all(parts.map(async (blob, index) => ({
    name: `${baseName}_${partWord}${index + 1}.${extension}`,
    data: new Uint8Array(await blob.arrayBuffer()),
  })));
  triggerBlobDownload(window.QTS_ZIP.createZip(files), `${baseName}.zip`);
}

async function recordingContainerExtension(blob) {
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...header);
  // ISO Base Media File Format starts with a size followed by the `ftyp` box. This verifies the
  // bytes instead of trusting a requested MIME type that a browser may silently substitute.
  if (header.length >= 12 && ascii.slice(4, 8) === "ftyp") return "mp4";
  // WebM is EBML (1A 45 DF A3). Never label this output .mp4.
  if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) return "webm";
  return "webm";
}

// Entry point for the visible Stop button (as opposed to the native "stop sharing" bar, which
// ends the capture source itself and calls stopEvidenceRecording directly below - forcing the
// status modal there would be pointless since there'd be nothing left to actually capture).
function handleStopRecordingClick() {
  if (state.workspace?.preferences?.remindTestStatusOnRecording && recordingState.status !== "idle") {
    openTestStatusModal({ forced: true, onDone: (option) => stopEvidenceRecording(option.key) });
    return;
  }
  stopEvidenceRecording();
}

async function stopEvidenceRecording(statusKey) {
  if (!["recording", "paused"].includes(recordingState.status) || (!recordingState.recorder && recordingState.mode !== "gif")) return;
  stopPartRotationTimer();
  stopGifCaptureTimer();
  const recorder = recordingState.recorder;
  if (recordingState.status === "recording") recordingState.elapsedMs += Date.now() - recordingState.segmentStartedAt;
  recordingState.status = "stopping";
  window.clearInterval(recordingState.timerId);
  recordingState.timerId = null;

  if (recorder) {
    const stopped = new Promise((resolveStop) => recorder.addEventListener("stop", resolveStop, { once: true }));
    recorder.stop();
    await stopped;
  }
  recordingState.stream?.getTracks().forEach((track) => track.stop());

  const isGif = recordingState.mode === "gif";
  const finalBlob = isGif
    ? (recordingState.gifEncoder.frameCount ? recordingState.gifEncoder.finish() : null)
    : new Blob(recordingState.chunks, { type: recordingState.mimeType || "video/webm" });
  const parts = (recordingState.mode === "parts" || isGif) ? [...recordingState.parts, finalBlob] : [finalBlob];
  const nonEmptyParts = parts.filter((blob) => blob?.size > 50);
  if (nonEmptyParts.length) {
    const extension = isGif ? "gif" : await recordingContainerExtension(finalBlob);
    const resolvedStatusKey = statusKey || await resolveRecentStatusKeyForCurrentPage();
    await downloadRecordingResult(nonEmptyParts, extension, resolvedStatusKey);
  } else {
    showQaToast("A gravação terminou antes de capturar um quadro válido.", "error");
  }

  recordingState.status = "idle";
  recordingState.mode = "video";
  recordingState.recorder = null;
  recordingState.stream = null;
  recordingState.chunks = [];
  recordingState.parts = [];
  if (recordingState.gifVideo) { recordingState.gifVideo.srcObject = null; recordingState.gifVideo.remove(); }
  recordingState.gifVideo = null;
  recordingState.gifCanvas = null;
  recordingState.gifEncoder = null;
  recordingState.gifLastFrameAt = 0;
  recordingState.gifPausedAt = 0;
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
  // Unauthorized no longer tears the bar down: syncToolbarForCurrentLocation still mounts it
  // (in its stripped "logged out" mode, see render()) whenever the URL matches a configured
  // environment, so a session expiring mid-use doesn't silently make the toolbar vanish.
  syncToolbarForCurrentLocation();
  return state.authorized;
}

async function boot() {
  // Registered with allFrames:true so the bar can render inside the Breakpoint Viewer's own
  // device-preview iframes (matching the same URL patterns as the top-level page) - but that
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
  state.siteScope = await getSiteScope();
  state.httpErrors = loadHttpErrorsFromSession();
  // Runs regardless of the result now: an unauthorized session still needs the location/storage
  // listeners below wired up, so the stripped "logged out" bar (see render()) keeps tracking
  // SPA navigation and reacts the moment the user signs back in via options.js.
  const authorizedAtBoot = await refreshAuthorization(true);

  onStorageChanged(async (changes) => {
    if (!changes[STORAGE_KEYS.workspace] && !changes[STORAGE_KEYS.siteScope]) return;
    if (changes[STORAGE_KEYS.workspace]) state.workspace = await getWorkspace();
    if (changes[STORAGE_KEYS.siteScope]) state.siteScope = await getSiteScope();
    syncToolbarForCurrentLocation();
  });

  document.addEventListener("qts:location-change", () => syncToolbarForCurrentLocation());
  document.addEventListener("keydown", handleCustomToolShortcut, true);
  window.addEventListener("popstate", () => syncToolbarForCurrentLocation());
  window.addEventListener("hashchange", () => syncToolbarForCurrentLocation());
  let mobileLayout = isMobileViewport();
  window.addEventListener("resize", () => {
    const nextMobileLayout = isMobileViewport();
    if (nextMobileLayout === mobileLayout) return;
    mobileLayout = nextMobileLayout;
    syncToolbarForCurrentLocation();
  });
  state.locationInterval = window.setInterval(() => {
    if (state.lastHref === window.location.href) return;
    state.lastHref = window.location.href;
    syncToolbarForCurrentLocation();
  }, 200);
  // force:false here so this periodic poll reuses the background script's shared 30s
  // access-status cache (see auth.js ACCESS_CACHE_MS) instead of every open tab hitting the
  // edge function independently every 5 minutes - with several tabs open that multiplier alone
  // blew through access-status' rate limit (enforceRateLimit in access-status/index.ts).
  state.accessInterval = window.setInterval(() => { void refreshAuthorization(false); }, 5 * 60_000);
  if (authorizedAtBoot) {
    const pendingRun = await macroRunRequest("get");
    if (pendingRun?.ok && pendingRun.run) void continueMacroRun(pendingRun.run, { announce: true });
    // Same idea, for the two *recording* phases (see qts:recording-run/persistStepsRecordingRun/
    // persistMacroRecordingRun): a snapshot left behind by the previous page load, before it got
    // torn down by the reload, is picked back up here instead of silently vanishing.
    const pendingStepsRecording = await recordingRunRequest("steps", "get");
    if (pendingStepsRecording?.ok && pendingStepsRecording.run) startStepsRecording({}, pendingStepsRecording.run);
    const pendingMacroRecording = await recordingRunRequest("macro", "get");
    if (pendingMacroRecording?.ok && pendingMacroRecording.run) startMacroRecording(pendingMacroRecording.run);
  }
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
  if (message?.type === "qts:open-detached-tool") {
    const handled = state.authorized === true && openDetachedTool(String(message.toolKey || ""));
    sendResponse({ handled });
    return undefined;
  }
  return undefined;
});

void boot();
