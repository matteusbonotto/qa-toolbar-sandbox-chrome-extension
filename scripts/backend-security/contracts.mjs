// Input contracts of the Edge Functions, transcribed from supabase/functions/*/index.ts. The mock
// server (mock-edge-server.mjs) enforces them and the security suite uses them to compute the
// EXPECTED status for a hostile value. If a function changes its validation, update it here in the
// same change: the suite run against a real target then shows the drift as a failure.

// zod v4 `z.string().email()` default pattern (auth-sign-in/index.ts:7, auth-recover-password/index.ts:11).
export const ZOD_EMAIL = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
// voucher-preview/index.ts:46, voucher-redeem/index.ts:11, checkout-create-session/index.ts:27
export const VOUCHER_CODE = /^[A-Z0-9-]{6,64}$/;
// 409 codes voucher-redeem may answer for a well-formed code (voucher-redeem/index.ts,
// _shared/vouchers.ts voucherRpcErrorCode). voucher_domain_not_allowed: the voucher is restricted
// to e-mail domains (allowed_email_domains) and the caller's confirmed e-mail is not one of them
// (migration 20261028120000). checkout-create-session answers the same codes for voucherCode, plus
// voucher_plan_mismatch.
export const VOUCHER_REDEEM_ERRORS = ["voucher_unavailable", "voucher_requires_checkout", "voucher_already_redeemed", "voucher_domain_not_allowed"];
// referral-track/index.ts:13, checkout-create-session/index.ts:26
export const REFERRAL_CODE = /^QTS-[A-F0-9]{8}$/;
// rewards-spin/index.ts:12, checkout-create-session/index.ts:25
export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// checkout-create-session/index.ts:24
export const PLAN_KEY = /^[a-z][a-z0-9-]{1,40}$/;
// multi-tester/index.ts:62 (any UUID version)
export const ANY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// multi-tester/index.ts:226
export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
// multi-tester/index.ts VOTE_ID_PATTERN (Fase MT2 consensus)
export const VOTE_ID = /^[A-Za-z0-9_-]{8,40}$/;
// admin-email-otp/index.ts:28 (UUID v1-5 only)
export const CHALLENGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const OTP = /^\d{8}$/;
export const MFA_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const COLOR = /^#[0-9a-fA-F]{6}$/;

export const ADMIN_EMAIL = "matteusbonotto+admin@gmail.com"; // _shared/admin_mfa.ts:3

// Supabase Auth settings the e-mail domain rule of vouchers depends on (allowed_email_domains,
// migration 20261028120000): the RPCs trust auth.users.email + email_confirmed_at, so
//   * "Confirm email" must stay ON (mailer_autoconfirm false), otherwise anyone signs up as
//     someone@mblabs.com.br and is "confirmed" without owning the mailbox;
//   * every enabled sign-in provider must have been reviewed to only set email_confirmed_at for an
//     e-mail the provider itself verified. Today only the e-mail provider is enabled. Adding an
//     OAuth/SAML/phone/anonymous provider means: review it, then add its key here.
// Checked live by scripts/backend-security/check-live-auth-settings.mjs (GET /auth/v1/settings).
export const REVIEWED_AUTH_PROVIDERS = ["email"];

export function auditAuthSettings(settings, reviewed = REVIEWED_AUTH_PROVIDERS) {
  const failures = [];
  if (!settings || typeof settings !== "object") return ["auth settings response is not an object"];
  if (settings.mailer_autoconfirm !== false) {
    failures.push(`mailer_autoconfirm must be false ("Confirm email" ON), got ${JSON.stringify(settings.mailer_autoconfirm)}`);
  }
  const external = settings.external;
  if (!external || typeof external !== "object") {
    failures.push("auth settings have no `external` provider map");
  } else {
    for (const [provider, enabled] of Object.entries(external)) {
      if (enabled === true && !reviewed.includes(provider)) {
        failures.push(`provider "${provider}" is enabled but not reviewed for the voucher e-mail domain rule`);
      }
    }
  }
  if (settings.saml_enabled === true && !reviewed.includes("saml")) {
    failures.push("SAML SSO is enabled but not reviewed for the voucher e-mail domain rule");
  }
  return failures;
}

// readJson maximums per function (default 16 KB, _shared/http.ts:56). null = body never read.
export const BODY_LIMITS = {
  "access-status": null,
  "account-delete": 4_096,
  "admin-email-otp": 2_048,
  "auth-recover-password": 2_048,
  "auth-refresh": 8_192,
  "auth-sign-in": 8_192,
  "cancel-access": null,
  "checkout-create-session": 16_384,
  "keep-alive": null,
  "legal-registration": null,
  "multi-tester": 16_384,
  "referral-track": 16_384,
  "rewards-spin": 16_384,
  "stripe-webhook": 1_048_576, // raw text, no content-type requirement (stripe-webhook/index.ts:54)
  "voucher-preview": 16_384,
  "voucher-redeem": 16_384,
};

// Rate limits from enforceRateLimit(subject, action, maximum, windowSeconds) calls.
export const RATE_LIMITS = {
  "access-status": [300, 3_600],
  "account-delete": [5, 3_600],
  "admin-email-otp": [3, 900],
  "admin-email-otp-verify": [5, 600],
  "auth-recover-password": [5, 900],
  "auth-recover-password-client": [20, 3_600],
  "auth-refresh": [30, 3_600],
  // auth-sign-in/index.ts: per (client, e-mail), per client, per account (security audit 2026-10-22).
  "auth-sign-in": [10, 900],
  "auth-sign-in-client": [30, 900],
  "auth-sign-in-account": [50, 3_600],
  "cancel-access": [5, 3_600],
  "checkout-create-session": [8, 3_600],
  "keep-alive": [4, 86_400],
  "multi-tester-poll": [4_000, 3_600],
  "multi-tester-chat": [600, 3_600],
  "multi-tester-action": [120, 3_600],
  "multi-tester-vote": [1_500, 3_600],
  "referral-track": [5, 3_600],
  "rewards-spin": [5, 60],
  "voucher-preview-code": [20, 3_600],
  "voucher-preview-client": [60, 3_600],
  "voucher-redeem": [8, 3_600],
};

export function emailAccepted(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return ZOD_EMAIL.test(trimmed) && trimmed.length <= 254;
}

export function upperTrim(value) {
  return String(value).trim().toUpperCase();
}
