// Live, read-only guard: GET <SUPABASE_URL>/auth/v1/settings (public endpoint, anon key) and fail
// if Supabase Auth drifted away from what the voucher e-mail domain rule depends on: "Confirm
// email" ON (mailer_autoconfirm false) and only reviewed sign-in providers enabled. The rule itself
// lives in auditAuthSettings (contracts.mjs), unit-tested offline by test-backend-security-tools.mjs.
// Needs network, so it is NOT part of `npm test`; it runs first in `npm run backend:test:live`
// (scripts/run-live-backend-smokes.ps1) and standalone as `npm run backend:check-auth-settings`.
// It only reads public settings: nothing is written, so it is safe against any project.
//
// Env: SUPABASE_URL and SUPABASE_PUBLIC_KEY (or SUPABASE_ANON_KEY).

import { auditAuthSettings, REVIEWED_AUTH_PROVIDERS } from "./contracts.mjs";

const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_PUBLIC_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_PUBLIC_KEY (or SUPABASE_ANON_KEY) are required.");
  process.exit(2);
}

// 15 s: generous for one small GET; without a timeout a hung connection would stall the live run.
const response = await fetch(`${url}/auth/v1/settings`, {
  headers: { apikey: key },
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) {
  console.error(`GET /auth/v1/settings answered HTTP ${response.status}`);
  process.exit(1);
}
const settings = await response.json();
const failures = auditAuthSettings(settings);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error("The voucher e-mail domain rule (allowed_email_domains) is NOT trustworthy with these Auth settings. See docs/security.md.");
  process.exit(1);
}
const enabled = Object.entries(settings.external).filter(([, on]) => on === true).map(([name]) => name);
console.log(`Auth settings OK: mailer_autoconfirm=false, enabled providers [${enabled.join(", ")}] all in reviewed list [${REVIEWED_AUTH_PROVIDERS.join(", ")}].`);
