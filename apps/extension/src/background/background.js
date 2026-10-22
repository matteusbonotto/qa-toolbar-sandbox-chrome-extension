import { getSiteScope, getWorkspace, saveWorkspace, onStorageChanged, STORAGE_KEYS, DEMO_CLIENT_ID, DEMO_PROJECT_ID, DEMO_PRODUCT_ID, DEMO_ENVIRONMENT_ID, DEMO_URL_BINDING_ID, DEMO_SITE_URL_PATTERN, DEMO_TEST_ACCOUNT_ID, DEMO_PAYMENT_METHOD_ID } from "../lib/storage.js";
import { acceptSessionHandoff, callMultiTester, deleteAccount, getAccessState, redeemVoucher, requestPasswordReset, signIn, signOut } from "./auth.js";
import { handleMultiTesterPort } from "./multi-tester.js";

const TOOLBAR_SCRIPT_ID = "qts-toolbar";
const PAGEBRIDGE_SCRIPT_ID = "qts-pagebridge";
const MOBILE_EMULATION_SCRIPT_ID = "qts-mobile-emu";
// Packaging (scripts/package-extension.mjs) already strips localhost from the manifest's
// externally_connectable.matches for the real Web Store artifact, so Chrome itself never
// delivers a message from there in production. This mirrors that same test-build gate here as
// defense in depth, for anyone who side-loads the raw apps/extension/ source directly instead of
// the packaged build (see auth.js's identical IS_TEST_BUILD gate for the sign-in dev bypass).
const IS_TEST_BUILD = chrome.runtime.getManifest().name.includes("[TESTE]");
const LANDING_ORIGINS = new Set([
  "https://matteusbonotto.github.io",
  ...(IS_TEST_BUILD ? ["http://localhost:5173"] : []),
]);

function isChromeMatchPattern(pattern) {
  return pattern === "<all_urls>" || /^(?:\*|https?|file|ftp):\/\/(?:\*|\*\.[^/*]+|[^/*]+)\/.*$/i.test(String(pattern ?? ""));
}

async function patternsForAuthorizedWorkspace() {
  const scope = await getSiteScope();
  if (scope.mode === "all") return ["<all_urls>"];
  if (scope.mode === "custom") return (scope.patterns || []).filter(isChromeMatchPattern);
  const workspace = await getWorkspace();
  return [...new Set((workspace.urlBindings || [])
    .filter((binding) => binding.active !== false)
    .flatMap((binding) => binding.patterns || [])
    .filter(isChromeMatchPattern))];
}

async function isAuthorizedContentSender(sender) {
  if (!sender?.tab?.id || !sender.tab.url) return false;
  const [registrationPatterns, workspace, scope] = await Promise.all([patternsForAuthorizedWorkspace(), getWorkspace(), getSiteScope()]);
  const matches = (patterns) => patterns.some((pattern) => {
    try { return patternToRegExp(pattern).test(sender.tab.url); } catch { return false; }
  });
  const bindingPatterns = (workspace.urlBindings || [])
    .filter((binding) => binding.active !== false)
    .flatMap((binding) => binding.patterns || [])
    .filter(isChromeMatchPattern);
  return matches(registrationPatterns) && (scope.mode === "all" || matches(bindingPatterns));
}

function patternToRegExp(pattern) {
  if (pattern === "<all_urls>") return /^(?:https?|file|ftp):/i;
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

async function unregisterContentScripts() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [TOOLBAR_SCRIPT_ID, PAGEBRIDGE_SCRIPT_ID, MOBILE_EMULATION_SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
}

async function removeToolbarFromOpenTabs() {
  // The toolbar is going away everywhere (sign-out, account deletion, empty scope), so no
  // Breakpoint Viewer can still need its phone emulation rule.
  await removeAllMobileEmulationRules();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try { await chrome.tabs.sendMessage(tab.id, { type: "qts:remove-toolbar" }); } catch {}
  }));
}

// Founder-reported bug, confirmed by reading the code: getAccessState() returns `active: false`
// for ANY failed access-status call, not just a genuine "subscription lapsed" - including a plain
// network hiccup or a cold Supabase function, which is exactly the least reliable moment for a
// network call (right as chrome.runtime.onInstalled/onStartup fires after an update or browser
// restart). Treating that the same as "access really ended" used to unregister the content
// scripts and rip the toolbar out of every open tab, with nothing to bring it back except another
// update or restart - no retry, no explanation to whoever was mid-test. getAccessState() itself
// now absorbs a transient failure (reason: "access_unavailable") by falling back to a
// signature-verified, not-yet-expired cached token instead of assuming the worst (see auth.js's
// readVerifiedCachedAccess/verifyAccessToken) - `access.active` below already reflects that. This
// only still needs to schedule a retry via chrome.alarms (survives the service worker going idle,
// unlike a plain setTimeout) so a genuine lapse gets caught shortly after the token's short TTL
// runs out, instead of leaving the toolbar in limbo until the next natural check.
const ACCESS_RETRY_ALARM = "qts-access-retry";

async function applyContentScriptRegistrationNow({ forceAccess = false } = {}) {
  const access = await getAccessState({ force: forceAccess });
  const effectiveActive = access.active;
  if (access.reason === "access_unavailable") {
    // Published (packed) extensions clamp delayInMinutes below 1 back up to 1 anyway, so this is
    // the real-world floor, not just a nicer round number.
    await chrome.alarms.create(ACCESS_RETRY_ALARM, { delayInMinutes: 1 });
    if (!effectiveActive) return; // no verified access survived the outage - nothing to preserve; wait for the retry
  } else {
    await chrome.alarms.clear(ACCESS_RETRY_ALARM);
  }

  await unregisterContentScripts();
  // Registration itself no longer depends on `effectiveActive`: an unauthorized/expired session
  // still needs the toolbar content script injected on its configured pages so it can render its
  // own stripped "logged out" bar (see toolbar.js render()/mountToolbar) instead of the page
  // staying completely silent about why nothing appeared. `effectiveActive` still flows to the
  // content script separately via access-status, and it's the one that decides which buttons show.
  const matches = await patternsForAuthorizedWorkspace();
  if (!matches.length) {
    await removeToolbarFromOpenTabs();
    return;
  }
  await chrome.scripting.registerContentScripts([
    { id: PAGEBRIDGE_SCRIPT_ID, matches, js: ["src/pagebridge/pagebridge.js"], world: "MAIN", runAt: "document_start", allFrames: false },
    // Inert in every frame whose URL lacks the Breakpoint Viewer phone marker (see
    // MOBILE_EMULATION_MARKER); allFrames + document_start so it patches navigator/screen/matchMedia
    // inside the phone iframe before any of the site's own scripts run.
    { id: MOBILE_EMULATION_SCRIPT_ID, matches, js: ["src/pagebridge/mobile-emulation.js"], world: "MAIN", runAt: "document_start", allFrames: true },
    // allFrames:true so the bar also renders inside the Breakpoint Viewer's own device-preview
    // iframes (same-origin, matching these same URL patterns) - boot()'s tiny-frame guard in
    // toolbar.js keeps this from mounting in incidental small embedded widgets on normal pages.
    { id: TOOLBAR_SCRIPT_ID, matches, js: ["src/lib/storage-content.js", "src/lib/i18n-content.js", "src/lib/avatar-content.js", "src/lib/icons-content.js", "src/lib/qa-tools-content.js", "src/lib/sound-content.js", "src/lib/minizip-content.js", "src/lib/gif-content.js", "src/lib/qrcode-content.js", "src/lib/theme-presets-content.js", "src/options/tutorial-data.js", "src/toolbar/toolbar.js"], css: ["src/toolbar/toolbar.css"], runAt: "document_idle", allFrames: true },
  ]);
  await injectIntoOpenTabs(matches);
}

// Workspace/auth/install events can arrive almost together. Serialize registration so two runs
// never both conclude that a tab needs injection and execute the same classic scripts twice
// (which would redeclare their top-level const bindings).
let registrationQueue = Promise.resolve();
function applyContentScriptRegistration(options = {}) {
  const run = registrationQueue.catch(() => {}).then(() => applyContentScriptRegistrationNow(options));
  registrationQueue = run;
  return run;
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
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/lib/storage-content.js", "src/lib/i18n-content.js", "src/lib/avatar-content.js", "src/lib/icons-content.js", "src/lib/qa-tools-content.js", "src/lib/sound-content.js", "src/lib/minizip-content.js", "src/lib/gif-content.js", "src/lib/qrcode-content.js", "src/lib/theme-presets-content.js", "src/options/tutorial-data.js", "src/toolbar/toolbar.js"] });
    } catch {}
  }));
}

// Right-click "QA Sandbox" menu: a fixed set of items visible everywhere (Chrome's contextMenus
// API has no way to gate visibility on our own dynamic authorization/registration state), each
// just relaying its action to the content script for the clicked tab. If the toolbar isn't
// injected there (unauthorized page, or the workspace has no URL binding for it) the message
// simply has no listener and is dropped - same graceful no-op as every other tab message here.
const CONTEXT_MENU_PARENT_ID = "qts-sandbox";
const CONTEXT_MENU_ACTIONS = [
  { id: "qts-char-counter", action: "char-counter", title: "Contar caracteres" },
  { id: "qts-reveal-locators", action: "reveal-locators", title: "Revelar test-id, seletor e XPath" },
  { id: "qts-fill-fake-data", action: "fill-fake-data", title: "Preencher com dado fake" },
  { id: "qts-check-limits", action: "check-limits", title: "Abrir Validador de campos neste campo" },
  { id: "qts-multi-click", action: "multi-click", title: "Configurar Multiclick neste elemento" },
  { id: "qts-toggle-blur", action: "toggle-blur", title: "Borrar / desborrar este elemento" },
  { id: "qts-pixel-perfect-inspect", action: "pixel-perfect-inspect", title: "Inspecionar com Régua (tamanho em pixels)" },
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
// Our own demo/tutorial site (apps/landing/public/sandbox) -- a small self-contained page with a
// CRUD table, a multi-field form and simulated success/error/network-failure triggers, replacing
// the earlier dependency on a third-party site (demoqa.com) for onboarding and tutorial captures.
const TUTORIAL_DEMO_URL = `${DEMO_SITE_URL_PATTERN.replace(/\*$/, "index.html")}?qtsTutorial=1`;

async function ensureDemoWorkspace() {
  const workspace = await getWorkspace();
  if (workspace.clients.length) return workspace;
  return saveWorkspace({
    clients: [{ id: DEMO_CLIENT_ID, name: "Toolbar", locked: true }],
    projects: [{ id: DEMO_PROJECT_ID, clientId: DEMO_CLIENT_ID, name: "Sandbox", locked: true }],
    products: [{ id: DEMO_PRODUCT_ID, projectId: DEMO_PROJECT_ID, name: "STAGE", locked: true }],
    environments: [{ id: DEMO_ENVIRONMENT_ID, name: "QA", color: "#5b21b6", locked: true }],
    urlBindings: [{ id: DEMO_URL_BINDING_ID, productId: DEMO_PRODUCT_ID, environmentIds: [DEMO_ENVIRONMENT_ID], patterns: [DEMO_SITE_URL_PATTERN], locked: true }],
    // Not locked (unlike the five entities above): nothing in the tour depends on their exact
    // content, they're just here so a fresh install already shows what a filled-in test account /
    // sandbox card looks like - editable or removable like any real entry.
    testAccounts: [{
      id: DEMO_TEST_ACCOUNT_ID, environmentIds: [DEMO_ENVIRONMENT_ID], productIds: [DEMO_PRODUCT_ID],
      label: "Admin", accountType: "Administrador", username: "admin", password: "admin",
      notes: "Conta de demonstração - substitua pelas suas credenciais sandbox reais.",
    }],
    paymentMethods: [{
      id: DEMO_PAYMENT_METHOD_ID, environmentIds: [DEMO_ENVIRONMENT_ID], productIds: [DEMO_PRODUCT_ID],
      label: "Cartão de teste", type: "card", holder: "QA Sandbox", value: "4242 4242 4242 4242",
      expiry: "12/2030", cvv: "123",
      notes: "Cartão de demonstração (número de teste público do Stripe) - substitua pelo seu meio de pagamento sandbox real.",
    }],
    preferences: { demoWorkspaceSeeded: true },
  });
}

// Seeds a starter workspace (client/project/product/environment/URL pointing at the public demo
// site used for tutorial captures) so the toolbar has something real to mount on, then opens that
// demo page in a new tab for the live tour in toolbar.js to take over. Never overwrites a
// workspace that already has real data -- if the user already set one up, this just opens the tab.
// Cliente=Toolbar/Projeto=Sandbox/Produto=STAGE (plus the QA environment and the URL binding that
// actually makes the toolbar mount on the demo site) use fixed ids and
// preferences.demoWorkspaceSeeded so normalizeWorkspace (storage.js) locks them permanently --
// see the comment there for why all four have to survive together, not just the first three.
async function seedDemoWorkspaceAndOpenTour(stepKey, reuseTabId) {
  await ensureDemoWorkspace();
  // "Tentar" (options.js Tutorial panel / video dialog) passes the specific step so the tour jumps
  // straight there instead of starting from the first one -- toolbar.js reads it back off the URL.
  const url = stepKey ? `${TUTORIAL_DEMO_URL}&qtsTutorialStep=${encodeURIComponent(stepKey)}` : TUTORIAL_DEMO_URL;
  if (reuseTabId) {
    try { await chrome.tabs.update(reuseTabId, { url, active: true }); return; } catch {}
  }
  await chrome.tabs.create({ url });
}

async function startPendingFirstAccessTour() {
  const current = await chrome.storage.local.get(STORAGE_KEYS.uiState);
  const uiState = current[STORAGE_KEYS.uiState] || {};
  if (uiState.pendingFirstAccessTour !== true) return false;
  const reuseTabId = Number.isInteger(uiState.pendingFirstAccessTabId)
    && Number(uiState.pendingFirstAccessReuseUntil) > Date.now() ? uiState.pendingFirstAccessTabId : undefined;
  await chrome.storage.local.set({
    [STORAGE_KEYS.uiState]: {
      ...uiState,
      pendingFirstAccessTour: false,
      pendingFirstAccessTabId: null,
      pendingFirstAccessReuseUntil: null,
      firstAccessTourStartedAt: new Date().toISOString(),
    },
  });
  await seedDemoWorkspaceAndOpenTour(undefined, reuseTabId);
  return true;
}

chrome.runtime.onInstalled.addListener((details) => {
  setupContextMenus();
  if (details.reason === "install") {
    // Open the public tutorial target immediately, even before authentication. Once a session is
    // handed off by the landing page (or the user signs in through options), the one-shot flag
    // below seeds the demo workspace and opens the authenticated live tour.
    void ensureDemoWorkspace().then(() => applyContentScriptRegistration({ forceAccess: true })).then(() => chrome.tabs.create({ url: TUTORIAL_DEMO_URL })).then(async (installTab) => {
      const current = await chrome.storage.local.get(STORAGE_KEYS.uiState);
      const uiState = current[STORAGE_KEYS.uiState] || {};
      await chrome.storage.local.set({
        [STORAGE_KEYS.uiState]: {
          ...uiState,
          pendingFirstAccessTour: true,
          pendingFirstAccessTabId: installTab.id,
          pendingFirstAccessReuseUntil: Date.now() + 30_000,
        },
      });
      // Covers the small race where an already-open, logged-in landing page hands its session off
      // while the install event is still persisting the first-access flag.
      const access = await getAccessState({ force: true });
      if (access.active) {
        await applyContentScriptRegistration();
        await startPendingFirstAccessTour();
      }
    });
  } else {
    void applyContentScriptRegistration({ forceAccess: true });
  }
  if (details.reason === "update") {
    // Chrome Web Store updates the package automatically. Persist a one-shot release note so
    // every previously installed workspace learns what changed without losing any local data.
    // Existing page contexts keep their old content script until navigation/reload (Chrome's
    // normal extension lifecycle); the NEW action badge makes that visible immediately.
    void chrome.storage.local.get(STORAGE_KEYS.uiState).then((current) => chrome.storage.local.set({
      [STORAGE_KEYS.uiState]: {
        ...(current[STORAGE_KEYS.uiState] || {}),
        pendingReleaseNote: {
          version: chrome.runtime.getManifest().version,
          previousVersion: details.previousVersion || null,
          installedAt: new Date().toISOString(),
        },
      },
    })).then(() => Promise.all([
      chrome.action.setBadgeBackgroundColor({ color: "#ef3340" }),
      chrome.action.setBadgeText({ text: "NEW" }),
      chrome.action.setTitle({ title: `QA Toolbar Sandbox ${chrome.runtime.getManifest().version} - veja o que mudou` }),
    ]));
  }
});
chrome.runtime.onStartup.addListener(() => { void applyContentScriptRegistration({ forceAccess: true }); setupContextMenus(); void chrome.storage.local.remove(RECORDER_STATE_KEY); });

// Evidence recording runs in its own extension window (src/recorder/recorder.js) so a page reload
// no longer kills it. Toolbars mirror RECORDER_STATE_KEY; these helpers keep that mirror honest
// when the window disappears without saying goodbye (closed by the user, crash, browser restart).
const RECORDER_STATE_KEY = "qtsRecorderStateV1";
async function readLiveRecorderState() {
  const state = (await chrome.storage.local.get(RECORDER_STATE_KEY))[RECORDER_STATE_KEY];
  if (!state || !["starting", "recording", "paused", "stopping"].includes(state.status) || !state.windowId) return null;
  const alive = await chrome.windows.get(state.windowId).then(() => true, () => false);
  if (!alive) {
    await chrome.storage.local.set({ [RECORDER_STATE_KEY]: { ...state, status: "idle", reason: "window_closed", updatedAt: Date.now() } });
    return null;
  }
  return state;
}
chrome.windows.onRemoved.addListener((windowId) => {
  void chrome.storage.local.get(RECORDER_STATE_KEY).then(async (stored) => {
    const state = stored[RECORDER_STATE_KEY];
    if (state?.windowId !== windowId || state.status === "idle") return;
    await chrome.storage.local.set({ [RECORDER_STATE_KEY]: { ...state, status: "idle", reason: "window_closed", updatedAt: Date.now() } });
  });
});

// Breakpoint Viewer phone emulation (declarativeNetRequestWithHostAccess, see docs/permissions.md).
// Sites like Cinemark Cineclub pick their mobile layout from the User-Agent (server and JS), not
// only from the viewport width the phone iframe already has. Both panes of the viewer load the
// SAME URL in the SAME tab, and DNR cannot tell two iframes apart, so toolbar.js adds the
// MOBILE_EMULATION_MARKER query param only to the phone pane's URL and the rule matches on it.
// Session rules (the only kind that accepts tabIds) survive the service worker dying (rule 14),
// so every exit path below removes them: explicit disable, tab navigation/close and a startup sweep.
const MOBILE_EMULATION_MARKER = "__qtsbpua=1";
// Chrome's own reduced Android UA format, with the real Chrome major so client hints and UA stay
// coherent. src/pagebridge/mobile-emulation.js builds the exact same string for navigator.userAgent:
// keep both in sync.
const MOBILE_EMULATION_CHROME_MAJOR = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] || "141";
const MOBILE_EMULATION_HEADERS = [
  { header: "user-agent", operation: "set", value: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MOBILE_EMULATION_CHROME_MAJOR}.0.0.0 Mobile Safari/537.36` },
  { header: "sec-ch-ua-mobile", operation: "set", value: "?1" },
  { header: "sec-ch-ua-platform", operation: "set", value: "\"Android\"" },
];

function mobileEmulationRule(tabId) {
  return {
    // One rule per tab, keyed by the tab id itself: enabling twice just replaces it (idempotent).
    id: tabId,
    priority: 1,
    action: { type: "modifyHeaders", requestHeaders: MOBILE_EMULATION_HEADERS },
    // "^" is DNR's separator anchor (any non-alphanumeric/_-.% char or the end of the URL), so a
    // longer value like __qtsbpua=12 never matches. urlFilter, not regexFilter: in the full smoke
    // run a regexFilter rule present before the request still did not rewrite the phone pane's
    // header (4 runs in a row), while this urlFilter form passed every time.
    condition: { tabIds: [tabId], resourceTypes: ["sub_frame"], urlFilter: `${MOBILE_EMULATION_MARKER}^` },
  };
}

async function removeMobileEmulationRule(tabId) {
  try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }); }
  catch (error) { console.warn("QTS: could not remove phone emulation rule", error); }
}

async function removeAllMobileEmulationRules() {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((rule) => rule.id) });
  } catch (error) { console.warn("QTS: could not remove phone emulation rules", error); }
}

// The only session rules this extension creates are these (keep it that way, or filter by id
// range here), so any rule whose tab no longer exists is a leftover from a service worker that
// died before its teardown ran.
async function sweepMobileEmulationRules() {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const openTabIds = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
    const stale = rules.filter((rule) => !openTabIds.has(rule.id)).map((rule) => rule.id);
    if (stale.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale });
  } catch (error) { console.warn("QTS: could not sweep phone emulation rules", error); }
}

// A top-level navigation destroys the viewer overlay along with the page, so the rule has nothing
// left to serve. Keyed on changeInfo.url only, NOT status === "loading": Chrome reports the tab as
// loading whenever ANY frame loads, so the viewer's own laptop pane loading next to the phone pane
// used to delete the rule right after it was created (caught by the smoke as a desktop UA on the
// phone request). A same-URL reload therefore keeps the rule until the tab closes, navigates or
// the viewer is opened/closed again; it still only touches marked sub_frames of that one tab.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) void removeMobileEmulationRule(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => { void removeMobileEmulationRule(tabId); });
chrome.runtime.onStartup.addListener(() => { void sweepMobileEmulationRules(); });
chrome.runtime.onInstalled.addListener(() => { void sweepMobileEmulationRules(); });

onStorageChanged((changes) => {
  if (changes[STORAGE_KEYS.workspace] || changes[STORAGE_KEYS.siteScope]) void applyContentScriptRegistration();
});

function isOwnOptionsPage(sender) {
  if (sender?.id !== chrome.runtime.id || typeof sender.url !== "string") return false;
  try {
    const senderUrl = new URL(sender.url);
    const optionsUrl = new URL(chrome.runtime.getURL("src/options/options.html"));
    return senderUrl.origin === optionsUrl.origin && senderUrl.pathname === optionsUrl.pathname;
  } catch {
    return false;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  handleMultiTesterPort(port, async (sender) => {
    const [access, authorizedSender] = await Promise.all([getAccessState(), isAuthorizedContentSender(sender)]);
    return access.active === true && authorizedSender;
  });
});

const MULTI_TESTER_ACTIONS = new Set(["create", "request", "state", "touch", "chat", "approve", "reject", "remove", "leave", "end"]);

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
  if (message.type === "qts:recording-run") {
    getAccessState().then(async (access) => {
      // Same tab-scoped, session-only pattern as qts:macro-run above, generalized to the two
      // *recording* phases (Gravador de Passos / Macro Studio) - neither writes anything while
      // capturing today, so a page reload mid-recording silently loses everything already
      // captured. This lets the content script check in on every step and pick back up right
      // where it left off after boot() reinjects.
      if (!access.active || !sender.tab?.id) return sendResponse({ ok: false, error: "authentication_required" });
      const kind = message.kind === "macro" ? "macro" : "steps";
      const key = `qts${kind === "macro" ? "Macro" : "Steps"}RecordingTab${sender.tab.id}`;
      if (message.operation === "get") {
        const stored = await chrome.storage.session.get(key);
        return sendResponse({ ok: true, run: stored[key] || null });
      }
      if (message.operation === "clear") {
        await chrome.storage.session.remove(key);
        return sendResponse({ ok: true });
      }
      if (message.operation === "set" && message.run && typeof message.run === "object") {
        if (JSON.stringify(message.run).length > 200_000) return sendResponse({ ok: false, error: "recording_too_large" });
        const run = { ...message.run, expiresAt: Math.min(Date.now() + 60 * 60_000, Number(message.run.expiresAt) || 0) };
        if (run.expiresAt <= Date.now()) return sendResponse({ ok: false, error: "invalid_recording_run" });
        await chrome.storage.session.set({ [key]: run });
        return sendResponse({ ok: true });
      }
      return sendResponse({ ok: false, error: "invalid_operation" });
    }).catch(() => sendResponse({ ok: false, error: "recording_run_failed" }));
    return true;
  }
  if (message.type === "qts:test-session") {
    getAccessState().then(async (access) => {
      // Same tab-scoped, session-only pattern as qts:recording-run above, for "Sessão de Teste"
      // itself. state.testSession used to live only in the content script's in-memory state, so
      // any full page reload/navigation mid-session - exactly the case a QA needs most: click
      // something, land on a new screen, keep evaluating - silently ended the session with no way
      // to resume it. This lets boot() pick the session back up after re-injection.
      if (!access.active || !sender.tab?.id) return sendResponse({ ok: false, error: "authentication_required" });
      const key = `qtsTestSessionTab${sender.tab.id}`;
      if (message.operation === "get") {
        const stored = await chrome.storage.session.get(key);
        return sendResponse({ ok: true, run: stored[key] || null });
      }
      if (message.operation === "clear") {
        await chrome.storage.session.remove(key);
        return sendResponse({ ok: true });
      }
      if (message.operation === "set" && message.run && typeof message.run === "object") {
        if (JSON.stringify(message.run).length > 50_000) return sendResponse({ ok: false, error: "test_session_too_large" });
        const run = { ...message.run, expiresAt: Math.min(Date.now() + 12 * 60 * 60_000, Number(message.run.expiresAt) || 0) };
        if (run.expiresAt <= Date.now()) return sendResponse({ ok: false, error: "invalid_test_session" });
        await chrome.storage.session.set({ [key]: run });
        return sendResponse({ ok: true });
      }
      return sendResponse({ ok: false, error: "invalid_operation" });
    }).catch(() => sendResponse({ ok: false, error: "test_session_failed" }));
    return true;
  }
  if (message.type === "qts:auth-sign-in" && isOwnOptionsPage(sender)) {
    signIn(message.email, message.password)
      .then(() => getAccessState({ force: true }))
      .then(async (access) => {
        if (access.active) {
          await applyContentScriptRegistration();
          void startPendingFirstAccessTour().catch(() => {});
        }
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
  if (message.type === "qts:bp-mobile-emulation") {
    // Removing the sender's own tab rule is always safe, so disable skips the session/scope gate:
    // a sign-out or expired plan with the viewer open must still be able to tear it down.
    if (message.operation === "disable" && sender.tab?.id) {
      void removeMobileEmulationRule(sender.tab.id).then(() => sendResponse({ ok: true }));
      return true;
    }
    Promise.all([getAccessState(), isAuthorizedContentSender(sender)]).then(async ([access, authorizedSender]) => {
      if (!access.active || !authorizedSender || !sender.tab?.id) return sendResponse({ ok: false, error: "authentication_required" });
      const tabId = sender.tab.id;
      try {
        if (message.operation === "enable") {
          await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId], addRules: [mobileEmulationRule(tabId)] });
          return sendResponse({ ok: true, marker: MOBILE_EMULATION_MARKER });
        }
        return sendResponse({ ok: false, error: "invalid_operation" });
      } catch (error) {
        return sendResponse({ ok: false, error: String(error?.message || error) });
      }
    }).catch(() => sendResponse({ ok: false, error: "mobile_emulation_failed" }));
    return true;
  }
  if (message.type === "qts:multi-tester") {
    // Same sender gate as the other page-scoped actions; the Edge Function re-checks plan and
    // every room rule server-side, so this only forwards whitelisted, size-bounded fields.
    Promise.all([getAccessState(), isAuthorizedContentSender(sender)]).then(async ([access, authorizedSender]) => {
      if (!access.active || !authorizedSender) return sendResponse({ ok: false, error: "authentication_required" });
      if (!MULTI_TESTER_ACTIONS.has(message.action)) return sendResponse({ ok: false, error: "invalid_action" });
      const body = { action: message.action };
      for (const key of ["roomId", "userId", "code", "nickname", "color"]) if (typeof message[key] === "string") body[key] = message[key].slice(0, 80);
      for (const key of ["durationMinutes", "idleTimeoutMinutes"]) if (Number.isFinite(message[key])) body[key] = message[key];
      if (typeof message.text === "string") body.text = message.text.slice(0, 500);
      try {
        sendResponse({ ok: true, state: await callMultiTester(body) });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || "multi_tester_failed"), status: error?.status });
      }
    }).catch(() => sendResponse({ ok: false, error: "multi_tester_failed" }));
    return true;
  }
  if (message.type === "qts:clear-site-data") {
    Promise.all([getAccessState(), isAuthorizedContentSender(sender)]).then(async ([access, authorizedSender]) => {
      if (!access.active || !authorizedSender || !sender.tab?.id || !sender.tab?.url) {
        return sendResponse({ ok: false, error: "authentication_required" });
      }
      let url;
      try { url = new URL(sender.tab.url); } catch { return sendResponse({ ok: false, error: "invalid_url" }); }
      if (!["http:", "https:"].includes(url.protocol)) return sendResponse({ ok: false, error: "invalid_url" });
      try {
        // `origins` scopes this to the tested site's exact origin only - it never touches
        // chrome.storage.local, a separate API where the extension keeps its own accounts, macros
        // and settings, and never touches any other open tab/origin.
        await chrome.browsingData.remove(
          { origins: [url.origin], since: 0 },
          { cache: true, cookies: true, cacheStorage: true, indexedDB: true, localStorage: true, serviceWorkers: true },
        );
        await chrome.tabs.reload(sender.tab.id);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    });
    return true;
  }
  if (message.type === "qts:close-detached-window") {
    Promise.all([getAccessState(), isAuthorizedContentSender(sender)]).then(async ([access, authorizedSender]) => {
      if (!access.active || !authorizedSender || !sender.tab?.id || !sender.tab?.windowId) {
        return sendResponse({ ok: false, error: "authentication_required" });
      }
      try {
        const targetWindow = await chrome.windows.get(sender.tab.windowId);
        // Detached tools created by this extension are popup windows. If browser fallback opened a
        // normal tab instead, close only that tab rather than destroying the user's whole window.
        if (targetWindow.type === "popup") await chrome.windows.remove(targetWindow.id);
        else await chrome.tabs.remove(sender.tab.id);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    });
    return true;
  }
  if (message.type === "qts:open-tool-window") {
    Promise.all([getAccessState(), isAuthorizedContentSender(sender)]).then(([access, authorizedSender]) => {
      if (!access.active || !authorizedSender || typeof message.url !== "string") {
        return sendResponse({ ok: false, error: "authentication_required" });
      }
      let url;
      try { url = new URL(message.url); } catch { return sendResponse({ ok: false, error: "invalid_url" }); }
      if (!["http:", "https:", "file:"].includes(url.protocol)) return sendResponse({ ok: false, error: "invalid_url" });
      return chrome.windows.create({ url: url.toString(), type: "popup", focused: true, width: 1100, height: 760 })
        .then(async (createdWindow) => {
          const tabId = createdWindow.tabs?.[0]?.id
            || (await chrome.tabs.query({ windowId: createdWindow.id, active: true }))[0]?.id;
          if (tabId && typeof message.toolKey === "string") {
            // The URL parameter is the cold-start path. This explicit message is a second,
            // deterministic trigger after the content script finishes loading, eliminating the
            // race where the popup showed only a duplicate page without its requested panel.
            for (const delay of [250, 500, 1_000, 1_500]) {
              await new Promise((resolveWait) => setTimeout(resolveWait, delay));
              const result = await chrome.tabs.sendMessage(tabId, { type: "qts:open-detached-tool", toolKey: message.toolKey }).catch(() => null);
              if (result?.handled) break;
            }
          }
          sendResponse({ ok: true, windowId: createdWindow.id });
        })
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    });
    return true;
  }
  if (message.type === "qts:recorder-open") {
    Promise.all([getAccessState(), isAuthorizedContentSender(sender)]).then(async ([access, authorizedSender]) => {
      if (!access.active || !authorizedSender || !sender.tab?.id) return sendResponse({ ok: false, error: "authentication_required" });
      try {
        const existing = await readLiveRecorderState();
        if (existing) {
          await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
          return sendResponse({ ok: false, error: "already_recording" });
        }
        const query = new URLSearchParams({
          mode: message.mode === "gif" ? "gif" : "video",
          tabId: String(sender.tab.id),
          windowId: String(sender.tab.windowId ?? ""),
          lang: String(message.lang || "pt-BR").slice(0, 10),
          prefix: String(message.prefix || "").slice(0, 40),
          slug: String(message.slug || "").slice(0, 60),
        });
        const sourceWindow = await chrome.windows.get(sender.tab.windowId).catch(() => null);
        // Pre-capture ("choose") size: large and vertical so the picker guidance and the big
        // "choose what to record" button are easy to read. recorder.js shrinks this window down to a
        // small corner widget (see shrinkToWidget there) the moment capture actually starts.
        const width = 420;
        const height = 620;
        // Anchor to the top-right of the source window: 24px in from its right edge, 96px down from
        // its top, clamped so it never opens off the left/top edge.
        const placement = sourceWindow && Number.isFinite(sourceWindow.left)
          ? { left: Math.max(0, sourceWindow.left + sourceWindow.width - width - 24), top: Math.max(0, sourceWindow.top + 96) }
          : {};
        const created = await chrome.windows.create({ url: chrome.runtime.getURL(`src/recorder/recorder.html?${query}`), type: "popup", focused: true, width, height, ...placement });
        sendResponse({ ok: true, windowId: created.id });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    });
    return true;
  }
  if (message.type === "qts:open-options") {
    // openOptionsPage() has no way to pass a query param, so the live tutorial tour (toolbar.js),
    // which needs to land the user directly on the Workspace tab after "Pular tutorial", opens the
    // page URL directly instead; every other caller keeps using the plain openOptionsPage() path.
    if (message.tab) {
      const query = new URLSearchParams({ tab: String(message.tab) });
      if (message.workspaceTab) query.set("workspaceTab", String(message.workspaceTab));
      if (message.composer) query.set("composer", String(message.composer));
      if (message.settingsTour) {
        query.set("settingsTour", "1");
        query.set("trustedHandoff", "toolbar");
      }
      chrome.tabs.create({ url: chrome.runtime.getURL(`src/options/options.html?${query.toString()}`) });
    }
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
    .then(async (access) => {
      if (access.active) {
        await applyContentScriptRegistration();
        void startPendingFirstAccessTour().catch(() => {});
      }
      sendResponse({ accepted: access.active });
    })
    .catch(() => sendResponse({ accepted: false }));
  return true;
});

chrome.action.onClicked.addListener(() => { chrome.runtime.openOptionsPage(); });
