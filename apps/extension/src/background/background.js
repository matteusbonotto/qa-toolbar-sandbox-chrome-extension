import { getSiteScope, getWorkspace, saveWorkspace, onStorageChanged, STORAGE_KEYS } from "../lib/storage.js";
import { acceptSessionHandoff, deleteAccount, getAccessState, redeemVoucher, requestPasswordReset, signIn, signOut } from "./auth.js";

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
    .flatMap((binding) => binding.patterns || [])
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
    .flatMap((binding) => binding.patterns || [])
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

// Founder-reported bug, confirmed by reading the code: getAccessState() returns `active: false`
// for ANY failed access-status call, not just a genuine "subscription lapsed" — including a plain
// network hiccup or a cold Supabase function, which is exactly the least reliable moment for a
// network call (right as chrome.runtime.onInstalled/onStartup fires after an update or browser
// restart). Treating that the same as "access really ended" used to unregister the content
// scripts and rip the toolbar out of every open tab, with nothing to bring it back except another
// update or restart — no retry, no explanation to whoever was mid-test. A transient failure
// (reason: "access_unavailable") now falls back to the last confirmed status instead of assuming
// the worst, and schedules a retry via chrome.alarms (survives the service worker going idle,
// unlike a plain setTimeout) so a genuine lapse still gets caught shortly after.
const ACCESS_RETRY_ALARM = "qts-access-retry";

async function applyContentScriptRegistration({ forceAccess = false } = {}) {
  const access = await getAccessState({ force: forceAccess });
  let effectiveActive = access.active;
  if (access.reason === "access_unavailable") {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.accessStatus);
    effectiveActive = stored[STORAGE_KEYS.accessStatus]?.active === true;
    // Published (packed) extensions clamp delayInMinutes below 1 back up to 1 anyway, so this is
    // the real-world floor, not just a nicer round number.
    await chrome.alarms.create(ACCESS_RETRY_ALARM, { delayInMinutes: 1 });
    if (!effectiveActive) return; // never had confirmed access — nothing to preserve; wait for the retry
  } else {
    await chrome.alarms.clear(ACCESS_RETRY_ALARM);
  }

  await unregisterContentScripts();
  if (!effectiveActive) {
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
    { id: TOOLBAR_SCRIPT_ID, matches, js: ["src/lib/storage-content.js", "src/lib/i18n-content.js", "src/lib/avatar-content.js", "src/lib/icons-content.js", "src/lib/qa-tools-content.js", "src/lib/sound-content.js", "src/lib/minizip-content.js", "src/options/tutorial-data.js", "src/toolbar/toolbar.js"], css: ["src/toolbar/toolbar.css"], runAt: "document_idle", allFrames: true },
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
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/lib/storage-content.js", "src/lib/i18n-content.js", "src/lib/avatar-content.js", "src/lib/icons-content.js", "src/lib/qa-tools-content.js", "src/lib/sound-content.js", "src/lib/minizip-content.js", "src/options/tutorial-data.js", "src/toolbar/toolbar.js"] });
    } catch {}
  }));
}

// Right-click "QA Sandbox" menu: a fixed set of items visible everywhere (Chrome's contextMenus
// API has no way to gate visibility on our own dynamic authorization/registration state), each
// just relaying its action to the content script for the clicked tab. If the toolbar isn't
// injected there (unauthorized page, or the workspace has no URL binding for it) the message
// simply has no listener and is dropped — same graceful no-op as every other tab message here.
const CONTEXT_MENU_PARENT_ID = "qts-sandbox";
const CONTEXT_MENU_ACTIONS = [
  { id: "qts-char-counter", action: "char-counter", title: "Contar caracteres" },
  { id: "qts-reveal-locators", action: "reveal-locators", title: "Revelar test-id, seletor e XPath" },
  { id: "qts-fill-fake-data", action: "fill-fake-data", title: "Preencher com dado fake" },
  { id: "qts-check-limits", action: "check-limits", title: "Conferir limites do campo" },
];

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: CONTEXT_MENU_PARENT_ID, title: "QA Sandbox", contexts: ["all"] });
    for (const item of CONTEXT_MENU_ACTIONS) {
      chrome.contextMenus.create({ id: item.id, parentId: CONTEXT_MENU_PARENT_ID, title: item.title, contexts: ["all"] });
    }
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const item = CONTEXT_MENU_ACTIONS.find((candidate) => candidate.id === info.menuItemId);
  if (!item || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "qts:context-action", action: item.action }).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ACCESS_RETRY_ALARM) void applyContentScriptRegistration({ forceAccess: true });
});

// The live guided tour needs a real logged-in toolbar to point the spotlight at, so it can't start
// right on chrome.runtime.onInstalled (nobody has signed in yet at that instant) -- fresh installs
// just jump straight to the login/signup screen instead. The tour itself only ever starts from an
// explicit user action (the "Novo por aqui?" banner or the Tutorial panel's "Iniciar tutorial"
// button, both in options.js) via the qts:start-tutorial-tour message below -- deliberately never
// automatic on login, so it can't hijack a returning user's tab or interrupt an unrelated flow
// (this was tried and reverted: it also fired mid-flow for anyone whose workspace happened to
// still be empty, stealing focus into a new tab right when they didn't ask for it).
const TUTORIAL_DEMO_URL = "https://demoqa.com/text-box?qtsTutorial=1";

// Seeds a starter workspace (client/project/product/environment/URL pointing at the public demo
// site used for tutorial captures) so the toolbar has something real to mount on, then opens that
// demo page in a new tab for the live tour in toolbar.js to take over. Never overwrites a
// workspace that already has real data -- if the user already set one up, this just opens the tab.
async function seedDemoWorkspaceAndOpenTour(stepKey) {
  const workspace = await getWorkspace();
  if (!workspace.clients.length) {
    await saveWorkspace({
      clients: [{ id: "demo-client", name: "Cliente Exemplo" }],
      projects: [{ id: "demo-project", clientId: "demo-client", name: "Projeto Exemplo" }],
      products: [{ id: "demo-product", projectId: "demo-project", name: "Produto Exemplo" }],
      environments: [{ id: "demo-env", name: "QA", color: "#5b21b6" }],
      urlBindings: [{ id: "demo-binding", productId: "demo-product", environmentIds: ["demo-env"], patterns: ["https://demoqa.com/*"] }],
    });
    await applyContentScriptRegistration();
  }
  // "Tentar" (options.js Tutorial panel / video dialog) passes the specific step so the tour jumps
  // straight there instead of starting from the first one -- toolbar.js reads it back off the URL.
  const url = stepKey ? `${TUTORIAL_DEMO_URL}&qtsTutorialStep=${encodeURIComponent(stepKey)}` : TUTORIAL_DEMO_URL;
  await chrome.tabs.create({ url });
}

chrome.runtime.onInstalled.addListener((details) => {
  void applyContentScriptRegistration({ forceAccess: true });
  setupContextMenus();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => { void applyContentScriptRegistration({ forceAccess: true }); setupContextMenus(); });

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
      .then(async (access) => {
        if (access.active) await applyContentScriptRegistration();
        sendResponse({ ok: access.active, access });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || "authentication_failed") }));
    return true;
  }
  if (message.type === "qts:start-tutorial-tour" && isOwnOptionsPage(sender)) {
    void seedDemoWorkspaceAndOpenTour(typeof message.stepKey === "string" ? message.stepKey : undefined);
    return undefined;
  }
  if (message.type === "qts:auth-recover-password" && isOwnOptionsPage(sender)) {
    requestPasswordReset(message.email)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || "recover_failed") }));
    return true;
  }
  if (message.type === "qts:voucher-redeem" && isOwnOptionsPage(sender)) {
    redeemVoucher(message.code)
      .then(() => getAccessState({ force: true }))
      .then(async (access) => { if (access.active) await applyContentScriptRegistration(); sendResponse({ ok: true, access }); })
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || "voucher_redeem_failed"), status: error?.status }));
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
    // openOptionsPage() has no way to pass a query param, so the live tutorial tour (toolbar.js),
    // which needs to land the user directly on the Workspace tab after "Pular tutorial", opens the
    // page URL directly instead; every other caller keeps using the plain openOptionsPage() path.
    if (message.tab) chrome.tabs.create({ url: chrome.runtime.getURL(`src/options/options.html?tab=${encodeURIComponent(message.tab)}`) });
    else chrome.runtime.openOptionsPage();
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
