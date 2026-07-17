# QA Toolbar Sandbox

Ground-up rebuild started 2026-07-16. The extension is now a direct, plain
HTML/CSS/JS Manifest V3 conversion of the Tampermonkey userscript — no
bundler, no framework, no hardcoded product data. See
[`apps/extension/README.md`](apps/extension/README.md) for how it's built and
why, and [`docs/handoff/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md`](docs/handoff/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md)
for the full product spec this rebuild follows.

The previous implementation (React/TypeScript/WXT extension, landing page,
admin panel, Supabase backend) is preserved for reference in
[`old_codex/`](old_codex/README.md) — nothing from it is reused.

## What exists so far

- `apps/extension/` — the extension core: manifest, storage layer, windowsill
  toolbar with environment-aware coloring, generic workspace data model
  (clients/projects/products/environments — no hardcoded example data),
  import/export, and a site-scope setting (runs everywhere by default,
  restrict from the options page).

Landing page, admin panel and backend are being rebuilt next; this file will
grow as each lands.

## Load and verify the extension

```
chrome://extensions → Developer mode → Load unpacked → apps/extension
```

Or drive it automatically in a real (non-headless) Chromium via Playwright:

```bash
npm install
npm run test:chrome
```

## Security scan

```bash
npm run security:repo
```

Scans every tracked/staged file for secret patterns and forbidden paths
before commit (also wired as the pre-commit hook via `npm run prepare`).
