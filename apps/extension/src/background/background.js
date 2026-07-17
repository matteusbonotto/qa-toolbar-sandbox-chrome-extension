import { getSiteScope, onStorageChanged, STORAGE_KEYS } from "../lib/storage.js";

const TOOLBAR_SCRIPT_ID = "qts-toolbar";
const PAGEBRIDGE_SCRIPT_ID = "qts-pagebridge";

function patternsForScope(scope) {
  if (scope.mode === "custom" && Array.isArray(scope.patterns) && scope.patterns.length) {
    return scope.patterns;
  }
  // "all" (the default) and any invalid/empty custom scope fail open to
  // everywhere rather than fail closed to nowhere, matching the requested
  // "starts on any site, restrict later from settings" behavior.
  return ["<all_urls>"];
}

async function applyContentScriptRegistration() {
  const scope = await getSiteScope();
  const matches = patternsForScope(scope);

  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [TOOLBAR_SCRIPT_ID, PAGEBRIDGE_SCRIPT_ID],
  });
  if (existing.length) {
    await chrome.scripting.unregisterContentScripts({
      ids: existing.map((script) => script.id),
    });
  }

  await chrome.scripting.registerContentScripts([
    {
      id: PAGEBRIDGE_SCRIPT_ID,
      matches,
      js: ["src/pagebridge/pagebridge.js"],
      world: "MAIN",
      runAt: "document_start",
      allFrames: false,
    },
    {
      id: TOOLBAR_SCRIPT_ID,
      matches,
      js: ["src/lib/storage-content.js", "src/lib/i18n-content.js", "src/lib/avatar-content.js", "src/toolbar/toolbar.js"],
      css: ["src/toolbar/toolbar.css"],
      runAt: "document_idle",
      allFrames: false,
    },
  ]);

  await injectIntoOpenTabs(matches);
}

function patternToRegExp(pattern) {
  if (pattern === "<all_urls>") return /^https?:\/\//i;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Dynamic content script registration only applies to future navigations —
 * a tab already open at install time (or right when the site-scope setting
 * changes) would otherwise need a manual reload before the toolbar shows up.
 * Proactively injecting into already-open matching tabs closes that gap.
 */
async function injectIntoOpenTabs(matches) {
  const patterns = matches.map(patternToRegExp);
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id || !tab.url || !patterns.some((pattern) => pattern.test(tab.url))) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["src/pagebridge/pagebridge.js"] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["src/toolbar/toolbar.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/lib/storage-content.js", "src/lib/i18n-content.js", "src/lib/avatar-content.js", "src/toolbar/toolbar.js"] });
    } catch {
      // Restricted pages (chrome://, the Web Store, etc.) reject injection — expected, not an error.
    }
  }));
}

chrome.runtime.onInstalled.addListener(() => {
  void applyContentScriptRegistration();
});
chrome.runtime.onStartup.addListener(() => {
  void applyContentScriptRegistration();
});

onStorageChanged((changes) => {
  if (changes[STORAGE_KEYS.siteScope]) void applyContentScriptRegistration();
});

// Privileged actions the isolated-world toolbar cannot do for itself.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "qts:capture-visible-tab") {
    chrome.tabs.captureVisibleTab({ format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "qts:open-options") {
    chrome.runtime.openOptionsPage();
    return undefined;
  }

  return undefined;
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
