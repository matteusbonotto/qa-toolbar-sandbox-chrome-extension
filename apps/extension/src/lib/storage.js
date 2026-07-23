// Durable extension state shared by the background service worker. Keep the
// classic-script twin (storage-content.js) in sync for options/content pages.

export const STORAGE_KEYS = Object.freeze({
  workspace: "qtsWorkspaceV1",
  siteScope: "qtsSiteScopeV1",
  uiState: "qtsUiStateV1",
  authSession: "qtsAuthSessionV1",
  accessStatus: "qtsAccessStatusV1",
});

const COLLECTION_KEYS = [
  "clients", "projects", "products", "environments", "urlBindings", "testAccounts",
  "paymentMethods", "apis", "inspectors", "resources", "macros", "stepRecordings",
];

export const DEFAULT_ENABLED_TOOLS = Object.freeze([
  "clickSpy", "freezeClock", "forceHttp", "errorMonitor", "inspectors", "jsonStudio",
  "breakpoints", "testAccounts", "paymentMethods", "resources",
  "characterCounter", "macroStudio", "multiClick", "inputLab", "fakerFill", "keyView", "elementCapture",
  "blurElements", "holofote", "stepsRecorder",
]);
const PINNABLE_TOOLS = new Set(DEFAULT_ENABLED_TOOLS);
const SCHEMA_3_TOOLS = ["characterCounter", "macroStudio", "multiClick", "inputLab", "fakerFill"];
const SCHEMA_4_TOOLS = ["keyView"];
const SCHEMA_5_TOOLS = ["errorMonitor"];
const SCHEMA_6_TOOLS = ["elementCapture"];
const SCHEMA_7_TOOLS = ["blurElements"];
const SCHEMA_8_TOOLS = ["holofote"];
const SCHEMA_11_TOOLS = ["stepsRecorder"];
const KEY_VIEW_POSITIONS = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
]);
const KEY_VIEW_SIZES = new Set(["small", "medium", "large"]);

const MACRO_ACTIONS = new Set(["click", "fill", "select", "check", "press", "wait", "scroll", "multiClick", "fakerFill"]);
const SENSITIVE_HINT = /(?:passw(?:or)?d|senha|secret|token|authorization|auth[_-]?key|api[_-]?key|card|cart[aã]o|credit|debit|cc(?:num|number)?|cvv|cvc|security[_-]?code)/i;
const STEP_ACTIONS = new Set(["start", "click", "contextmenu", "input", "submit", "navigation", "manual"]);
const STEP_KEYWORDS = new Set(["given", "and", "when", "then"]);
const STEP_LOCALES = new Set(["pt-BR", "es", "en"]);

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function id(value, prefix, index) {
  const clean = text(value, 120).replace(/[^a-z0-9_-]/gi, "_");
  return clean || `${prefix}_${index + 1}`;
}

// 300k chars (~225KB binary) comfortably covers a small uploaded icon as a data: URL — plain
// http(s) logo URLs are always far under this, so the cap only really bites oversized uploads.
const IMAGE_VALUE_MAX_CHARS = 300_000;

function entityAppearance(item) {
  const logoUrl = text(item?.logoUrl ?? item?.logo ?? item?.imageUrl, IMAGE_VALUE_MAX_CHARS);
  const abbreviation = text(item?.abbreviation ?? item?.shortName ?? item?.code, 4).toUpperCase();
  return {
    ...(logoUrl ? { logoUrl } : {}),
    ...(abbreviation ? { abbreviation } : {}),
    showLabel: item?.showLabel !== false,
    active: item?.active !== false,
  };
}

const CUSTOM_FIELD_TYPES = new Set(["string", "boolean", "number"]);

function normalizeCustomFields(input) {
  return (Array.isArray(input) ? input : []).slice(0, 20).map((field, index) => {
    const type = CUSTOM_FIELD_TYPES.has(field?.type) ? field.type : "string";
    const key = text(field?.key ?? field?.label, 40) || `campo_${index + 1}`;
    let value;
    if (type === "boolean") value = field?.value === true;
    else if (type === "number") value = Number.isFinite(Number(field?.value)) ? Number(field.value) : 0;
    else value = text(field?.value, 200);
    return { key, type, value };
  }).filter((field) => field.key);
}

// Test accounts/payment methods used to carry exactly one environmentId and one optional
// productId, so a credential valid in both DEV and QA (or for both AR and BO) had to be
// registered twice. This reads either the current array shape or the legacy singular field
// (environmentId/productId), dedupes, and drops anything that no longer points at a real
// environment/product — permanently dual-shape, like normalizeUrlBinding's patterns/pattern
// reader, so an older export always imports cleanly without a version-gated migration step.
function normalizeIdArray(rawArray, rawSingular, validEntities) {
  const source = Array.isArray(rawArray) ? rawArray : (rawSingular != null ? [rawSingular] : []);
  const validIds = new Set(validEntities.map((entity) => entity.id));
  return [...new Set(source.map((value) => text(value, 120)))].filter((value) => validIds.has(value));
}

function normalizeTestAccount(item, index, environments, products) {
  const environmentIds = normalizeIdArray(item?.environmentIds, item?.environmentId, environments);
  if (!environmentIds.length) return null;
  return {
    id: id(item?.id, "testAccount", index),
    environmentIds,
    productIds: normalizeIdArray(item?.productIds, item?.productId ?? item?.product_id, products),
    label: text(item?.label, 120) || `Conta ${index + 1}`,
    accountType: text(item?.accountType, 60),
    accountTypeImage: text(item?.accountTypeImage, IMAGE_VALUE_MAX_CHARS),
    username: text(item?.username, 200),
    password: text(item?.password, 200),
    notes: text(item?.notes, 1_000),
    customFields: normalizeCustomFields(item?.customFields),
    active: item?.active !== false,
  };
}

export function normalizeUrlPatterns(input) {
  const values = Array.isArray(input) ? input : String(input ?? "").split(/[\n,]/);
  const normalized = [];
  for (const rawValue of values.flat(3)) {
    let value = text(rawValue, 2_048);
    if (!value) continue;
    if (!value.includes("://") && !value.startsWith("*")) value = `*://${value.replace(/^\/+/, "")}`;
    if (!value.includes("*")) {
      try {
        const url = new URL(value);
        url.hash = "";
        url.search = "";
        value = url.pathname === "/" ? `${url.origin}/*` : `${url.href.replace(/\/$/, "")}*`;
      } catch {
        // Keep non-standard wildcard-compatible values; matching fails closed.
      }
    } else if (/^(?:[a-z]+|\*):\/\/[^/]+$/i.test(value)) {
      value += "/*";
    }
    if (!normalized.includes(value)) normalized.push(value);
  }
  return normalized.slice(0, 100);
}

// Environments (DEV/QA/BETA/PROD) used to require exactly one Product, so a multi-country import
// (4 tiers × N countries) created 4×N duplicated, country-suffixed environments instead of 4
// reusable ones. The fix: a URL binding — not the environment — carries the Product association,
// the same way the options page's "URLs" tab already lets one URL relate to N environments; this
// just extends that pattern with a required Product per binding. `environmentIds` supports the
// rare case of one physical URL genuinely serving more than one tier simultaneously (already
// allowed today), while `productId` is single because a concrete URL belongs to exactly one
// deployment/country.
// `patterns` accepts either the current array shape or a legacy singular `pattern` string (any
// already-saved schemaVersion-7 workspace before this field became an array) — this reader is
// permanently dual-shape, not a one-time migration, so no schemaVersion bump was needed for it.
function normalizeUrlBinding(item, index, products, environments) {
  const patterns = normalizeUrlPatterns(Array.isArray(item?.patterns) ? item.patterns : (item?.pattern != null ? [item.pattern] : []));
  if (!patterns.length) return null;
  const productId = id(item?.productId ?? item?.product_id, "product", 0);
  if (!products.some((product) => product.id === productId)) return null;
  const environmentIds = [...new Set((Array.isArray(item?.environmentIds) ? item.environmentIds : []).map((value) => text(value, 120)))]
    .filter((environmentId) => environments.some((environment) => environment.id === environmentId));
  if (!environmentIds.length) return null;
  return {
    id: id(item?.id, "binding", index),
    patterns, productId, environmentIds,
    primaryUrl: /^https?:\/\//i.test(text(item?.primaryUrl, 2_048)) ? text(item?.primaryUrl, 2_048) : "",
    active: item?.active !== false,
  };
}

// Migration for schemaVersion < 7: expands each legacy environment's own `urlPatterns` (it used
// to own them directly, alongside a single `productId`) into one binding row per (product,
// environment) pair, carrying the *entire* patterns array over — merged in normalizeUrlBindings
// below by that same pair, so re-normalizing an already-migrated workspace is idempotent. The
// environment's old `primaryUrl` only carries over when it had exactly one pattern — with several,
// there's no way to know which country/product URL it was meant for, so it's safer to leave it
// unset than guess wrong.
function migrateLegacyEnvironmentUrls(source, products, environments) {
  const rows = [];
  for (const rawEnvironment of Array.isArray(source.environments) ? source.environments : []) {
    const legacyProductId = id(rawEnvironment?.productId ?? rawEnvironment?.product_id, "product", 0);
    if (!products.some((product) => product.id === legacyProductId)) continue;
    const legacyEnvironmentId = id(rawEnvironment?.id, "env", 0);
    if (!environments.some((environment) => environment.id === legacyEnvironmentId)) continue;
    const legacyPatterns = normalizeUrlPatterns(rawEnvironment?.urlPatterns ?? rawEnvironment?.urls ?? rawEnvironment?.domains ?? rawEnvironment?.url ?? rawEnvironment?.baseUrl);
    if (!legacyPatterns.length) continue;
    const legacyPrimaryUrl = text(rawEnvironment?.primaryUrl, 2_048);
    rows.push({
      patterns: legacyPatterns, productId: legacyProductId, environmentIds: [legacyEnvironmentId],
      primaryUrl: legacyPatterns.length === 1 ? legacyPrimaryUrl : "",
    });
  }
  return rows;
}

// Bindings merge when they share the same product AND the same exact set of environments — that's
// the real identity of "one relationship" now that a binding can hold several patterns; two
// separate submissions for the same product+environments (or two legacy urlPatterns entries for
// the same environment) should accumulate into one binding's patterns array, not create sibling
// rows a founder would have to hunt across to find "all the URLs for WebApp in DEV."
function normalizeUrlBindings(source, products, environments) {
  const bindings = [];
  const byKey = new Map();
  const rawRows = [
    ...(Array.isArray(source.urlBindings) ? source.urlBindings : []),
    ...(Number(source.schemaVersion || 0) < 7 ? migrateLegacyEnvironmentUrls(source, products, environments) : []),
  ];
  for (const rawRow of rawRows) {
    const binding = normalizeUrlBinding(rawRow, bindings.length, products, environments);
    if (!binding) continue;
    const key = `${binding.productId}|${[...binding.environmentIds].sort().join(",")}`;
    const existing = byKey.get(key);
    if (existing) {
      for (const pattern of binding.patterns) if (!existing.patterns.includes(pattern)) existing.patterns.push(pattern);
      if (!existing.primaryUrl && binding.primaryUrl) existing.primaryUrl = binding.primaryUrl;
      continue;
    }
    byKey.set(key, binding);
    bindings.push(binding);
  }
  return bindings;
}

export function createEmptyWorkspace() {
  return {
    schemaVersion: 11,
    updatedAt: new Date().toISOString(),
    clients: [], projects: [], products: [], environments: [], urlBindings: [], testAccounts: [],
    paymentMethods: [], apis: [], inspectors: [], resources: [], macros: [], stepRecordings: [],
    preferences: {
      language: "pt-BR",
      appearanceTheme: "dark",
      pushSiteContent: true,
      compactMode: false,
      compactEntities: { client: false, project: false, product: false },
      avatarShape: "square",
      pinnedTools: [],
      pinnedMacroIds: [],
      enabledTools: [...DEFAULT_ENABLED_TOOLS],
      toolsMenuOrder: [...DEFAULT_ENABLED_TOOLS],
      soundEffects: true,
      remindTestStatusOnRecording: false,
      breadcrumbVisibility: { client: true, project: true, product: true, environment: true },
      breadcrumbOrder: ["client", "project", "product"],
      keyView: {
        enabled: false,
        typingMode: false,
        theme: "dark",
        position: "bottom-center",
        mouseEffects: true,
        keySize: "medium",
        mouseSize: "medium",
      },
    },
  };
}

const BREADCRUMB_ORDER_KEYS = ["client", "project", "product"];
// Environment is intentionally never part of this order — it's the "current tier" indicator,
// always last, not something the founder asked to reorder. Any missing/unknown/duplicate entry
// falls back to the default relative order so a malformed preference never drops a segment.
function normalizeBreadcrumbOrder(value) {
  const seen = new Set();
  const order = (Array.isArray(value) ? value : []).filter((key) => BREADCRUMB_ORDER_KEYS.includes(key) && !seen.has(key) && seen.add(key));
  for (const key of BREADCRUMB_ORDER_KEYS) if (!order.includes(key)) order.push(key);
  return order;
}

// Same idea for the Tools-menu item order — any tool missing/unknown/duplicated in a stored
// preference falls back to appending it in the default (DEFAULT_ENABLED_TOOLS) order, so a
// malformed or stale preference (e.g. from before a new tool shipped) never hides a menu item.
function normalizeToolsMenuOrder(value) {
  const seen = new Set();
  const order = (Array.isArray(value) ? value : []).filter((key) => DEFAULT_ENABLED_TOOLS.includes(key) && !seen.has(key) && seen.add(key));
  for (const key of DEFAULT_ENABLED_TOOLS) if (!order.includes(key)) order.push(key);
  return order;
}

function normalizeKeyViewPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled === true,
    typingMode: source.typingMode === true,
    theme: source.theme === "light" ? "light" : "dark",
    position: KEY_VIEW_POSITIONS.has(source.position) ? source.position : "bottom-center",
    mouseEffects: source.mouseEffects !== false,
    keySize: KEY_VIEW_SIZES.has(source.keySize) ? source.keySize : "medium",
    mouseSize: KEY_VIEW_SIZES.has(source.mouseSize) ? source.mouseSize : "medium",
  };
}

function normalizeMacroStep(item) {
  if (!item || typeof item !== "object" || !MACRO_ACTIONS.has(item.action)) return null;
  const selector = text(item.selector, 1_000);
  if (selector && SENSITIVE_HINT.test(selector)) return null;
  const step = { action: item.action };
  if (selector) step.selector = selector;
  if (item.action === "fill" || item.action === "select" || item.action === "press") {
    const value = text(item.value, 2_000);
    if (SENSITIVE_HINT.test(value) && item.action !== "press") return null;
    step.value = value;
  }
  if (item.action === "check") step.checked = item.checked !== false;
  if (item.action === "wait") step.ms = Math.min(30_000, Math.max(0, Number(item.ms) || 500));
  if (item.action === "scroll") step.y = Math.min(100_000, Math.max(-100_000, Number(item.y) || 0));
  if (item.action === "multiClick") {
    step.count = Math.min(100, Math.max(2, Number(item.count) || 2));
    step.interval = Math.min(5_000, Math.max(0, Number(item.interval) || 100));
  }
  if (item.action === "fakerFill") step.scope = item.scope === "form" ? "form" : "page";
  return step;
}

function normalizeMacros(input) {
  return (Array.isArray(input) ? input : []).slice(0, 100).map((item, index) => ({
    id: id(item?.id, "macro", index),
    name: text(item?.name, 100) || `Macro ${index + 1}`,
    description: text(item?.description, 500),
    createdAt: text(item?.createdAt, 40) || new Date().toISOString(),
    updatedAt: text(item?.updatedAt, 40) || new Date().toISOString(),
    steps: (Array.isArray(item?.steps) ? item.steps : []).slice(0, 200).map(normalizeMacroStep).filter(Boolean),
  }));
}

function normalizeStepRecordingStep(item, index) {
  if (!item || typeof item !== "object") return null;
  const action = STEP_ACTIONS.has(item.action) ? item.action : "manual";
  const target = text(item.target ?? item.selector, 1_000);
  const sensitive = item.sensitive === true || SENSITIVE_HINT.test(target);
  return {
    id: id(item.id, "step", index),
    keyword: STEP_KEYWORDS.has(item.keyword) ? item.keyword : (index === 0 ? "given" : "and"),
    action,
    text: sensitive && action === "input" ? "[valor protegido]" : text(item.text, 2_000),
    expectedResult: text(item.expectedResult, 2_000),
    url: text(item.url, 2_048),
    createdAt: text(item.createdAt, 40) || new Date().toISOString(),
    ...(target ? { target } : {}),
    ...(sensitive ? { sensitive: true } : {}),
  };
}

function normalizeStepRecordings(input) {
  return (Array.isArray(input) ? input : []).slice(0, 100).map((item, index) => ({
    id: id(item?.id, "stepRecording", index),
    name: text(item?.name, 120) || `Roteiro ${index + 1}`,
    mode: item?.mode === "gherkin" ? "gherkin" : "numbered",
    locale: STEP_LOCALES.has(item?.locale) ? item.locale : "pt-BR",
    createdAt: text(item?.createdAt, 40) || new Date().toISOString(),
    updatedAt: text(item?.updatedAt, 40) || new Date().toISOString(),
    steps: (Array.isArray(item?.steps) ? item.steps : []).slice(0, 200)
      .map(normalizeStepRecordingStep).filter(Boolean),
  }));
}

export function normalizeWorkspace(rawWorkspace) {
  const source = rawWorkspace && typeof rawWorkspace === "object" ? rawWorkspace : {};
  const empty = createEmptyWorkspace();
  const clients = (Array.isArray(source.clients) ? source.clients : []).map((item, index) => ({
    id: id(item?.id, "client", index), name: text(item?.name ?? item?.label, 120) || `Cliente ${index + 1}`,
    ...entityAppearance(item),
  }));
  const projects = (Array.isArray(source.projects) ? source.projects : []).map((item, index) => ({
    id: id(item?.id, "project", index), clientId: id(item?.clientId ?? item?.client_id, "client", 0),
    name: text(item?.name ?? item?.label, 120) || `Projeto ${index + 1}`, ...entityAppearance(item),
  })).filter((item) => clients.some((client) => client.id === item.clientId));
  const products = (Array.isArray(source.products) ? source.products : []).map((item, index) => ({
    id: id(item?.id, "product", index), projectId: id(item?.projectId ?? item?.project_id, "project", 0),
    name: text(item?.name ?? item?.label, 120) || `Produto ${index + 1}`, ...entityAppearance(item),
  })).filter((item) => projects.some((project) => project.id === item.projectId));
  // Reusable tiers only (name + color) — no product/project/client reference. Which
  // product(s)/country(ies) an environment is actually deployed to lives entirely in
  // `urlBindings` now, so the same "DEV" environment can serve every country without being
  // duplicated per product (see `normalizeUrlBindings` below for why this changed).
  const environments = (Array.isArray(source.environments) ? source.environments : []).map((item, index) => ({
    id: id(item?.id, "env", index),
    name: text(item?.name ?? item?.label ?? item?.environment, 80) || `Ambiente ${index + 1}`,
    color: /^#[0-9a-f]{6}$/i.test(text(item?.color ?? item?.backgroundColor, 7)) ? text(item?.color ?? item?.backgroundColor, 7) : "#3a3a3a",
    active: item?.active !== false,
  }));
  const urlBindings = normalizeUrlBindings(source, products, environments);

  const copyCollection = (key) => (Array.isArray(source[key]) ? source[key] : []).map((item, index) => ({
    ...item, id: id(item?.id, key.replace(/s$/, ""), index), active: item?.active !== false,
  }));
  const preferences = source.preferences && typeof source.preferences === "object" ? source.preferences : {};
  const normalizedEnabledTools = Array.isArray(preferences.enabledTools)
    ? preferences.enabledTools.map((value) => text(value, 40)).filter((value) => DEFAULT_ENABLED_TOOLS.includes(value))
    : [...empty.preferences.enabledTools];
  if (Number(source.schemaVersion || 0) < 3) {
    for (const tool of SCHEMA_3_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
  }
  if (Number(source.schemaVersion || 0) < 4) {
    for (const tool of SCHEMA_4_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
  }
  if (Number(source.schemaVersion || 0) < 5) {
    for (const tool of SCHEMA_5_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
  }
  if (Number(source.schemaVersion || 0) < 6) {
    for (const tool of SCHEMA_6_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
  }
  if (Number(source.schemaVersion || 0) < 7) {
    for (const tool of SCHEMA_7_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
  }
  if (Number(source.schemaVersion || 0) < 8) {
    for (const tool of SCHEMA_8_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
  }
  if (Number(source.schemaVersion || 0) < 11) {
    for (const tool of SCHEMA_11_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
  }
  const workspace = {
    ...empty,
    schemaVersion: 11,
    updatedAt: text(source.updatedAt, 40) || empty.updatedAt,
    clients, projects, products, environments, urlBindings,
    testAccounts: (Array.isArray(source.testAccounts) ? source.testAccounts : [])
      .map((item, index) => normalizeTestAccount(item, index, environments, products)).filter(Boolean),
    paymentMethods: copyCollection("paymentMethods").map((item) => {
      const { environmentId, productId, product_id, ...rest } = item;
      return {
        ...rest,
        environmentIds: normalizeIdArray(item?.environmentIds, environmentId, environments),
        productIds: normalizeIdArray(item?.productIds, productId ?? product_id, products),
      };
    }),
    apis: copyCollection("apis"),
    inspectors: copyCollection("inspectors"),
    resources: copyCollection("resources").map((item) => ({ ...item, category: text(item?.category, 60) })),
    macros: normalizeMacros(source.macros),
    stepRecordings: normalizeStepRecordings(source.stepRecordings),
    preferences: {
      ...empty.preferences,
      ...preferences,
      compactMode: preferences.compactMode === true,
      compactEntities: {
        client: preferences.compactEntities?.client === true,
        project: preferences.compactEntities?.project === true || (!preferences.compactEntities && preferences.compactMode === true),
        product: preferences.compactEntities?.product === true || (!preferences.compactEntities && preferences.compactMode === true),
      },
      pushSiteContent: preferences.pushSiteContent !== false,
      avatarShape: preferences.avatarShape === "round" ? "round" : "square",
      appearanceTheme: ["light", "dark"].includes(preferences.appearanceTheme) ? preferences.appearanceTheme : empty.preferences.appearanceTheme,
      pinnedTools: Array.isArray(preferences.pinnedTools)
        ? [...new Set(preferences.pinnedTools.map((value) => text(value, 40)).map((value) => ({ blurMode: "blurElements", holofoteMode: "holofote" })[value] || value).filter((value) => PINNABLE_TOOLS.has(value)))].slice(0, 4)
        : empty.preferences.pinnedTools,
      pinnedMacroIds: Array.isArray(preferences.pinnedMacroIds) ? preferences.pinnedMacroIds.map((value) => text(value, 120)).filter(Boolean).slice(0, 20) : [],
      enabledTools: normalizedEnabledTools,
      toolsMenuOrder: normalizeToolsMenuOrder(preferences.toolsMenuOrder),
      soundEffects: preferences.soundEffects !== false,
      remindTestStatusOnRecording: preferences.remindTestStatusOnRecording === true,
      breadcrumbVisibility: {
        client: preferences.breadcrumbVisibility?.client !== false,
        project: preferences.breadcrumbVisibility?.project !== false,
        product: preferences.breadcrumbVisibility?.product !== false,
        environment: preferences.breadcrumbVisibility?.environment !== false,
      },
      breadcrumbOrder: normalizeBreadcrumbOrder(preferences.breadcrumbOrder),
      keyView: normalizeKeyViewPreferences(preferences.keyView),
    },
  };
  for (const key of COLLECTION_KEYS) workspace[key] = Array.isArray(workspace[key]) ? workspace[key] : [];
  return workspace;
}

export function createDefaultSiteScope() {
  return { mode: "environments", patterns: [] };
}

export async function getWorkspace() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.workspace);
  return normalizeWorkspace(stored[STORAGE_KEYS.workspace]);
}

export async function saveWorkspace(workspace) {
  const next = normalizeWorkspace({ ...workspace, updatedAt: new Date().toISOString() });
  await chrome.storage.local.set({ [STORAGE_KEYS.workspace]: next });
  return next;
}

export async function getSiteScope() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.siteScope);
  const scope = stored[STORAGE_KEYS.siteScope];
  if (!scope || typeof scope !== "object") return createDefaultSiteScope();
  return { mode: scope.mode === "custom" ? "custom" : "environments", patterns: normalizeUrlPatterns(scope.patterns) };
}

export async function saveSiteScope(scope) {
  const next = { mode: scope?.mode === "custom" ? "custom" : "environments", patterns: normalizeUrlPatterns(scope?.patterns) };
  await chrome.storage.local.set({ [STORAGE_KEYS.siteScope]: next });
  return next;
}

export function onStorageChanged(callback) {
  const listener = (changes, areaName) => {
    if (areaName === "local") callback(changes);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
