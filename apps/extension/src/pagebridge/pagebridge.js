// Runs in the page's MAIN world (declared via world:"MAIN" in the dynamic
// content script registration in background.js), so it shares the real
// window/Date/fetch with the page — unlike the isolated-world toolbar
// script. Network interception, Freeze Clock and Force HTTP land here in a
// later iteration; for now this only proves the MAIN-world bridge itself
// works, via a DOM CustomEvent channel (postMessage-safe, no shared JS
// globals between the two worlds).
(() => {
  if (window.__qtsPageBridgeInstalled) return;
  window.__qtsPageBridgeInstalled = true;

  document.addEventListener("qts:pagebridge-ping", () => {
    document.dispatchEvent(new CustomEvent("qts:pagebridge-pong", { detail: { at: Date.now() } }));
  });
})();
