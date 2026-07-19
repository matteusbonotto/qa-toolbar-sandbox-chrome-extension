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
  let enabled = true;

  const NETWORK_EVENT = "qts:network-captured";
  const FREEZE_COMMAND_EVENT = "qts:freeze-clock-command";
  const FREEZE_STATE_EVENT = "qts:freeze-clock-state";
  const FORCE_HTTP_COMMAND_EVENT = "qts:force-http-command";
  const FORCE_HTTP_STATE_EVENT = "qts:force-http-state";

  const MAX_PAYLOAD_CHARS = 200_000;
  const HISTORY_LIMIT = 150;
  // Named networkHistory, not history — this file runs in the page's real MAIN world, and a
  // local `history` binding would shadow window.history for the rest of this scope, silently
  // breaking the pushState/replaceState patch further below (it did, until this rename).
  const networkHistory = [];

  function safeStringifyPreview(value) {
    try {
      const text = JSON.stringify(value);
      return text.length > MAX_PAYLOAD_CHARS ? `${text.slice(0, MAX_PAYLOAD_CHARS)}…` : text;
    } catch {
      return null;
    }
  }

  function publishCapture(entry) {
    if (!enabled) return;
    networkHistory.unshift(entry);
    if (networkHistory.length > HISTORY_LIMIT) networkHistory.length = HISTORY_LIMIT;
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
      if (!enabled) return originalFetch.apply(this, args);
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
      if (!enabled) return originalSend.apply(this, args);
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
  const originalSetInterval = window.setInterval.bind(window);
  const originalClearInterval = window.clearInterval.bind(window);
  let frozen = false;
  let frozenAt = OriginalDate.now();
  const pendingTimeouts = new Map();
  const cancelledTimeouts = new Set();
  const cancelledIntervals = new Set();

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

  // Intervals repeat on their own schedule, so freezing them just means skipping the tick's
  // callback while frozen (the real interval keeps running underneath) — queuing-and-replaying
  // like setTimeout would fire a burst of missed ticks all at once on resume.
  window.setInterval = function (callback, delay, ...args) {
    if (typeof callback !== "function") return originalSetInterval(callback, delay, ...args);
    let timerId;
    const wrapped = () => {
      if (cancelledIntervals.has(timerId) || frozen) return;
      callback(...args);
    };
    timerId = originalSetInterval(wrapped, delay);
    return timerId;
  };
  window.clearInterval = function (timerId) {
    cancelledIntervals.add(timerId);
    return originalClearInterval(timerId);
  };

  document.addEventListener(FREEZE_COMMAND_EVENT, (event) => {
    if (!enabled) return;
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
    if (!enabled) return;
    const status = Number(event.detail?.status || 0);
    window.__qtsForcedStatus = status > 0 ? status : null;
    document.dispatchEvent(new CustomEvent(FORCE_HTTP_STATE_EVENT, { detail: { active: Boolean(window.__qtsForcedStatus) } }));
  });

  document.addEventListener("qts:pagebridge-ping", () => {
    document.dispatchEvent(new CustomEvent("qts:pagebridge-pong", { detail: { at: Date.now() } }));
  });

  // ---------------------------------------------------------------------
  // Action trace (Click Spy "Execute and observe"): fetch/XHR are already
  // observable via qts:network-captured above, and SPA navigation via
  // qts:location-change below — window.open is the one primitive with no
  // existing event, so it's the only thing this patches, only while armed.
  // ---------------------------------------------------------------------
  let originalWindowOpen = null;
  document.addEventListener("qts:action-trace-command", (event) => {
    if (!enabled) return;
    if (event.detail?.active) {
      if (originalWindowOpen) return;
      originalWindowOpen = window.open;
      window.open = function (...args) {
        document.dispatchEvent(new CustomEvent("qts:action-trace-event", { detail: { kind: "open", url: String(args[0] || "") } }));
        return originalWindowOpen.apply(this, args);
      };
    } else if (originalWindowOpen) {
      window.open = originalWindowOpen;
      originalWindowOpen = null;
    }
  });

  const publishLocation = () => document.dispatchEvent(new CustomEvent("qts:location-change", { detail: { href: location.href } }));
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      publishLocation();
      return result;
    };
  }
  window.addEventListener("popstate", publishLocation);
  window.addEventListener("hashchange", publishLocation);

  document.addEventListener("qts:pagebridge-active", (event) => {
    enabled = event.detail?.active === true;
    if (!enabled) {
      window.__qtsForcedStatus = null;
      if (originalWindowOpen) { window.open = originalWindowOpen; originalWindowOpen = null; }
      if (frozen) {
        frozen = false;
        const queued = [...pendingTimeouts.values()];
        pendingTimeouts.clear();
        queued.forEach((run) => originalSetTimeout(run, 0));
      }
    }
  });
  document.addEventListener("qts:pagebridge-disable", () => {
    enabled = false;
    window.__qtsForcedStatus = null;
  });
})();
