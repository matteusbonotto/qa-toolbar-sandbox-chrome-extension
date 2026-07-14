# Stripe + Supabase deployment

## Security boundary

The extension contains only the Supabase URL/publishable key and, if a future embedded Stripe component needs it, the Stripe publishable key. `STRIPE_SECRET_KEY`, `APP_SUPABASE_SECRET_KEY`, webhook, keep-alive and founder bootstrap secrets are Edge-only.

The external API accepts POST JSON. User IDs, prices, amounts, redirects and entitlement decisions are never accepted from URL query parameters. The authenticated user is derived from the validated access token. Checkout and portal URLs are validated against exact Stripe hosts before the extension may open them.

## Stripe sandbox catalog

- Product: `prod_UsVNq6x0pLlHHL`
- Monthly test price: `price_1TskMlH0sB1B9zJHLBWAvhKm` — BRL 29.90
- Yearly test price: `price_1TskMlH0sB1B9zJHWNp00Gpk` — BRL 299.00
- Default test Customer Portal: `bpc_1TskiqH0sB1B9zJH26zgRjoq` — customer details, invoices, payment method and end-of-period cancellation enabled
- Scale monthly test price: `price_1TsmzwH0sB1B9zJHTpPJUxsO` — BRL 59.90
- Scale yearly test price: `price_1TsmzwH0sB1B9zJH0coRsPWR` — BRL 599.00
- Launch code: `COMECE30` — 30% off for three months, first transaction only
- Referral discount: 20% off for three months when a valid `QTS-XXXXXXXX` referral is attached

These are test-mode objects. Do not reuse them as live prices without a deliberate commercial review.

## Required management authorization

`SUPABASE_SECRET` is a server data key and cannot deploy projects. The CLI operator needs a personal `SUPABASE_ACCESS_TOKEN` with privileges over the target project. Set it in the process environment, never in the repository.

```powershell
$env:SUPABASE_ACCESS_TOKEN = 'personal-access-token'
$env:STRIPE_WEBHOOK_SECRET = 'whsec_...'
$env:KEEP_ALIVE_SECRET = 'random-32-byte-or-longer-secret'
$env:FOUNDER_BOOTSTRAP_SECRET = 'independent-random-secret'
$env:ALLOWED_ORIGINS = 'https://matteusbonotto.github.io,http://127.0.0.1:4173,http://localhost:4173'
$env:ALLOWED_EXTENSION_IDS = 'published-chrome-extension-id,local-unpacked-extension-id'
./scripts/deploy-supabase.ps1 -ProjectRef 'your-project-ref'
```

The Stripe webhook URL is:

```text
https://PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

Subscribe only to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.

## Keep-alive

`keep-alive` is POST-only, uses a dedicated constant-time-checked secret, rate limits to four calls per day, returns no database details and performs a minimal head query. The GitHub workflow calls it every three days. Configure repository secrets `SUPABASE_KEEP_ALIVE_URL` and `SUPABASE_KEEP_ALIVE_SECRET`. This is an availability aid, not a substitute for a paid Supabase SLA, backups or monitoring.

## Function API

| Function | Auth | Body |
| --- | --- | --- |
| `auth-sign-up` | Public + rate limit | `{ email, password, acceptedTerms, referralCode? }` |
| `auth-sign-in` | Public + rate limit | `{ email, password }` |
| `auth-refresh` | Refresh token + rate limit | `{ refreshToken }` |
| `register-installation` | Bearer JWT | `{ installationId, label }` |
| `create-checkout` | Bearer JWT | `{ priceKey, requestId, referralCode? }` |
| `create-customer-portal` | Bearer JWT | `{ requestId }` |
| `billing-status` | Bearer JWT | `{ installationId }` |
| `redeem-voucher` | Bearer JWT | `{ code }`; atomically grants access for an available voucher |
| `stripe-webhook` | Stripe signature | Raw signed body |
| `keep-alive` | Dedicated header secret | `{}` |

No system can honestly guarantee zero invasions. This implementation uses defense in depth: least privilege, Edge-only mutations, deny-by-default RLS, signature verification, idempotency, strict schemas, rate limiting, fixed redirects, secret scanning and auditable roles.

## Trial and referral lifecycle

`auth-sign-up` records versioned terms acceptance, starts one non-renewable 30-day Scale grant and creates a referral code. When the grant expires, `billing-status` resolves an active paid subscription or falls back to Starter. A valid referral gives the buyer 20% off for three months. Only `invoice.paid` may qualify the referral and reward its owner, preventing rewards for abandoned checkout sessions.

When a user chooses Pro or Scale with more than 48 hours left in the evaluation, Checkout collects the payment method and schedules the first charge for `trial_ends_at`. Near or after expiry, the subscription starts immediately. This avoids charging a customer while the promised evaluation is still running.

The landing page never treats a checkout return as proof of payment. It polls `billing-status` and only unlocks the official Chrome Web Store destination when `access.active` is true. `CHROME_WEB_STORE_URL` is validated server-side against `chromewebstore.google.com`; the customer never receives a ZIP from GitHub Pages.

## Vouchers and feature flags

Raw voucher codes must never be committed. Put the three codes in the ignored `.env.private` variables documented by `.env.example`, deploy the migration, then run `./scripts/provision-vouchers.ps1`. Codes are normalized and hashed locally; Supabase stores only SHA-256 hashes. Redemption is single-use and atomic. An administrator may deliberately make a voucher available again through the service-role-only `reset_voucher` RPC.

The `feature_flags` table provides server-controlled switches and JSON configuration. `billing-status` sends the effective flags to the extension, where a disabled flag overrides plan entitlement. Add new flags through reviewed migrations or the Supabase dashboard with the service role; clients only receive enabled state/config and cannot mutate flags.

Time-limited grants expose `daysRemaining` and `expiryWarning` when 30 days or fewer remain. A voucher with `grant_days = null` is lifetime access.
