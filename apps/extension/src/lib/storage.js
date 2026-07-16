// ES-module storage helpers for the background service worker only (it's
// the one context allowed "type": "module" in the manifest). The options
// page and toolbar/pagebridge content scripts use the classic-script twin
// of this file, src/lib/storage-content.js, since dynamically registered
// content scripts don't support top-level import/export. Keep the two in
// sync by hand when the workspace shape changes.
//
// chrome.storage.local is the only durable store here — it is
// extension-scoped, unlike page localStorage, which is isolated per site
// and would not let the workspace follow the user across different sites.

export const STORAGE_KEYS = Object.freeze({
  workspace: "qtsWorkspaceV1",
  siteScope: "qtsSiteScopeV1",
  uiState: "qtsUiStateV1",
});

export function createEmptyWorkspace() {
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

export function createDefaultSiteScope() {
  // Default: the toolbar is available everywhere. The user narrows this from
  // the options page — the extension never silently restricts itself.
  return { mode: "all", patterns: [] };
}

export async function getWorkspace() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.workspace);
  const workspace = stored[STORAGE_KEYS.workspace];
  return workspace && typeof workspace === "object" ? workspace : createEmptyWorkspace();
}

export async function saveWorkspace(workspace) {
  const next = { ...workspace, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STORAGE_KEYS.workspace]: next });
  return next;
}

export async function getSiteScope() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.siteScope);
  const scope = stored[STORAGE_KEYS.siteScope];
  return scope && typeof scope === "object" ? scope : createDefaultSiteScope();
}

export async function saveSiteScope(scope) {
  await chrome.storage.local.set({ [STORAGE_KEYS.siteScope]: scope });
  return scope;
}

export function onStorageChanged(callback) {
  const listener = (changes, areaName) => {
    if (areaName !== "local") return;
    callback(changes);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
