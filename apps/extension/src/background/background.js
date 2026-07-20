import { getSiteScope, getWorkspace, onStorageChanged, STORAGE_KEYS } from "../lib/storage.js";
import { acceptSessionHandoff, deleteAccount, getAccessState, requestPasswordReset, signIn, signOut } from "./auth.js";

const TOOLBAR_SCRIPT_ID = "qts-toolbar";
const PAGEBRIDGE_SCRIPT_ID = "qts-pagebridge";
const LANDING_ORIGINS = new Set([
  "https://matteusbonotto.github.io",
  "http://localhost:5173",
]);

function isChromeMatchPattern(pattern) {
  return /^(?:\*|https?|file|ftp):\/\/(?:\*|\*\.[^/*]+|[^/*]+)\/.*$/i.test(String(pattern ?? ""));
}

async function patternsForAuthorizedWorkspace() {
  const scope = await getSiteScope();
  if (scope.mode === "custom") return (scope.patterns || []).filter(isChromeMatchPattern);
  const workspace = await getWorkspace();
  return [...new Set((workspace.urlBindings || [])
    .filter((binding) => binding.active !== false)
    .map((binding) => binding.pattern)
    .filter(isChromeMatchPattern))];
}

async function isAuthorizedContentSender(sender) {
  if (!sender?.tab?.id || !sender.tab.url) return false;
  const [registrationPatterns, workspace] = await Promise.all([patternsForAuthorizedWorkspace(), getWorkspace()]);
  const matches = (patterns) => patterns.some((pattern) => {
    try { return patternToRegExp(pattern).test(sender.tab.url); } catch { return false; }
  });
  const bindingPatterns = (workspace.urlBindings || [])
    .filter((binding) => binding.active !== false)
    .map((binding) => binding.pattern)
    .filter(isChromeMatchPattern);
  return matches(registrationPatterns) && matches(bindingPatterns);
}

function patternToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

async function unregisterContentScripts() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [TOOLBAR_SCRIPT_ID, PAGEBRIDGE_SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
}

async function removeToolbarFromOpenTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try { await chrome.tabs.sendMessage(tab.id, { type: "qts:remove-toolbar" }); } catch {}
  }));
}

async function applyContentScriptRegistration({ forceAccess = false } = {}) {
  await unregisterContentScripts();
  const access = await getAccessState({ force: forceAccess });
  if (!access.active) {
    await removeToolbarFromOpenTabs();
    return;
  }

  const matches = await patternsForAuthorizedWorkspace();
  if (!matches.length) {
    await removeToolbarFromOpenTabs();
    return;
  }
  await chrome.scripting.registerContentScripts([
    { id: PAGEBRIDGE_SCRIPT_ID, matches, js: ["src/pagebridge/pagebridge.js"], world: "MAIN", runAt: "document_start", allFrames: false },
    // allFrames:true so the bar also renders inside the Breakpoint Viewer's own device-preview
    // iframes (same-origin, matching these same URL patterns) — boot()'s tiny-frame guard in
    // toolbar.js keeps this from mounting in incidental small embedded widgets on normal pages.
    { id: TOOLBAR_SCRIPT_ID, matches, js: ["src/lib/storage-content.js", "src/lib/i18n-content.js", "src/lib/avatar-content.js", "src/lib/icons-content.js", "src/lib/qa-tools-content.js", "src/toolbar/toolbar.js"], css: ["src/toolbar/toolbar.css"], runAt: "document_idle", allFrames: true },
  ]);
  await injectIntoOpenTabs(matches);
}

async function injectIntoOpenTabs(matches) {
  const patterns = matches.map(patternToRegExp);
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id || !tab.url || !patterns.some((pattern) => pattern.test(tab.url))) return;
    try {
      const existing = await chrome.tabs.sendMessage(tab.id, { type: "qts:sync-toolbar" }).catch(() => null);
      if (existing?.present) return;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["src/pagebridge/pagebridge.js"] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["src/toolbar/toolbar.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/lib/storage-content.js", "src/lib/i18n-content.js", "src/lib/avatar-content.js", "src/lib/icons-content.js", "src/lib/qa-tools-content.js", "src/toolbar/toolbar.js"] });
    } catch {}
  }));
}

chrome.runtime.onInstalled.addListener(() => { void applyContentScriptRegistration({ forceAccess: true }); });
chrome.runtime.onStartup.addListener(() => { void applyContentScriptRegistration({ forceAccess: true }); });

onStorageChanged((changes) => {
  if (changes[STORAGE_KEYS.workspace] || changes[STORAGE_KEYS.siteScope]) void applyContentScriptRegistration();
});

function isOwnOptionsPage(sender) {
  return sender?.id === chrome.runtime.id && sender?.url === chrome.runtime.getURL("src/options/options.html");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || sender.id !== chrome.runtime.id) return undefined;
  if (message.type === "qts:get-access-state") {
    getAccessState({ force: message.force === true }).then(sendResponse);
    return true;
  }
  if (message.type === "qts:macro-run") {
    getAccessState().then(async (access) => {
      // Only our registered content script has a sender.tab. It is already
      // scoped to authorized environment patterns by the dynamic registration.
      if (!access.active || !sender.tab?.id) return sendResponse({ ok: false, error: "authentication_required" });
      const key = `qtsMacroRunTab${sender.tab.id}`;
      if (message.operation === "get") {
        const stored = await chrome.storage.session.get(key);
        return sendResponse({ ok: true, run: stored[key] || null });
      }
      if (message.operation === "clear") {
        await chrome.storage.session.remove(key);
        return sendResponse({ ok: true });
      }
      if (message.operation === "set" && message.run && typeof message.run === "object") {
        const run = { macroId: String(message.run.macroId || "").slice(0, 120), index: Math.max(0, Math.min(200, Number(message.run.index) || 0)), expiresAt: Math.min(Date.now() + 10 * 60_000, Number(message.run.expiresAt) || 0) };
        if (!run.macroId || run.expiresAt <= Date.now()) return sendResponse({ ok: false, error: "invalid_macro_run" });
        await chrome.storage.session.set({ [key]: run });
        return sendResponse({ ok: true });
      }
      return sendResponse({ ok: false, error: "invalid_operation" });
    }).catch(() => sendResponse({ ok: false, error: "macro_run_failed" }));
    return true;
  }
  if (message.type === "qts:auth-sign-in" && isOwnOptionsPage(sender)) {
    signIn(message.email, message.password)
      .then(() => getAccessState({ force: true }))
      .then(async (access) => { if (access.active) await applyContentScriptRegistration(); sendResponse({ ok: access.active, access }); })
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || "authentication_failed") }));
    return true;
  }
  if (message.type === "qts:auth-recover-password" && isOwnOptionsPage(sender)) {
    requestPasswordReset(message.email)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || "recover_failed") }));
    return true;
  }
  if (message.type === "qts:auth-sign-out" && isOwnOptionsPage(sender)) {
    signOut().then(async () => { await unregisterContentScripts(); await removeToolbarFromOpenTabs(); sendResponse({ ok: true }); });
    return true;
  }
  if (message.type === "qts:account-delete" && isOwnOptionsPage(sender)) {
    deleteAccount(message.password)
      .then(async () => { await unregisterContentScripts(); await removeToolbarFromOpenTabs(); sendResponse({ ok: true }); })
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || "account_delete_failed"), status: error?.status }));
    return true;
  }
  if (message.type === "qts:capture-visible-tab") {
    Promise.all([getAccessState(), isAuthorizedContentSender(sender)]).then(([access, authorizedSender]) => {
      if (!access.active || !authorizedSender) return sendResponse({ ok: false, error: "authentication_required" });
      return chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" })
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    });
    return true;
  }
  if (message.type === "qts:open-options") {
    chrome.runtime.openOptionsPage();
    return undefined;
  }
  return undefined;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  let origin = "";
  try { origin = new URL(sender.url || "").origin; } catch {}
  if (!LANDING_ORIGINS.has(origin) || message?.type !== "qts:landing-session-handoff") return undefined;
  acceptSessionHandoff(message.session)
    .then(() => getAccessState({ force: true }))
    .then(async (access) => { if (access.active) await applyContentScriptRegistration(); sendResponse({ accepted: access.active }); })
    .catch(() => sendResponse({ accepted: false }));
  return true;
});

chrome.action.onClicked.addListener(() => { chrome.runtime.openOptionsPage(); });
