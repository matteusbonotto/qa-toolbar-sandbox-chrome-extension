// Breakpoint Viewer phone emulation, page side. Registered by background.js (MOBILE_EMULATION_SCRIPT_ID)
// in the MAIN world at document_start with allFrames, so inside the phone iframe it runs before any
// of the site's own scripts and can patch the real navigator/screen/matchMedia they read. Every
// other frame (the tested page itself, laptop/tablet panes, unrelated embeds) lacks the marker that
// toolbar.js only adds to the phone pane's URL, and this exits on the first line there.
// The request headers half (User-Agent and client hints sent to the server) is the session DNR
// rule in background.js; this file only covers what the page's JavaScript can observe.
(() => {
  if (!/[?&]__qtsbpua=1(?:&|$)/.test(window.location.search)) return;

  // Same string as MOBILE_EMULATION_HEADERS in background.js (Chrome's reduced Android UA with the
  // real Chrome major): keep both in sync so the server and the page see one coherent device.
  const chromeMajor = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] || "141";
  const userAgent = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36`;
  const appVersion = userAgent.replace(/^Mozilla\//, "");

  const defineGetter = (target, property, value) => {
    try { Object.defineProperty(target, property, { configurable: true, get: () => value }); } catch {}
  };

  defineGetter(navigator, "userAgent", userAgent);
  defineGetter(navigator, "appVersion", appVersion);
  defineGetter(navigator, "platform", "Linux armv81");
  defineGetter(navigator, "maxTouchPoints", 5);

  // Low-entropy client hints only (mobile/platform), matching the sec-ch-ua-* headers. Brands keep
  // the real values; high-entropy values (model, platformVersion...) are not emulated.
  const realUserAgentData = navigator.userAgentData;
  if (realUserAgentData) {
    const emulatedUserAgentData = {
      brands: realUserAgentData.brands,
      mobile: true,
      platform: "Android",
      getHighEntropyValues: (hints) => realUserAgentData.getHighEntropyValues(hints).then((values) => ({ ...values, mobile: true, platform: "Android" })),
      toJSON: () => ({ brands: realUserAgentData.brands, mobile: true, platform: "Android" }),
    };
    defineGetter(navigator, "userAgentData", emulatedUserAgentData);
  }

  // The iframe already has the device's real CSS size (toolbar.js buildDeviceFrameHtml), so the
  // viewport at document_start is the device screen. Sites that branch on screen.width would
  // otherwise see the tester's desktop monitor.
  const screenWidth = window.innerWidth || 390;
  const screenHeight = window.innerHeight || 844;
  defineGetter(screen, "width", screenWidth);
  defineGetter(screen, "height", screenHeight);
  defineGetter(screen, "availWidth", screenWidth);
  defineGetter(screen, "availHeight", screenHeight);

  // `"ontouchstart" in window` is a common touch-device check.
  if (!("ontouchstart" in window)) {
    try { window.ontouchstart = null; } catch {}
  }

  // Rewrites only the pointer/hover features of a query into conditions that always hold (or never
  // hold) inside the iframe, so `(pointer: coarse)` and `(hover: none)` match like on a phone while
  // width/orientation features keep their real behavior. The iframe is never 0px wide, which is what
  // makes the two stand-ins reliable.
  const ALWAYS = "(min-width: 0px)";
  const NEVER = "(max-width: 0px)";
  const rewriteQuery = (query) => String(query)
    .replace(/\(\s*(?:any-)?pointer\s*:\s*coarse\s*\)/gi, ALWAYS)
    .replace(/\(\s*(?:any-)?pointer\s*:\s*(?:fine|none)\s*\)/gi, NEVER)
    .replace(/\(\s*(?:any-)?pointer\s*\)/gi, ALWAYS)
    .replace(/\(\s*(?:any-)?hover\s*:\s*none\s*\)/gi, ALWAYS)
    .replace(/\(\s*(?:any-)?hover\s*:\s*hover\s*\)/gi, NEVER)
    .replace(/\(\s*(?:any-)?hover\s*\)/gi, NEVER);
  const realMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = function matchMedia(query) {
    const result = realMatchMedia(rewriteQuery(query));
    // Callers compare .media against what they passed in; report the original query back.
    defineGetter(result, "media", String(query));
    return result;
  };
})();
