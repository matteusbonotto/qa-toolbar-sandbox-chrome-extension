// Runs in the page's MAIN world (world:"MAIN" in the dynamic content script
// registration in background.js), so it shares the real window/Date/fetch
// with the page - unlike the isolated-world toolbar script, which cannot see
// or patch these. Talks to the isolated world only through DOM CustomEvents
// (no shared JS globals exist between the two worlds), matching how
// Tampermonkey's own `window` (sandbox) vs `unsafeWindow` (real page) split
// worked in the original userscript.
(() => {
  if (window.__qtsPageBridgeInstalled) return;
  window.__qtsPageBridgeInstalled = true;
  let enabled = true;

  const NETWORK_EVENT = "qts:network-captured";
  const HTTP_ERROR_EVENT = "qts:http-error-captured";
  const FREEZE_COMMAND_EVENT = "qts:freeze-clock-command";
  const FREEZE_STATE_EVENT = "qts:freeze-clock-state";
  const FORCE_HTTP_COMMAND_EVENT = "qts:force-http-command";
  const FORCE_HTTP_STATE_EVENT = "qts:force-http-state";

  const MAX_PAYLOAD_CHARS = 200_000;
  const HISTORY_LIMIT = 150;
  // Named networkHistory, not history - this file runs in the page's real MAIN world, and a
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

  // Normalizes any of the three shapes fetch()/Request accept (Headers instance, [[k,v],...]
  // pairs, or a plain object) into a plain object - capped in count/length so a pathological
  // request can't bloat the captured entry. Returns null (not {}) when there's nothing to show,
  // so callers can cheaply skip building a headers block.
  function normalizeRequestHeaders(headersInit) {
    if (!headersInit) return null;
    try {
      const entries = headersInit instanceof Headers ? [...headersInit.entries()]
        : Array.isArray(headersInit) ? headersInit
          : Object.entries(headersInit);
      const result = {};
      for (const [key, value] of entries.slice(0, 40)) {
        if (typeof key !== "string" || !key) continue;
        result[key] = String(value ?? "").slice(0, 2_000);
      }
      return Object.keys(result).length ? result : null;
    } catch {
      return null;
    }
  }

  // Only string-shaped bodies (the common case for JSON/form APIs) are captured as text.
  // FormData/Blob/ArrayBuffer/ReadableStream bodies are skipped rather than guessed at, so a
  // reconstructed cURL command never silently sends the wrong bytes for a file upload.
  function stringifyRequestBody(body) {
    if (body == null) return null;
    if (typeof body === "string") return body.length > MAX_PAYLOAD_CHARS ? `${body.slice(0, MAX_PAYLOAD_CHARS)}…` : body;
    if (body instanceof URLSearchParams) return body.toString();
    return null;
  }

  function captureJsonPayload({ url, method, status, source, payload, requestHeaders, requestBody }) {
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
      requestHeaders: requestHeaders || null,
      requestBody: requestBody ?? null,
    });
  }

  // Body-format-agnostic at its core - unlike captureJsonPayload above, this fires even when the
  // body isn't JSON (plain-text/HTML error pages), so `payload` is optional: callers pass it when
  // they already have a parsed body (so Error Monitor can show the actual error message/raw JSON,
  // not just a bare status/URL), and omit it otherwise. Deliberately excludes Force HTTP's forced
  // responses: those are a QA tester deliberately simulating a status, not a real page error.
  function publishHttpError({ url, method, status, source, payload, requestHeaders, requestBody }) {
    if (!enabled || !(Number(status) >= 400)) return;
    let safePayload = null;
    let truncated = false;
    if (payload !== undefined && payload !== null) {
      const preview = safeStringifyPreview(payload);
      if (preview !== null) {
        truncated = preview.endsWith("…");
        try { safePayload = JSON.parse(truncated ? preview.slice(0, -1) : preview); } catch { safePayload = null; }
      }
    }
    document.dispatchEvent(new CustomEvent(HTTP_ERROR_EVENT, {
      detail: {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url: String(url || ""),
        method: String(method || "GET").toUpperCase(),
        status: Number(status),
        source,
        capturedAt: Date.now(),
        payload: safePayload,
        truncated,
        requestHeaders: requestHeaders || null,
        requestBody: requestBody ?? null,
      },
    }));
  }

  // ---------------------------------------------------------------------
  // Multi Testador consensus (Fase MT2, docs/adr/0003-multi-testador-sessao-colaborativa.md).
  // The isolated-world toolbar arms a mode with qts:mt-consensus-command:
  //  - "host": a risky request (POST/PUT/PATCH/DELETE) made while the page has transient user
  //    activation (navigator.userActivation.isActive, i.e. caused by a real click/Enter in the last
  //    few seconds) is HELD until the toolbar answers qts:mt-hold-decision with the room's
  //    consensus. A rejection makes it fail like a network error, never a silent success.
  //  - "guest": the same requests are refused outright (a guest never acts without the host). This
  //    is the backstop behind the toolbar's own click/submit interception.
  // Requests without a user gesture (polling, GraphQL queries sent as POST on load) are not an
  // action the tester performed and pass. Page scripts share this world and could dispatch these
  // events too, but only to affect their OWN requests, which they could send unpatched anyway.
  // ---------------------------------------------------------------------
  const MT_RISKY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  let mtMode = "off";
  // True only while the toolbar re-submits a form the room already approved (synchronous).
  let mtGrant = false;
  let mtSeq = 0;
  const mtPending = new Map();

  function mtShouldHold(method) {
    if (mtMode === "off" || mtGrant || !MT_RISKY_METHODS.has(String(method || "GET").toUpperCase())) return false;
    return navigator.userActivation ? navigator.userActivation.isActive : true;
  }

  // Safety net (B4): a hold the toolbar never answers (toolbar removed, extension reloaded mid-vote)
  // fails closed after the 60s vote timeout plus a 15s margin; nothing waits forever.
  const MT_HOLD_SAFETY_MS = 75_000;

  function mtSettleHold(id, approved) {
    const settle = mtPending.get(id);
    if (!settle) return false;
    mtPending.delete(id);
    settle(approved);
    return true;
  }

  // Resolves true when the request may go out. The promise carries its hold id (qtsHoldId) so an
  // abort can drop it.
  function mtAwaitConsensus(method, url) {
    const detail = { id: `h${Date.now().toString(36)}${(mtSeq += 1).toString(36)}`, method: String(method || "").toUpperCase(), url: String(url || "").slice(0, 500), mode: mtMode };
    if (mtMode === "guest") {
      document.dispatchEvent(new CustomEvent("qts:mt-hold-request", { detail }));
      const refused = Promise.resolve(false);
      refused.qtsHoldId = "";
      return refused;
    }
    let resolveHold;
    const promise = new Promise((resolve) => { resolveHold = resolve; });
    // originalSetTimeout: the page's timers may be frozen by Freeze Clock, this one must not be.
    const timer = originalSetTimeout(() => mtSettleHold(detail.id, false), MT_HOLD_SAFETY_MS);
    mtPending.set(detail.id, (approved) => { originalClearTimeout(timer); resolveHold(approved); });
    promise.qtsHoldId = detail.id;
    document.dispatchEvent(new CustomEvent("qts:mt-hold-request", { detail }));
    return promise;
  }

  document.addEventListener("qts:mt-hold-decision", (event) => {
    mtSettleHold(String(event.detail?.id || ""), event.detail?.approve === true);
  });

  function mtSetMode(mode) {
    mtMode = mode === "host" || mode === "guest" ? mode : "off";
    // Leaving host mode never releases what was waiting: the toolbar cancels the open vote first,
    // and anything still pending here fails closed.
    if (mtMode !== "host") {
      for (const id of [...mtPending.keys()]) mtSettleHold(id, false);
    }
  }

  document.addEventListener("qts:mt-consensus-command", (event) => {
    if (typeof event.detail?.grant === "boolean") { mtGrant = event.detail.grant; return; }
    mtSetMode(String(event.detail?.mode || "off"));
  });

  function mtFailXhr(xhr) {
    const defineOwn = (name, value) => Object.defineProperty(xhr, name, { value, configurable: true });
    defineOwn("readyState", 4);
    defineOwn("status", 0);
    xhr.dispatchEvent(new Event("readystatechange"));
    xhr.dispatchEvent(new ProgressEvent("error"));
    xhr.dispatchEvent(new ProgressEvent("loadend"));
  }

  // ---------------------------------------------------------------------
  // Network capture: fetch + XMLHttpRequest, JSON responses only.
  // ---------------------------------------------------------------------
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function" && !originalFetch.__qtsPatched) {
    const capturingFetch = function (...args) {
      if (!enabled) return originalFetch.apply(this, args);
      const requestIsRequestObject = typeof Request === "function" && args[0] instanceof Request;
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
      const method = args[1]?.method || (typeof args[0] === "object" ? args[0]?.method : undefined) || "GET";
      const requestHeaders = normalizeRequestHeaders(args[1]?.headers ?? (requestIsRequestObject ? args[0].headers : undefined));
      const requestBody = stringifyRequestBody(args[1]?.body);

      if (window.__qtsForcedStatus) {
        const forcedStatus = Number(window.__qtsForcedStatus);
        const forcedBodyRaw = window.__qtsForcedBody;
        window.__qtsForcedStatus = null;
        window.__qtsForcedBody = null;
        let forcedPayload = { forced: true, status: forcedStatus, requestUrl: String(requestUrl || "") };
        if (forcedBodyRaw) { try { forcedPayload = JSON.parse(forcedBodyRaw); } catch { /* falls back to the generic payload above */ } }
        captureJsonPayload({ url: requestUrl, method, status: forcedStatus, source: "forced", payload: forcedPayload, requestHeaders, requestBody });
        document.dispatchEvent(new CustomEvent(FORCE_HTTP_STATE_EVENT, { detail: { active: false } }));
        return Promise.resolve(new Response(JSON.stringify(forcedPayload), {
          status: forcedStatus,
          headers: { "content-type": "application/json", "x-qts-forced": "true" },
        }));
      }

      const result = originalFetch.apply(this, args);
      result.then((response) => {
        response.clone().json()
          .then((payload) => {
            captureJsonPayload({ url: response.url || requestUrl, method, status: response.status, source: "fetch", payload, requestHeaders, requestBody });
            publishHttpError({ url: response.url || requestUrl, method, status: response.status, source: "fetch", payload, requestHeaders, requestBody });
          })
          .catch(() => publishHttpError({ url: response.url || requestUrl, method, status: response.status, source: "fetch", requestHeaders, requestBody }));
      }).catch(() => {});
      return result;
    };
    const patchedFetch = function (...args) {
      const method = args[1]?.method || (typeof args[0] === "object" ? args[0]?.method : undefined) || "GET";
      if (!mtShouldHold(method)) return capturingFetch.apply(this, args);
      // An AbortSignal is honored while held, exactly like a native fetch in flight (M1).
      const signal = args[1]?.signal ?? (typeof Request === "function" && args[0] instanceof Request ? args[0].signal : undefined);
      const abortReason = () => signal?.reason ?? new DOMException("The user aborted a request.", "AbortError");
      if (signal?.aborted) return Promise.reject(abortReason());
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url ?? String(args[0] ?? "");
      const hold = mtAwaitConsensus(method, requestUrl);
      return new Promise((resolve, reject) => {
        const onAbort = () => { mtSettleHold(hold.qtsHoldId, false); reject(abortReason()); };
        signal?.addEventListener?.("abort", onAbort, { once: true });
        hold.then((approved) => {
          signal?.removeEventListener?.("abort", onAbort);
          if (signal?.aborted) return;
          if (!approved) { reject(new TypeError("Failed to fetch (blocked by QA Toolbar Sandbox Multi Testador: no consensus)")); return; }
          try { resolve(capturingFetch.apply(this, args)); } catch (error) { reject(error); }
        });
      });
    };

    Object.defineProperty(patchedFetch, "__qtsPatched", { value: true });
    window.fetch = patchedFetch;
  }

  const XhrProto = window.XMLHttpRequest?.prototype;
  if (XhrProto && !XhrProto.__qtsPatched) {
    const originalOpen = XhrProto.open;
    const originalSend = XhrProto.send;
    const originalAbort = XhrProto.abort;
    const originalSetRequestHeader = XhrProto.setRequestHeader;
    // Own properties this file may define on an instance (Force HTTP, a refused hold); a new open()
    // removes them so the native getters answer again.
    const OWN_XHR_PROPS = ["readyState", "status", "statusText", "response", "responseText", "responseURL", "getAllResponseHeaders", "getResponseHeader"];
    const defineOwn = (xhr, name, value) => Object.defineProperty(xhr, name, { value, configurable: true });
    Object.defineProperty(XhrProto, "__qtsPatched", { value: true });
    XhrProto.open = function (method, url, ...rest) {
      // open() while a send is held drops it silently, like a native open() terminating a request (M1).
      const heldId = this.__qtsHoldId;
      this.__qtsHoldId = null;
      if (heldId) mtSettleHold(heldId, false);
      for (const name of OWN_XHR_PROPS) if (Object.prototype.hasOwnProperty.call(this, name)) delete this[name];
      this.__qtsMethod = method;
      this.__qtsUrl = url;
      this.__qtsHeaders = null;
      // open(method, url) is async; open(method, url, async) follows the boolean conversion.
      this.__qtsAsync = rest.length === 0 || Boolean(rest[0]);
      return originalOpen.call(this, method, url, ...rest);
    };
    XhrProto.abort = function (...args) {
      const heldId = this.__qtsHoldId;
      if (!heldId) return originalAbort.apply(this, args);
      // Aborting a held send: never sent; mirrors a native abort of a request in flight (state DONE,
      // abort and loadend events, then UNSENT).
      this.__qtsHoldId = null;
      mtSettleHold(heldId, false);
      defineOwn(this, "readyState", 4);
      defineOwn(this, "status", 0);
      this.dispatchEvent(new Event("readystatechange"));
      this.dispatchEvent(new ProgressEvent("abort"));
      this.dispatchEvent(new ProgressEvent("loadend"));
      defineOwn(this, "readyState", 0);
      return undefined;
    };
    XhrProto.setRequestHeader = function (name, value) {
      (this.__qtsHeaders ??= {})[name] = value;
      return originalSetRequestHeader.call(this, name, value);
    };
    XhrProto.send = function (...args) {
      // A second send() while one is held is the same error the browser throws for a send in flight.
      if (this.__qtsHoldId) throw new DOMException("Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED.", "InvalidStateError");
      if (!mtShouldHold(this.__qtsMethod)) return capturingSend.apply(this, args);
      if (this.__qtsAsync === false) {
        // A synchronous XHR cannot wait for a vote without freezing the page: refused (fails closed).
        document.dispatchEvent(new CustomEvent("qts:mt-hold-request", { detail: { id: "", sync: true, mode: mtMode } }));
        throw new DOMException("Blocked by QA Toolbar Sandbox Multi Testador: a synchronous request cannot wait for consensus", "NetworkError");
      }
      const hold = mtAwaitConsensus(this.__qtsMethod, this.__qtsUrl);
      const heldId = hold.qtsHoldId;
      this.__qtsHoldId = heldId;
      hold.then((approved) => {
        // Dropped by abort()/open() meanwhile: nothing to do.
        if (this.__qtsHoldId !== heldId) return;
        this.__qtsHoldId = null;
        if (!approved) { mtFailXhr(this); return; }
        try { capturingSend.apply(this, args); } catch { mtFailXhr(this); }
      });
      return undefined;
    };

    const capturingSend = function (...args) {
      if (!enabled) return originalSend.apply(this, args);
      const requestHeaders = this.__qtsHeaders && Object.keys(this.__qtsHeaders).length ? this.__qtsHeaders : null;
      const requestBody = stringifyRequestBody(args[0]);
      // Force HTTP previously only ever armed window.fetch - on any site whose HTTP client uses
      // XMLHttpRequest under the hood (Angular's HttpClient by default, many jQuery/legacy stacks),
      // the button visibly did nothing. This mirrors the fetch branch above: consume the armed
      // status, never call the real send(), and simulate the XHR completion lifecycle instead.
      if (window.__qtsForcedStatus) {
        const forcedStatus = Number(window.__qtsForcedStatus);
        const forcedBodyRaw = window.__qtsForcedBody;
        window.__qtsForcedStatus = null;
        window.__qtsForcedBody = null;
        document.dispatchEvent(new CustomEvent(FORCE_HTTP_STATE_EVENT, { detail: { active: false } }));
        let forcedPayload = { forced: true, status: forcedStatus, requestUrl: String(this.__qtsUrl || "") };
        if (forcedBodyRaw) { try { forcedPayload = JSON.parse(forcedBodyRaw); } catch { /* falls back to the generic payload above */ } }
        const forcedBody = JSON.stringify(forcedPayload);
        const defineOwn = (name, value) => Object.defineProperty(this, name, { value, configurable: true });
        defineOwn("readyState", 4);
        defineOwn("status", forcedStatus);
        defineOwn("statusText", "Forced by QA Toolbar Sandbox");
        defineOwn("response", forcedBody);
        defineOwn("responseText", forcedBody);
        defineOwn("responseURL", String(this.__qtsUrl || ""));
        this.getAllResponseHeaders = () => "content-type: application/json\r\nx-qts-forced: true\r\n";
        this.getResponseHeader = (name) => (String(name || "").toLowerCase() === "content-type" ? "application/json" : null);
        captureJsonPayload({ url: this.__qtsUrl, method: this.__qtsMethod, status: forcedStatus, source: "forced", payload: forcedPayload, requestHeaders, requestBody });
        window.setTimeout(() => {
          this.dispatchEvent(new Event("readystatechange"));
          this.dispatchEvent(new Event("load"));
          this.dispatchEvent(new Event("loadend"));
        }, 0);
        return undefined;
      }
      this.addEventListener("load", () => {
        let payload = null;
        try {
          payload = typeof this.response === "object" && this.response !== null
            ? this.response
            : JSON.parse(this.responseText || "null");
        } catch {
          // Non-JSON response bodies are not inspector material - ignored, not an error.
        }
        publishHttpError({ url: this.responseURL || this.__qtsUrl, method: this.__qtsMethod, status: this.status, source: "xhr", payload: payload ?? undefined, requestHeaders, requestBody });
        if (payload !== null) captureJsonPayload({ url: this.responseURL || this.__qtsUrl, method: this.__qtsMethod, status: this.status, source: "xhr", payload, requestHeaders, requestBody });
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
  // callback while frozen (the real interval keeps running underneath) - queuing-and-replaying
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

  // Countdown/progress UI on modern checkout pages is often driven by requestAnimationFrame
  // instead of setInterval (smoother updates) - same "skip the tick while frozen, let it resume
  // on the next real frame" treatment as setInterval above, so those don't silently keep ticking.
  // Returns our own id (not the native one), since the underlying native frame gets re-armed on
  // every skipped tick while frozen and callers must still be able to cancel the *current* one.
  const originalRAF = window.requestAnimationFrame?.bind(window);
  const originalCAF = window.cancelAnimationFrame?.bind(window);
  if (originalRAF && originalCAF) {
    let rafSeq = 0;
    const rafState = new Map();
    window.requestAnimationFrame = function (callback) {
      if (typeof callback !== "function") return originalRAF(callback);
      const ourId = ++rafSeq;
      const entry = { cancelled: false, nativeId: null };
      rafState.set(ourId, entry);
      const wrapped = (time) => {
        if (entry.cancelled) return;
        if (frozen) { entry.nativeId = originalRAF(wrapped); return; }
        rafState.delete(ourId);
        callback(time);
      };
      entry.nativeId = originalRAF(wrapped);
      return ourId;
    };
    window.cancelAnimationFrame = function (ourId) {
      const entry = rafState.get(ourId);
      if (!entry) return;
      entry.cancelled = true;
      if (entry.nativeId != null) originalCAF(entry.nativeId);
      rafState.delete(ourId);
    };
  }

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
    // Optional custom JSON so the forced response can match the real shape the page's own error
    // handling expects (a message/code the app actually reads), not just a generic placeholder.
    window.__qtsForcedBody = window.__qtsForcedStatus && event.detail?.body ? String(event.detail.body) : null;
    document.dispatchEvent(new CustomEvent(FORCE_HTTP_STATE_EVENT, { detail: { active: Boolean(window.__qtsForcedStatus) } }));
  });

  document.addEventListener("qts:pagebridge-ping", () => {
    document.dispatchEvent(new CustomEvent("qts:pagebridge-pong", { detail: { at: Date.now() } }));
  });

  // ---------------------------------------------------------------------
  // Action trace (Click Spy "Execute and observe"): fetch/XHR are already
  // observable via qts:network-captured above, and SPA navigation via
  // qts:location-change below - window.open is the one primitive with no
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
      window.__qtsForcedBody = null;
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
    mtSetMode("off");
    window.__qtsForcedStatus = null;
    window.__qtsForcedBody = null;
  });
})();
