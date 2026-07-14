import { acceptLandingSession } from "../src/services/sessionHandoff";

export default defineBackground(() => {
  browser.runtime.onMessageExternal.addListener((message, sender) => {
    const session = acceptLandingSession(message, sender.url);
    if (!session) return Promise.resolve({ accepted: false });
    return browser.storage.local.set({ qtsAuthSession: session }).then(() => ({ accepted: true }));
  });
  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "qts:capture-visible-tab") return undefined;
    return browser.tabs.captureVisibleTab({ format: "png" }).then((dataUrl) => ({ dataUrl }));
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    const request = message as { type?: unknown; nonce?: unknown };
    if (request?.type !== "qts:install-network-bridge" || typeof request.nonce !== "string" || request.nonce.length !== 36 || !sender.tab?.id) return undefined;
    return browser.scripting.executeScript({ target: { tabId: sender.tab.id }, world: "MAIN", func: installNetworkBridge, args: [request.nonce] }).then(() => ({ installed: true }));
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    const request = message as { type?: unknown; pattern?: unknown; status?: unknown };
    if (request?.type !== "qts:set-forced-fetch" || !sender.tab?.id || (request.pattern !== null && (typeof request.pattern !== "string" || request.pattern.length > 200)) || (request.status !== null && (typeof request.status !== "number" || request.status < 400 || request.status > 599))) return undefined;
    return browser.scripting.executeScript({ target: { tabId: sender.tab.id }, world: "MAIN", func: setForcedFetch, args: [request.pattern as string | null, request.status as number | null] }).then(() => ({ applied: true }));
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    const request = message as { type?: unknown; frozenAt?: unknown };
    if (request?.type !== "qts:toggle-frozen-clock" || !sender.tab?.id || (request.frozenAt !== null && typeof request.frozenAt !== "number")) return undefined;
    return browser.scripting.executeScript({ target: { tabId: sender.tab.id }, world: "MAIN", func: setFrozenClock, args: [request.frozenAt as number | null] }).then(() => ({ applied: true }));
  });
  browser.action.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });

  browser.runtime.onInstalled.addListener(() => {
    void browser.storage.local.set({
      qtsInstallation: {
        id: crypto.randomUUID(),
        installedAt: new Date().toISOString(),
        schemaVersion: 2,
      },
    });
  });
});

function setFrozenClock(frozenAt: number | null): void {
  const key = "__qtsOriginalDate";
  const scoped = globalThis as typeof globalThis & { __qtsOriginalDate?: DateConstructor };
  if (!scoped[key]) scoped[key] = globalThis.Date;
  const OriginalDate = scoped[key]!;
  if (frozenAt === null) { globalThis.Date = OriginalDate; return; }
  const fixedAt = frozenAt;
  class FrozenDate extends OriginalDate {
    constructor(...args: [] | [string | number]) { super(args.length ? args[0] : fixedAt); }
    static now(): number { return fixedAt; }
  }
  globalThis.Date = FrozenDate as DateConstructor;
}

function setForcedFetch(pattern: string | null, status: number | null): void {
  const key = "__qtsFetchBeforeForce";
  const scoped = globalThis as typeof globalThis & { __qtsFetchBeforeForce?: typeof fetch };
  if (!scoped[key]) scoped[key] = globalThis.fetch.bind(globalThis);
  const originalFetch = scoped[key]!;
  if (!pattern || !status) { globalThis.fetch = originalFetch; return; }
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const input = args[0]; const url = input instanceof Request ? input.url : String(input);
    if (url.includes(pattern)) {
      globalThis.fetch = originalFetch;
      window.postMessage({ source: "qts-force-http-consumed" }, window.location.origin);
      return new Response(JSON.stringify({ forcedBy: "QA Toolbar Sandbox", status }), { status, headers: { "content-type": "application/json", "x-qts-forced": "true" } });
    }
    return originalFetch(...args);
  };
}

function installNetworkBridge(nonce: string): void {
  const marker = "__qtsNetworkBridgeInstalled";
  const scopedWindow = window as typeof window & Record<string, unknown>;
  if (scopedWindow[marker]) return;
  scopedWindow[marker] = true;
  const secretPattern = /password|passwd|token|authorization|cookie|secret|api[-_]?key|cvv|cvc|card[-_]?number/i;
  const sanitize = (value: unknown, key = "", depth = 0): unknown => {
    if (secretPattern.test(key)) return "[REDACTED]";
    if (depth > 8) return "[TRUNCATED]";
    if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitize(entry, key, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 500).map(([entryKey, entry]) => [entryKey, sanitize(entry, entryKey, depth + 1)]));
    return typeof value === "string" ? value.slice(0, 20_000) : value;
  };
  const emit = (record: Record<string, unknown>) => {
    const sanitized = sanitize(record);
    const serialized = JSON.stringify(sanitized);
    if (serialized.length <= 262_144) window.postMessage({ source: "qts-network-bridge", nonce, record: sanitized }, window.location.origin);
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const started = performance.now(); const response = await originalFetch(...args);
    const input = args[0]; const request = input instanceof Request ? input : null; const url = request?.url ?? String(input); const method = request?.method ?? args[1]?.method ?? "GET";
    void response.clone().text().then((text) => { let payload: unknown = text.slice(0, 262_144); try { payload = JSON.parse(text); } catch { /* keep text */ } emit({ kind: "fetch", url, method, status: response.status, durationMs: Math.round(performance.now() - started), payload }); }).catch(() => emit({ kind: "fetch", url, method, status: response.status, durationMs: Math.round(performance.now() - started), payload: null }));
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: unknown[]) { (this as XMLHttpRequest & { __qts?: unknown }).__qts = { method, url: String(url), started: 0 }; return Reflect.apply(originalOpen, this, [method, url, ...rest]); };
  XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) { const meta = (this as XMLHttpRequest & { __qts?: { method: string; url: string; started: number } }).__qts; if (meta) { meta.started = performance.now(); this.addEventListener("loadend", () => { let payload: unknown = String(this.responseText ?? "").slice(0, 262_144); try { payload = JSON.parse(String(this.responseText)); } catch { /* keep text */ } emit({ kind: "xhr", url: meta.url, method: meta.method, status: this.status, durationMs: Math.round(performance.now() - meta.started), payload }); }, { once: true }); } return originalSend.call(this, body); };
}
