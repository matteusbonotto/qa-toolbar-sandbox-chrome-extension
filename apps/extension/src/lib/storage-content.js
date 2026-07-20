// Classic-script storage/normalization twin used by options and content pages.
(() => {
  const STORAGE_KEYS = Object.freeze({ workspace: "qtsWorkspaceV1", siteScope: "qtsSiteScopeV1", uiState: "qtsUiStateV1", authSession: "qtsAuthSessionV1", accessStatus: "qtsAccessStatusV1" });
  const DEFAULT_ENABLED_TOOLS = Object.freeze(["clickSpy", "freezeClock", "forceHttp", "errorMonitor", "inspectors", "jsonStudio", "breakpoints", "testAccounts", "paymentMethods", "resources", "characterCounter", "macroStudio", "multiClick", "inputLab", "fakerFill", "keyView"]);
  const SCHEMA_3_TOOLS = ["characterCounter", "macroStudio", "multiClick", "inputLab", "fakerFill"];
  const SCHEMA_4_TOOLS = ["keyView"];
  const SCHEMA_5_TOOLS = ["errorMonitor"];
  const KEY_VIEW_POSITIONS = new Set(["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"]);
  const MACRO_ACTIONS = new Set(["click", "fill", "select", "check", "press", "wait", "scroll", "multiClick", "fakerFill"]);
  const SENSITIVE_HINT = /(?:passw(?:or)?d|senha|secret|token|authorization|auth[_-]?key|api[_-]?key|card|cart[aã]o|credit|debit|cc(?:num|number)?|cvv|cvc|security[_-]?code)/i;
  const text = (value, maximum = 500) => String(value ?? "").trim().slice(0, maximum);
  const id = (value, prefix, index) => text(value, 120).replace(/[^a-z0-9_-]/gi, "_") || `${prefix}_${index + 1}`;
  const IMAGE_VALUE_MAX_CHARS = 300000;
  const appearance = (item) => {
    const logoUrl = text(item?.logoUrl ?? item?.logo ?? item?.imageUrl, IMAGE_VALUE_MAX_CHARS);
    const abbreviation = text(item?.abbreviation ?? item?.shortName ?? item?.code, 4).toUpperCase();
    return { ...(logoUrl ? { logoUrl } : {}), ...(abbreviation ? { abbreviation } : {}), showLabel: item?.showLabel !== false, active: item?.active !== false };
  };
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
  function normalizeTestAccount(item, index, environments) {
    const environmentId = id(item?.environmentId, "env", 0);
    if (!environments.some((environment) => environment.id === environmentId)) return null;
    return {
      id: id(item?.id, "testAccount", index), environmentId,
      label: text(item?.label, 120) || `Conta ${index + 1}`,
      accountType: text(item?.accountType, 60),
      accountTypeImage: text(item?.accountTypeImage, IMAGE_VALUE_MAX_CHARS),
      username: text(item?.username, 200), password: text(item?.password, 200), notes: text(item?.notes, 1000),
      customFields: normalizeCustomFields(item?.customFields), active: item?.active !== false,
    };
  }
  function normalizeUrlPatterns(input) {
    const values = Array.isArray(input) ? input : String(input ?? "").split(/[\n,]/);
    const output = [];
    for (const raw of values.flat(3)) {
      let value = text(raw, 2048);
      if (!value) continue;
      if (!value.includes("://") && !value.startsWith("*")) value = `*://${value.replace(/^\/+/, "")}`;
      if (!value.includes("*")) {
        try {
          const url = new URL(value); url.hash = ""; url.search = "";
          value = url.pathname === "/" ? `${url.origin}/*` : `${url.href.replace(/\/$/, "")}*`;
        } catch {}
      } else if (/^(?:[a-z]+|\*):\/\/[^/]+$/i.test(value)) value += "/*";
      if (!output.includes(value)) output.push(value);
    }
    return output.slice(0, 100);
  }
  function createEmptyWorkspace() {
    return { schemaVersion: 5, updatedAt: new Date().toISOString(), clients: [], projects: [], products: [], environments: [], testAccounts: [], paymentMethods: [], apis: [], inspectors: [], resources: [], macros: [], preferences: { language: "pt-BR", pushSiteContent: true, compactMode: false, avatarShape: "square", pinnedTools: ["passFail", "screenshot", "notes", "record"], pinnedMacroIds: [], enabledTools: [...DEFAULT_ENABLED_TOOLS], soundEffects: true, breadcrumbVisibility: { client: true, project: true, product: true, environment: true }, keyView: { enabled: false, typingMode: false, theme: "dark", position: "bottom-center", mouseEffects: true } } };
  }
  function normalizeKeyView(value) {
    const source = value && typeof value === "object" ? value : {};
    return { enabled: source.enabled === true, typingMode: source.typingMode === true, theme: source.theme === "light" ? "light" : "dark", position: KEY_VIEW_POSITIONS.has(source.position) ? source.position : "bottom-center", mouseEffects: source.mouseEffects !== false };
  }
  function normalizeStep(item) {
    if (!item || typeof item !== "object" || !MACRO_ACTIONS.has(item.action)) return null;
    const selector = text(item.selector, 1000);
    if (selector && SENSITIVE_HINT.test(selector)) return null;
    const step = { action: item.action };
    if (selector) step.selector = selector;
    if (["fill", "select", "press"].includes(item.action)) { const value = text(item.value, 2000); if (SENSITIVE_HINT.test(value) && item.action !== "press") return null; step.value = value; }
    if (item.action === "check") step.checked = item.checked !== false;
    if (item.action === "wait") step.ms = Math.min(30000, Math.max(0, Number(item.ms) || 500));
    if (item.action === "scroll") step.y = Math.min(100000, Math.max(-100000, Number(item.y) || 0));
    if (item.action === "multiClick") { step.count = Math.min(100, Math.max(2, Number(item.count) || 2)); step.interval = Math.min(5000, Math.max(0, Number(item.interval) || 100)); }
    if (item.action === "fakerFill") step.scope = item.scope === "form" ? "form" : "page";
    return step;
  }
  function normalizeMacros(input) { return (Array.isArray(input) ? input : []).slice(0, 100).map((item, index) => ({ id: id(item?.id, "macro", index), name: text(item?.name, 100) || `Macro ${index + 1}`, description: text(item?.description, 500), createdAt: text(item?.createdAt, 40) || new Date().toISOString(), updatedAt: text(item?.updatedAt, 40) || new Date().toISOString(), steps: (Array.isArray(item?.steps) ? item.steps : []).slice(0, 200).map(normalizeStep).filter(Boolean) })); }
  function normalizeWorkspace(rawWorkspace) {
    const source = rawWorkspace && typeof rawWorkspace === "object" ? rawWorkspace : {};
    const empty = createEmptyWorkspace();
    const clients = (Array.isArray(source.clients) ? source.clients : []).map((item, index) => ({ id: id(item?.id, "client", index), name: text(item?.name ?? item?.label, 120) || `Cliente ${index + 1}`, ...appearance(item) }));
    const projects = (Array.isArray(source.projects) ? source.projects : []).map((item, index) => ({ id: id(item?.id, "project", index), clientId: id(item?.clientId ?? item?.client_id, "client", 0), name: text(item?.name ?? item?.label, 120) || `Projeto ${index + 1}`, ...appearance(item) })).filter((item) => clients.some((client) => client.id === item.clientId));
    const products = (Array.isArray(source.products) ? source.products : []).map((item, index) => ({ id: id(item?.id, "product", index), projectId: id(item?.projectId ?? item?.project_id, "project", 0), name: text(item?.name ?? item?.label, 120) || `Produto ${index + 1}`, ...appearance(item) })).filter((item) => projects.some((project) => project.id === item.projectId));
    const environments = (Array.isArray(source.environments) ? source.environments : []).map((item, index) => {
      const productId = id(item?.productId ?? item?.product_id, "product", 0);
      const product = products.find((candidate) => candidate.id === productId);
      const project = projects.find((candidate) => candidate.id === product?.projectId);
      const rawColor = text(item?.color ?? item?.backgroundColor, 7);
      return { id: id(item?.id, "env", index), productId, projectId: project?.id ?? null, clientId: project?.clientId ?? null, name: text(item?.name ?? item?.label ?? item?.environment, 80) || `Ambiente ${index + 1}`, color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#3a3a3a", urlPatterns: normalizeUrlPatterns(item?.urlPatterns ?? item?.urls ?? item?.domains ?? item?.url ?? item?.baseUrl), primaryUrl: /^https?:\/\//i.test(text(item?.primaryUrl, 2048)) ? text(item?.primaryUrl, 2048) : "", active: item?.active !== false };
    }).filter((item) => products.some((product) => product.id === item.productId));
    const copy = (key) => (Array.isArray(source[key]) ? source[key] : []).map((item, index) => ({ ...item, id: id(item?.id, key.replace(/s$/, ""), index), active: item?.active !== false }));
    const preferences = source.preferences && typeof source.preferences === "object" ? source.preferences : {};
    const normalizedEnabledTools = Array.isArray(preferences.enabledTools) ? preferences.enabledTools.map((value) => text(value, 40)).filter((value) => DEFAULT_ENABLED_TOOLS.includes(value)) : [...empty.preferences.enabledTools];
    if (Number(source.schemaVersion || 0) < 3) for (const tool of SCHEMA_3_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 4) for (const tool of SCHEMA_4_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 5) for (const tool of SCHEMA_5_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    return { ...empty, schemaVersion: 5, updatedAt: text(source.updatedAt, 40) || empty.updatedAt, clients, projects, products, environments, testAccounts: (Array.isArray(source.testAccounts) ? source.testAccounts : []).map((item, index) => normalizeTestAccount(item, index, environments)).filter(Boolean), paymentMethods: copy("paymentMethods").map((item) => ({ ...item, environmentId: environments.some((environment) => environment.id === item.environmentId) ? item.environmentId : null })), apis: copy("apis"), inspectors: copy("inspectors"), resources: copy("resources").map((item) => ({ ...item, category: text(item?.category, 60) })), macros: normalizeMacros(source.macros), preferences: { ...empty.preferences, ...preferences, compactMode: preferences.compactMode === true, pushSiteContent: preferences.pushSiteContent !== false, avatarShape: preferences.avatarShape === "round" ? "round" : "square", pinnedTools: Array.isArray(preferences.pinnedTools) ? preferences.pinnedTools.map((value) => text(value, 40)).filter(Boolean) : empty.preferences.pinnedTools, pinnedMacroIds: Array.isArray(preferences.pinnedMacroIds) ? preferences.pinnedMacroIds.map((value) => text(value, 120)).filter(Boolean).slice(0, 20) : [], enabledTools: normalizedEnabledTools, soundEffects: preferences.soundEffects !== false, breadcrumbVisibility: { client: preferences.breadcrumbVisibility?.client !== false, project: preferences.breadcrumbVisibility?.project !== false, product: preferences.breadcrumbVisibility?.product !== false, environment: preferences.breadcrumbVisibility?.environment !== false }, keyView: normalizeKeyView(preferences.keyView) } };
  }
  const createDefaultSiteScope = () => ({ mode: "environments", patterns: [] });
  async function getWorkspace() { const stored = await chrome.storage.local.get(STORAGE_KEYS.workspace); return normalizeWorkspace(stored[STORAGE_KEYS.workspace]); }
  async function saveWorkspace(workspace) { const next = normalizeWorkspace({ ...workspace, updatedAt: new Date().toISOString() }); await chrome.storage.local.set({ [STORAGE_KEYS.workspace]: next }); return next; }
  async function getSiteScope() { const stored = await chrome.storage.local.get(STORAGE_KEYS.siteScope); const scope = stored[STORAGE_KEYS.siteScope]; return scope && typeof scope === "object" ? { mode: scope.mode === "custom" ? "custom" : "environments", patterns: normalizeUrlPatterns(scope.patterns) } : createDefaultSiteScope(); }
  async function saveSiteScope(scope) { const next = { mode: scope?.mode === "custom" ? "custom" : "environments", patterns: normalizeUrlPatterns(scope?.patterns) }; await chrome.storage.local.set({ [STORAGE_KEYS.siteScope]: next }); return next; }
  function onStorageChanged(callback) { const listener = (changes, areaName) => { if (areaName === "local") callback(changes); }; chrome.storage.onChanged.addListener(listener); return () => chrome.storage.onChanged.removeListener(listener); }
  window.QTS_STORAGE = Object.freeze({ STORAGE_KEYS, DEFAULT_ENABLED_TOOLS, createEmptyWorkspace, normalizeWorkspace, normalizeUrlPatterns, getWorkspace, saveWorkspace, createDefaultSiteScope, getSiteScope, saveSiteScope, onStorageChanged });
})();
