# QA Toolbar Sandbox — extension (vanilla HTML/CSS/JS, Manifest V3)

Direct conversion of the Tampermonkey userscript (`tampermonkey.js`, kept locally,
gitignored) into a real Chrome extension: no bundler, no framework, no build
step. Every hardcoded, product-specific value from the userscript (countries,
payment defaults, `get-candy`-style inspectors) is gone — the workspace starts
empty and everything is either configured by hand in the options page or
imported from a JSON file.

## Load it for real

1. `chrome://extensions` → enable "Developer mode" → "Load unpacked" → select
   this `apps/extension` folder.
2. Open any website. The toolbar bar appears at the top by default (no
   configuration needed) — that's the point: it's usable everywhere out of
   the box, and you narrow it from **Configurações → Onde a barra aparece**.

Automated proof instead of manual clicking: `npm run test:chrome` from the
repo root drives a real (non-headless) Chromium via Playwright with this
extension loaded, confirms the toolbar mounts on an arbitrary page with zero
configuration, and exercises the options page workspace CRUD. Screenshots
land in `artifacts/runtime-evidence/` (gitignored).

## Why it's built this way

- **No static `content_scripts` in the manifest.** Where the toolbar runs is
  a user setting (`qtsSiteScopeV1` in `chrome.storage.local`), so
  `src/background/background.js` registers/unregisters content scripts at
  runtime via `chrome.scripting.registerContentScripts`, defaulting to
  `<all_urls>`. It also proactively injects into already-open tabs after a
  fresh install or a scope change — dynamic registration alone only affects
  *future* navigations, so without this a tab open at install time would
  need a manual reload before the toolbar showed up.
- **Two JS worlds, like Tampermonkey's `window` vs `unsafeWindow`.** The
  toolbar UI runs in the isolated world (`src/toolbar/toolbar.js`). Anything
  that needs to see the page's *real* `window`/`fetch`/`Date` (Freeze Clock,
  Force HTTP, network capture — ported in a later iteration) runs in
  `src/pagebridge/pagebridge.js`, registered with `world: "MAIN"`. The two
  communicate through `document.dispatchEvent(new CustomEvent(...))`, since
  they don't share JS globals.
- **No ES modules in content scripts.** `chrome.scripting.registerContentScripts`
  does not support top-level `import`/`export` the way the module-typed
  background service worker does. `src/lib/storage-content.js` is a classic
  script exposing `window.QTS_STORAGE`, loaded before `toolbar.js` in the
  same registration so both share one execution context — the same pattern
  Tampermonkey's own IIFE style already used.
- **Open, not closed, Shadow DOM.** A closed shadow root blocks `element.shadowRoot`
  from *any* caller, including QA/automation tooling trying to assert on the
  toolbar's own contents — actively hostile to a QA tool. Isolation from the
  host page's CSS/JS doesn't require secrecy from the extension's own tests.
- **`chrome.storage.local`, never page `localStorage`, for the workspace.**
  Page `localStorage` is isolated per origin — a userscript's `GM_getValue`
  is shared across every matched site, but a content script's `window.localStorage`
  is the *page's* storage. Only `chrome.storage.local` is extension-scoped
  and follows the user from site to site.
- **i18n as a classic-script dictionary, not `chrome.i18n` messages.json.**
  `src/lib/i18n-content.js` mirrors the `window.QTS_STORAGE` pattern: a
  `window.QTS_I18N` dictionary for pt-BR/es/en, with the active locale stored
  under `qtsLocale` in `chrome.storage.local` (independent from the workspace
  key so it survives a workspace reset). `chrome.i18n`'s built-in
  `messages.json` mechanism only follows the *browser's* UI language and can't
  be switched from inside the extension's own UI — this needed a picker in
  the options page, so a small custom dictionary made more sense than fighting
  that constraint. The toolbar (`toolbar.js`) reads `state.t` once at boot;
  a locale change from Options takes effect on next reload of the page, the
  same trade-off already accepted for site-scope changes.

## Status

Core (this iteration): manifest, storage layer, windowsill toolbar with
environment-aware coloring, workspace data model (clients/projects/products/
environments), import/export, site-scope setting. Evidence recording, Test
Status/markers, inspectors, JSON Studio, Breakpoint Viewer, Click Spy, Freeze
Clock and HTTP Controls are being ported next, each with the same bar: real
Chrome verification before it's called done.
