# Test and release plan

## Automated gate

`npm run check` executes repository secret scanning, strict typecheck, Vitest suites, production builds and bundle inspection. Tests cover domain schemas, URL matching, billing responses, i18n parity, workspace checksums/rollback/redaction, evidence, recording MIME fallback and cleanup, Convertio contracts, network limits, payload validation, JSON Studio, breakpoints, signed offline licensing, toolbar behavior and automated serious/critical WCAG checks.

Run `npm audit --omit=dev` separately for the production dependency gate. Development-only WXT advisories are tracked in `docs/security/dependency-audit.md`.

## Controlled manual checks

1. Load the unpacked production build in a clean Chrome profile.
2. Complete onboarding, grant one host, and verify the toolbar never appears elsewhere.
3. Exercise signup/login/logout, `30DIAS`, monthly/yearly Stripe test checkout and the customer portal.
4. Record on a browser with MP4 support and one with WebM fallback; inspect the resulting container.
5. Configure a disposable Convertio key, convert a short recording, cancel another, and confirm remote cleanup.
6. Test iframe-allowed and iframe-blocked pages in Breakpoint Viewer.
7. Switch PT-BR/English/Spanish, light/dark/system, keyboard-only navigation, 200% zoom and reduced motion.
8. Revoke the installation online, disconnect the network and verify signed-token expiry/grace behavior.

## Rollback

Frontend rollback redeploys the previous Pages artifact. Edge Functions are redeployed from the previous Git revision. Database migrations are forward-only; corrective migrations reverse behavior without editing applied files. Stripe prices and coupons are deactivated rather than deleted when historical records reference them.
