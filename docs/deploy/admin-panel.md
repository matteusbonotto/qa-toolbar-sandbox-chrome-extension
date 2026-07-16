# Admin panel (`apps/admin`) deployment guide

The admin panel is a separate Vite/React app from the public landing page,
served under the same GitHub Pages site at `/admin/` (see
`.github/workflows/landing-pages.yml`). It shares the landing page's
Supabase project and browser-safe env vars (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`) — no new GitHub Actions repository
variables are required.

## Required one-time manual steps (cannot be automated from this repo)

### 1. Enable Google as a Supabase Auth provider

The admin panel authenticates exclusively via Google OAuth through Supabase
Auth. In the Supabase Dashboard:

1. Create an OAuth 2.0 Client ID in Google Cloud Console (type: Web
   application). Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In Supabase Dashboard → Authentication → Providers → Google, paste the
   Client ID and Client Secret, enable the provider.
3. Confirm `additional_redirect_urls` in `supabase/config.toml` already
   covers the Pages origin as a wildcard
   (`https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/**`) —
   it does, so `/admin/` needs no extra entry.

Without this step, clicking "Entrar com Google" in the admin panel will
fail with a provider-not-enabled error from Supabase — this is expected
until the manual configuration above is completed.

### 2. Apply the `admin_panel_foundation` migration

```
supabase db push
```

This migration (`supabase/migrations/20260716090000_admin_panel_foundation.sql`):

- Fixes `bootstrap_founder` to also require the target account's verified
  e-mail to match the single authorized founder identity
  (`matteusbonotto+qa@gmail.com`, per `docs/handoff/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md`).
  **If that e-mail is not exactly correct for your Google account, edit the
  migration before applying it** — founder bootstrap only succeeds once
  (enforced by the migration itself), so getting the wrong e-mail baked in
  means editing the function directly in the database afterward.
- Adds `plan_prices` (admin-editable Stripe price IDs, with the existing
  environment variables as fallback — nothing breaks before an admin sets
  an override).
- Adds `admin_search_users` and `admin_dashboard_overview` RPCs, since
  `auth.users` is not exposed through PostgREST.

### 3. Bootstrap the founder account (one-time, documented command — not a UI button)

The founder bootstrap is intentionally **not** a button in the admin UI:
it requires a shared secret (`FOUNDER_BOOTSTRAP_SECRET`, already an Edge
Function secret per `.env.example`) that should never be typed into a web
page. Run this once, after signing in to the admin panel's Google login
at least once (so the `auth.users` row exists) and after Google Auth is
enabled and the migration above is applied:

```bash
ACCESS_TOKEN="<the Supabase access token from your logged-in browser session>"
curl -X POST "https://<project-ref>.supabase.co/functions/v1/bootstrap-founder" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "x-founder-bootstrap-secret: $FOUNDER_BOOTSTRAP_SECRET" \
  -H "content-type: application/json" \
  -d '{"confirmation":"BOOTSTRAP_FOUNDER"}'
```

This can only ever succeed once (the function raises if a founder is
already configured), and only for the account whose verified e-mail
matches the hardcoded founder identity.

### 4. Grant `admin` (support-level) roles afterward

Once the founder is bootstrapped, use the founder's own admin panel
session to call the existing `admin-role-action` Edge Function (already
wired into `apps/admin/src/services/adminApi.ts` as `adminApi.setRole`) to
grant/revoke the lesser `support`/`admin` roles to other accounts — no
manual SQL needed after this point.

## What ships automatically

- `apps/admin` builds and deploys with the landing page on every push to
  `main` that touches `apps/admin/**`, `apps/landing/**`, `packages/**`.
- Every admin mutation (plans, prices, features, flags, notices, versions,
  vouchers, campaigns, entitlement grants/overrides, license keys, roles)
  is written to `audit_logs` with actor, action, target and reason.
