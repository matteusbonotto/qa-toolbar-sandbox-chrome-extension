// Classic-script storage/normalization twin used by options and content pages.
(() => {
  const STORAGE_KEYS = Object.freeze({ workspace: "qtsWorkspaceV1", siteScope: "qtsSiteScopeV1", uiState: "qtsUiStateV1", authSession: "qtsAuthSessionV1", accessStatus: "qtsAccessStatusV1" });
  const DEFAULT_ENABLED_TOOLS = Object.freeze(["clickSpy", "freezeClock", "forceHttp", "inspectors", "jsonStudio", "breakpoints", "testAccounts", "paymentMethods", "resources"]);
  const text = (value, maximum = 500) => String(value ?? "").trim().slice(0, maximum);
  const id = (value, prefix, index) => text(value, 120).replace(/[^a-z0-9_-]/gi, "_") || `${prefix}_${index + 1}`;
  const appearance = (item) => {
    const logoUrl = text(item?.logoUrl ?? item?.logo ?? item?.imageUrl, 2048);
    const abbreviation = text(item?.abbreviation ?? item?.shortName ?? item?.code, 4).toUpperCase();
    return { ...(logoUrl ? { logoUrl } : {}), ...(abbreviation ? { abbreviation } : {}), showLabel: item?.showLabel !== false, active: item?.active !== false };
  };
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
    return { schemaVersion: 2, updatedAt: new Date().toISOString(), clients: [], projects: [], products: [], environments: [], testAccounts: [], paymentMethods: [], apis: [], inspectors: [], resources: [], preferences: { language: "pt-BR", pushSiteContent: true, compactMode: false, pinnedTools: ["passFail", "screenshot", "notes", "record"], enabledTools: [...DEFAULT_ENABLED_TOOLS] } };
  }
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
      return { id: id(item?.id, "env", index), productId, projectId: project?.id ?? null, clientId: project?.clientId ?? null, name: text(item?.name ?? item?.label ?? item?.environment, 80) || `Ambiente ${index + 1}`, color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#3a3a3a", urlPatterns: normalizeUrlPatterns(item?.urlPatterns ?? item?.urls ?? item?.domains ?? item?.url ?? item?.baseUrl), active: item?.active !== false };
    }).filter((item) => products.some((product) => product.id === item.productId));
    const copy = (key) => (Array.isArray(source[key]) ? source[key] : []).map((item, index) => ({ ...item, id: id(item?.id, key.replace(/s$/, ""), index), active: item?.active !== false }));
    const preferences = source.preferences && typeof source.preferences === "object" ? source.preferences : {};
    return { ...empty, schemaVersion: 2, updatedAt: text(source.updatedAt, 40) || empty.updatedAt, clients, projects, products, environments, testAccounts: copy("testAccounts").filter((item) => environments.some((environment) => environment.id === item.environmentId)), paymentMethods: copy("paymentMethods").map((item) => ({ ...item, environmentId: environments.some((environment) => environment.id === item.environmentId) ? item.environmentId : null })), apis: copy("apis"), inspectors: copy("inspectors"), resources: copy("resources"), preferences: { ...empty.preferences, ...preferences, compactMode: preferences.compactMode === true, pushSiteContent: preferences.pushSiteContent !== false, pinnedTools: Array.isArray(preferences.pinnedTools) ? preferences.pinnedTools.map((value) => text(value, 40)).filter(Boolean) : empty.preferences.pinnedTools, enabledTools: Array.isArray(preferences.enabledTools) ? preferences.enabledTools.map((value) => text(value, 40)).filter((value) => DEFAULT_ENABLED_TOOLS.includes(value)) : empty.preferences.enabledTools } };
  }
  const createDefaultSiteScope = () => ({ mode: "environments", patterns: [] });
  async function getWorkspace() { const stored = await chrome.storage.local.get(STORAGE_KEYS.workspace); return normalizeWorkspace(stored[STORAGE_KEYS.workspace]); }
  async function saveWorkspace(workspace) { const next = normalizeWorkspace({ ...workspace, updatedAt: new Date().toISOString() }); await chrome.storage.local.set({ [STORAGE_KEYS.workspace]: next }); return next; }
  async function getSiteScope() { const stored = await chrome.storage.local.get(STORAGE_KEYS.siteScope); const scope = stored[STORAGE_KEYS.siteScope]; return scope && typeof scope === "object" ? { mode: scope.mode === "custom" ? "custom" : "environments", patterns: normalizeUrlPatterns(scope.patterns) } : createDefaultSiteScope(); }
  async function saveSiteScope(scope) { const next = { mode: scope?.mode === "custom" ? "custom" : "environments", patterns: normalizeUrlPatterns(scope?.patterns) }; await chrome.storage.local.set({ [STORAGE_KEYS.siteScope]: next }); return next; }
  function onStorageChanged(callback) { const listener = (changes, areaName) => { if (areaName === "local") callback(changes); }; chrome.storage.onChanged.addListener(listener); return () => chrome.storage.onChanged.removeListener(listener); }
  window.QTS_STORAGE = Object.freeze({ STORAGE_KEYS, DEFAULT_ENABLED_TOOLS, createEmptyWorkspace, normalizeWorkspace, normalizeUrlPatterns, getWorkspace, saveWorkspace, createDefaultSiteScope, getSiteScope, saveSiteScope, onStorageChanged });
})();
