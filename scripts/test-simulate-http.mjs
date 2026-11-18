// Regression for Simulate HTTP (pagebridge.js): the rule must hit the chosen URL, skip telemetry,
// honor the use count and survive a "reload" (sessionStorage). Runs the real MAIN-world script in a stub window.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const code = await readFile(new URL("../apps/extension/src/pagebridge/pagebridge.js", import.meta.url), "utf8");
const store = new Map();
function boot() {
  const doc = new EventTarget();
  const states = [];
  doc.addEventListener("qts:force-http-state", (e) => states.push(e.detail));
  const calls = [];
  const win = {
    document: doc, sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    fetch: (url) => { calls.push(String(url)); return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })); },
    addEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    location: { href: "https://x.test/" }, history: { pushState() {}, replaceState() {} }, XMLHttpRequest: class {}, Date, Response, Request: class {}, CustomEvent, Event, console,
  };
  win.window = win; win.self = win;
  const ctx = vm.createContext({ ...win, window: win, document: doc, CustomEvent, Event, Response, EventTarget, console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Object, Number, String, Boolean, Math, Date, Map, Set, RegExp, Array, Error, TypeError, Reflect, Proxy, Symbol, WeakMap, ProgressEvent: class {}, DOMException: class {}, URL, Request: class {} });
  vm.runInContext(code, ctx);
  return { doc, win: ctx.window, states, calls };
}
const arm = (doc, detail) => doc.dispatchEvent(new CustomEvent("qts:force-http-command", { detail }));
const status = async (win, url) => (await win.fetch(url)).status;

let { doc, win, states } = boot();
arm(doc, { status: 500, times: 1 });
assert.equal(await status(win, "https://x.test/events?x=1"), 200, "telemetry is skipped without a filter");
assert.equal(await status(win, "https://x.test/api/cinema/movies"), 500, "first app call is forced");
assert.equal(await status(win, "https://x.test/api/cinema/movies"), 200, "rule used once is consumed");
assert.equal(states.at(-1).active, false);

arm(doc, { status: 503, filter: "api/get-features", times: 2 });
assert.equal(await status(win, "https://x.test/api/cinema/movies"), 200, "filter ignores other URLs");
assert.equal(await status(win, "https://x.test/api/get-features"), 503);
assert.equal(await status(win, "https://x.test/api/get-features"), 503);
assert.equal(await status(win, "https://x.test/api/get-features"), 200);

arm(doc, { status: 500, filter: "/movies$/", times: 0, persist: true });
assert.equal(await status(win, "https://x.test/api/movies"), 500);
assert.equal(await status(win, "https://x.test/api/movies"), 500, "until cancelled keeps firing");
({ doc, win, states } = boot()); // reload
doc.dispatchEvent(new CustomEvent("qts:force-http-query"));
assert.equal(states.at(-1).active, true, "persisted rule is restored after reload");
assert.equal(await status(win, "https://x.test/api/movies"), 500);
arm(doc, { status: null });
assert.equal(await status(win, "https://x.test/api/movies"), 200, "cancel clears it");
console.log("simulate-http ok");
