# Permissions and privacy

The extension ships with only localhost content-script matches. Additional hosts are optional permissions requested from a user-selected domain; they are never silently broadened. `activeTab`, scripting and capture capabilities run only after explicit actions. The extension does not bypass CSP or `X-Frame-Options`, inject remote executable code, or include server credentials.

Operational workspace data is local-first in `browser.storage.local`. Safe export removes credentials, tokens, cookies, secrets and the Convertio key. Network payload capture is opt-in, bounded and redacted. Screenshots and recordings are local actions. GIF conversion is the only designed content transfer to Convertio and requires explicit consent, a user-owned key, cancellable processing and cleanup.

Supabase enforces server-owned plans, vouchers, installations and entitlements with RLS and Edge Functions. Stripe Checkout and signed webhooks own paid activation. Offline access uses a short-lived PS256 token bound to the installation plus a bounded grace period; editing local storage cannot mint a valid entitlement.

Before publishing, run `npm run check`, `npm audit --omit=dev`, inspect the produced manifest and ZIP, and execute the manual permission/privacy checks in `docs/qa/test-plan.md`. The public policy is `/privacy-policy/`.

