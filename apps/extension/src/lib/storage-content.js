// Classic (non-module) script shared by isolated-world content scripts.
// MV3 content scripts registered via chrome.scripting.registerContentScripts
// do not support top-level ES `import`/`export` — every file listed in a
// registration's `js` array runs as a classic script sharing one global
// scope, in order, which is what this namespace relies on.
(() => {
  const STORAGE_KEYS = Object.freeze({
    workspace: "qtsWorkspaceV1",
    siteScope: "qtsSiteScopeV1",
    uiState: "qtsUiStateV1",
  });

  function createEmptyWorkspace() {
    return {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      clients: [],
      projects: [],
      products: [],
      environments: [],
      testAccounts: [],
      paymentMethods: [],
      apis: [],
      inspectors: [],
      resources: [],
      preferences: {
        language: "pt-BR",
        pushSiteContent: true,
        pinnedTools: ["passFail", "screenshot", "notes"],
      },
    };
  }

  function createDefaultSiteScope() {
    return { mode: "all", patterns: [] };
  }

  async function getSiteScope() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.siteScope);
    const scope = stored[STORAGE_KEYS.siteScope];
    return scope && typeof scope === "object" ? scope : createDefaultSiteScope();
  }

  async function saveSiteScope(scope) {
    await chrome.storage.local.set({ [STORAGE_KEYS.siteScope]: scope });
    return scope;
  }

  async function getWorkspace() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.workspace);
    const workspace = stored[STORAGE_KEYS.workspace];
    return workspace && typeof workspace === "object" ? workspace : createEmptyWorkspace();
  }

  async function saveWorkspace(workspace) {
    const next = { ...workspace, updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [STORAGE_KEYS.workspace]: next });
    return next;
  }

  function onStorageChanged(callback) {
    const listener = (changes, areaName) => {
      if (areaName !== "local") return;
      callback(changes);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  window.QTS_STORAGE = Object.freeze({
    STORAGE_KEYS,
    createEmptyWorkspace,
    getWorkspace,
    saveWorkspace,
    createDefaultSiteScope,
    getSiteScope,
    saveSiteScope,
    onStorageChanged,
  });
})();
