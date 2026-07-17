// Runs in the page's MAIN world (world:"MAIN" in the dynamic content script
// registration in background.js), so it shares the real window/Date/fetch
// with the page — unlike the isolated-world toolbar script, which cannot see
// or patch these. Talks to the isolated world only through DOM CustomEvents
// (no shared JS globals exist between the two worlds), matching how
// Tampermonkey's own `window` (sandbox) vs `unsafeWindow` (real page) split
// worked in the original userscript.
(() => {
  if (window.__qtsPageBridgeInstalled) return;
  window.__qtsPageBridgeInstalled = true;

  const NETWORK_EVENT = "qts:network-captured";
  const FREEZE_COMMAND_EVENT = "qts:freeze-clock-command";
  const FREEZE_STATE_EVENT = "qts:freeze-clock-state";
  const FORCE_HTTP_COMMAND_EVENT = "qts:force-http-command";
  const FORCE_HTTP_STATE_EVENT = "qts:force-http-state";

  const MAX_PAYLOAD_CHARS = 200_000;
  const HISTORY_LIMIT = 150;
  const history = [];

  function safeStringifyPreview(value) {
    try {
      const text = JSON.stringify(value);
      return text.length > MAX_PAYLOAD_CHARS ? `${text.slice(0, MAX_PAYLOAD_CHARS)}…` : text;
    } catch {
      return null;
    }
  }

  function publishCapture(entry) {
    history.unshift(entry);
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    document.dispatchEvent(new CustomEvent(NETWORK_EVENT, { detail: entry }));
  }

  function captureJsonPayload({ url, method, status, source, payload }) {
    const preview = safeStringifyPreview(payload);
    if (preview === null) return;
    publishCapture({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      url: String(url || ""),
      method: String(method || "GET").toUpperCase(),
      status: Number(status || 0),
      source,
      capturedAt: Date.now(),
      payload: JSON.parse(preview.endsWith("…") ? preview.slice(0, -1) : preview),
      truncated: preview.endsWith("…"),
    });
  }

  // ---------------------------------------------------------------------
  // Network capture: fetch + XMLHttpRequest, JSON responses only.
  // ---------------------------------------------------------------------
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function" && !originalFetch.__qtsPatched) {
    const patchedFetch = function (...args) {
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
      const method = args[1]?.method || (typeof args[0] === "object" ? args[0]?.method : undefined) || "GET";

      if (window.__qtsForcedStatus) {
        const forcedStatus = Number(window.__qtsForcedStatus);
        window.__qtsForcedStatus = null;
        const forcedPayload = { forced: true, status: forcedStatus, requestUrl: String(requestUrl || "") };
        captureJsonPayload({ url: requestUrl, method, status: forcedStatus, source: "forced", payload: forcedPayload });
        document.dispatchEvent(new CustomEvent(FORCE_HTTP_STATE_EVENT, { detail: { active: false } }));
        return Promise.resolve(new Response(JSON.stringify(forcedPayload), {
          status: forcedStatus,
          headers: { "content-type": "application/json", "x-qts-forced": "true" },
        }));
      }

      const result = originalFetch.apply(this, args);
      result.then((response) => {
        response.clone().json()
          .then((payload) => captureJsonPayload({ url: response.url || requestUrl, method, status: response.status, source: "fetch", payload }))
          .catch(() => {});
      }).catch(() => {});
      return result;
    };
    Object.defineProperty(patchedFetch, "__qtsPatched", { value: true });
    window.fetch = patchedFetch;
  }

  const XhrProto = window.XMLHttpRequest?.prototype;
  if (XhrProto && !XhrProto.__qtsPatched) {
    const originalOpen = XhrProto.open;
    const originalSend = XhrProto.send;
    Object.defineProperty(XhrProto, "__qtsPatched", { value: true });
    XhrProto.open = function (method, url, ...rest) {
      this.__qtsMethod = method;
      this.__qtsUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    XhrProto.send = function (...args) {
      this.addEventListener("load", () => {
        try {
          const payload = typeof this.response === "object" && this.response !== null
            ? this.response
            : JSON.parse(this.responseText || "null");
          if (payload !== null) captureJsonPayload({ url: this.responseURL || this.__qtsUrl, method: this.__qtsMethod, status: this.status, source: "xhr", payload });
        } catch {
          // Non-JSON response bodies are not inspector material — ignored, not an error.
        }
      }, { once: true });
      return originalSend.apply(this, args);
    };
  }

  // ---------------------------------------------------------------------
  // Freeze Clock: reversible Date.now()/timer freeze, queuing timeouts
  // while frozen and flushing them on resume instead of dropping them.
  // ---------------------------------------------------------------------
  const OriginalDate = window.Date;
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalClearTimeout = window.clearTimeout.bind(window);
  let frozen = false;
  let frozenAt = OriginalDate.now();
  const pendingTimeouts = new Map();
  const cancelledTimeouts = new Set();

  function FrozenDate(...args) {
    if (!(this instanceof FrozenDate)) return new OriginalDate(frozen ? frozenAt : OriginalDate.now()).toString();
    const instance = args.length ? new OriginalDate(...args) : new OriginalDate(frozen ? frozenAt : OriginalDate.now());
    Object.setPrototypeOf(instance, FrozenDate.prototype);
    return instance;
  }
  FrozenDate.prototype = OriginalDate.prototype;
  Object.setPrototypeOf(FrozenDate, OriginalDate);
  FrozenDate.now = () => (frozen ? frozenAt : OriginalDate.now());
  FrozenDate.parse = OriginalDate.parse.bind(OriginalDate);
  FrozenDate.UTC = OriginalDate.UTC.bind(OriginalDate);
  window.Date = FrozenDate;

  window.setTimeout = function (callback, delay, ...args) {
    if (typeof callback !== "function") return originalSetTimeout(callback, delay, ...args);
    let timerId;
    const wrapped = () => {
      if (cancelledTimeouts.has(timerId)) return;
      if (frozen) { pendingTimeouts.set(timerId, () => { if (!cancelledTimeouts.has(timerId)) callback(...args); }); return; }
      callback(...args);
    };
    timerId = originalSetTimeout(wrapped, delay);
    return timerId;
  };
  window.clearTimeout = function (timerId) {
    cancelledTimeouts.add(timerId);
    pendingTimeouts.delete(timerId);
    return originalClearTimeout(timerId);
  };

  document.addEventListener(FREEZE_COMMAND_EVENT, (event) => {
    const shouldFreeze = Boolean(event.detail?.freeze);
    if (shouldFreeze && !frozen) {
      frozenAt = OriginalDate.now();
      frozen = true;
    } else if (!shouldFreeze && frozen) {
      frozen = false;
      const queued = [...pendingTimeouts.values()];
      pendingTimeouts.clear();
      queued.forEach((run) => originalSetTimeout(run, 0));
    }
    document.dispatchEvent(new CustomEvent(FREEZE_STATE_EVENT, { detail: { frozen } }));
  });

  // ---------------------------------------------------------------------
  // Force HTTP: arm the next matching fetch to return a chosen status once.
  // ---------------------------------------------------------------------
  document.addEventListener(FORCE_HTTP_COMMAND_EVENT, (event) => {
    const status = Number(event.detail?.status || 0);
    window.__qtsForcedStatus = status > 0 ? status : null;
    document.dispatchEvent(new CustomEvent(FORCE_HTTP_STATE_EVENT, { detail: { active: Boolean(window.__qtsForcedStatus) } }));
  });

  document.addEventListener("qts:pagebridge-ping", () => {
    document.dispatchEvent(new CustomEvent("qts:pagebridge-pong", { detail: { at: Date.now() } }));
  });
})();
