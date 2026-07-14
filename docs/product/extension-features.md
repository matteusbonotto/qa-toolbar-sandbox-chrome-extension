# Extension feature guide

## Workspace and toolbar

The schema-v2 workspace supports clients, projects, products, environments, account types, test accounts, sandbox payment methods, APIs, inspectors, resources, tags, status, ordering and multiple validated images. The options page provides create, edit, duplicate, enable/disable, delete, search, filter and reorder actions. Data remains in `browser.storage.local` by default.

The toolbar runs in Shadow DOM. URL rules choose the active environment, pinned tools are persisted and reorderable, and only the first four pinned actions stay in the compact bar; the Tools menu remains the overflow source of truth.

## Evidence and recording

- Test Status stores Pass, Fail, Block and Limitation with URL and timestamp.
- Screenshot uses `captureVisibleTab` after explicit interaction.
- Recording selects a valid MP4 MIME type when the browser exposes one and falls back to WebM without relabeling the file.
- Pause, resume, stop, track cleanup and local download are supported.
- Notes and shapes are local overlays and can be removed individually.

## Convertio and GIF

The user supplies a personal Convertio key. It is masked, stored locally, excluded from safe exports and sent only to Convertio after explicit GIF action and first-use consent. Upload, progressive polling, download, cancellation, limited retry and remote cleanup use `AbortController`. Costs and provider limits belong to the user's Convertio account.

## Network and JSON

PerformanceObserver records bounded resource metadata. Payload capture is opt-in and installs a nonce-bound MAIN-world bridge for Fetch/XHR. Payload size, object depth, array size and property count are bounded; credential-like keys are redacted. Inspectors display only configured endpoints. JSON Studio formats, compacts, searches, compares, copies and exports captured JSON.

Freeze Clock and forced Fetch responses are explicit, tab-scoped and reversible. Forced responses affect Fetch patterns only; native XHR is intentionally not replaced because that would be substantially more invasive.

## Breakpoint Viewer

Eight editable presets, custom sizes, orientation, zoom, frames, favorites, reorder, single/dual view, independent URLs, reload, external opening and individual/comparative screenshots are supported. Scroll sync works only when same-origin access is permitted. CSP and `X-Frame-Options` are never bypassed.
