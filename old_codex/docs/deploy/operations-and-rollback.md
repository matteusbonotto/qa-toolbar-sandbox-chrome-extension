# Operations and rollback

## Release gates

1. Run `npm ci`, `npm run check` and `npm audit --omit=dev`.
2. Apply pending Supabase migrations with the linked project and deploy Edge Functions using `scripts/deploy-supabase.ps1`.
3. Verify promotion status, voucher redemption, billing status, checkout and a signed Stripe webhook in test mode.
4. Build the landing artifact and deploy it to GitHub Pages; verify the public home and privacy URLs.
5. Run `npm run release:chrome` and upload the generated artifact after checking its SHA-256. Store packages must not contain `manifest.key`.

## Configuration ownership

Public URL/price identifiers may be supplied through documented `VITE_*` or `WXT_PUBLIC_*` values. Stripe secret keys, webhook secrets, Supabase service role, Convertio keys and the offline-token private JWK remain only in their provider/local secret stores. Rotation requires redeploying the affected Edge Functions; private values must never enter Git, frontend bundles, logs or diagnostics.

## Rollback

Redeploy the previous Pages artifact and previous Edge Function revision. Database migrations are immutable and forward-only: correct behavior with a new migration, never by editing an applied migration. Deactivate Stripe prices/coupons instead of deleting objects referenced by history. Chrome Web Store rollback is a new version built from the last known-good Git revision because store versions cannot be decremented. Re-run smoke checks after every rollback.

## Smoke evidence

Record the Git revision, UTC time, Supabase project reference, deployed function versions, Stripe mode and object IDs, Pages response status, extension version, artifact SHA-256 and gate output. Never record secret values.
