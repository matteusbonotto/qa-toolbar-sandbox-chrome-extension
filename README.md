# QA Toolbar Sandbox

Local-first QA toolbar for Chrome (Manifest V3), plus a SaaS landing page, founder admin
panel and Supabase backend for billing/entitlements. Ground-up rebuild started 2026-07-16 as
a direct conversion of the original Tampermonkey userscript.

- [`apps/extension/`](apps/extension/README.md) — the extension: manifest, storage layer,
  environment-aware toolbar, workspace CRUD (clients/projects/products/environments/test
  accounts/macros), the QA productivity kit (Character Counter, Multiclick, Input Lab, Faker
  Fill, Macro Studio, Key View), all gated per plan via `plan_features`.
- `apps/landing/` — the marketing site, pricing/checkout, and account flows (sign up, sign in,
  forgot/reset password).
- `apps/admin/` — founder-only dashboard (vouchers, licenses, users, entitlements, feature
  flags, MRR). Password + e-mail OTP; no public self-signup — see
  [`supabase/bootstrap-admin-account.mjs`](supabase/bootstrap-admin-account.mjs).
- `supabase/` — schema, migrations, Edge Functions, and the local-only provisioning/seed
  scripts (never run by CI, always by a human with the service-role key).
- `docs/` — start at [`docs/ecosystem-audit.md`](docs/ecosystem-audit.md) for the map of all
  three apps, then [`docs/architecture.md`](docs/architecture.md) for stack/folder layout.
  Reference docs per topic: [`permissions`](docs/permissions.md),
  [`security`](docs/security.md), [`plans`](docs/plans.md),
  [`integrations`](docs/integrations.md), [`analytics`](docs/analytics.md),
  [`migration-strategy`](docs/migration-strategy.md),
  [`testing-strategy`](docs/testing-strategy.md),
  [`release-checklist`](docs/release-checklist.md). Per-decision ADRs live in `docs/adr/`, the
  QA tools guide in `docs/GUIA_FERRAMENTAS_QA.md`, and `docs/PENDENCIAS_USUARIO.md` tracks
  anything only the founder can action.

The original rebuild spec and its completion checklist are archived (fully executed, kept for
historical rationale, not a live plan) at
[`docs/handoff/archive/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md`](docs/handoff/archive/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md)
and
[`docs/handoff/archive/CHECKLIST_RECONSTRUCAO.md`](docs/handoff/archive/CHECKLIST_RECONSTRUCAO.md).
For current, actively-tracked work see `docs/CHECKLIST_BUGFIX_PASS2.md`,
`docs/CHECKLIST_OPTIONS_OVERHAUL.md` and `docs/PENDENCIAS_USUARIO.md`.

## Load and verify the extension

```
chrome://extensions → Developer mode → Load unpacked → apps/extension
```

Or drive it automatically in a real (non-headless) Chromium via Playwright:

```bash
npm install
npm run test:chrome
```

For interactive local testing against the real backend (not the mocked smoke-test flow):

```bash
npm run dev:extension
```

## Landing page / admin

```bash
npm run dev:landing
npm run dev:admin
```

## Security scan

```bash
npm run security:repo
npm run security:extension
```

Scans every tracked/staged file for secret patterns and forbidden paths before commit (also
wired as the pre-commit hook via `npm run prepare`), and verifies the packaged extension only
contains the whitelisted files.
