// Table-driven hostile-input suite for every Edge Function in supabase/functions/*/index.ts.
// Started by run-security.mjs (never directly against a remote host: the target guard below runs
// again here as defense in depth). Expected outcomes are transcribed from each function's code
// (see contracts.mjs for the validation rules); the universal invariants are:
//   - never 5xx, never a stack trace / SQL error / secret in the body;
//   - error bodies are {"error":"<snake_case code>"} with the security headers of _shared/http.ts;
//   - a disallowed Origin never gets Access-Control-Allow-Origin;
//   - a user can never act on another user's resources (Multi Testador host-only actions,
//     removed/rejected members cut off, account-delete cannot target another account).
//
// Env (set by run-security.mjs):
//   QTS_SECURITY_TARGET_ORIGIN   origin approved by the guard
//   QTS_SECURITY_MODE            "mock" (exact codes, no 429 tolerated) or "real"
//   QTS_SECURITY_IDENTITIES      JSON with access tokens (plain, host, guests[4], outsider, noPlan, founder, expiredToken)
//   QTS_SECURITY_ALLOWED_ORIGIN  optional, an Origin the target allows (positive CORS check)
//   QTS_SECURITY_ALLOW_DESTRUCTIVE "1" to run cancel-access with a real token on a remote test project

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guardedFetchFor, OWNERSHIP_FLAG, resolveTarget } from "./target-guard.mjs";
import {
  ALL_HOSTILE_STRINGS, INVALID_JSON_BODIES, LEAK_PATTERNS, NON_OBJECT_JSON_BODIES, prototypePollutionBodies,
} from "./hostile-inputs.mjs";
import {
  ANY_UUID, BODY_LIMITS, CHALLENGE_ID, emailAccepted, OTP, PLAN_KEY, REFERRAL_CODE, REQUEST_ID, ROOM_CODE, upperTrim, VOTE_ID, VOUCHER_CODE, VOUCHER_REDEEM_ERRORS,
} from "./contracts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODE = process.env.QTS_SECURITY_MODE === "real" ? "real" : "mock";
const target = resolveTarget({
  url: process.env.QTS_SECURITY_TARGET_ORIGIN,
  argv: process.env.QTS_SECURITY_OWNERSHIP_CONFIRMED === "1" ? [OWNERSHIP_FLAG] : [],
});
const guardedFetch = guardedFetchFor(target);
const IDS = JSON.parse(process.env.QTS_SECURITY_IDENTITIES || "{}");
const ALLOWED_ORIGIN = process.env.QTS_SECURITY_ALLOWED_ORIGIN || "";
const ALLOW_DESTRUCTIVE = MODE === "mock" || process.env.QTS_SECURITY_ALLOW_DESTRUCTIVE === "1";
const BAD_ORIGIN = "https://attacker.invalid";
const masked = new Map(); // function -> count of cases answered 429 (real mode only)
const TYPE_VARIANTS = [123, 123456, true, null, {}, [], { $gt: "" }, ["a"]];
const HOSTILE_VALUES = [...ALL_HOSTILE_STRINGS, ...TYPE_VARIANTS];
const EMAIL_HOSTILE = [
  "x'--@example.com", "a@example.com' OR '1'='1", "test+'or'1'='1@example.com", "admin@example.com\u0000",
  "\"' OR 1=1\"@example.com", "<script>@example.com", "a@b.c", `${"a".repeat(250)}@example.com`,
];

const tokenOf = (identity) => (identity && typeof identity === "object" ? identity.accessToken : identity) || "";
const idOf = (identity) => (identity && typeof identity === "object" ? identity.userId : "") || "";
const has = (...names) => names.every((name) => tokenOf(name.split(".").reduce((value, key) => value?.[key], IDS)));

// Universal: functions that use the shared serve() reject a disallowed Origin with 403 before the
// handler; admin-email-otp and stripe-webhook have their own Deno.serve (no such check).
const OWN_SERVE = new Set(["admin-email-otp", "stripe-webhook"]);
const SPECS = {
  "access-status": { auth: "bearer", rateLimited: true },
  "account-delete": { auth: "bearer", rateLimited: true, gatewayJwt: true },
  "admin-email-otp": { auth: "bearer-after-body", rateLimited: true },
  "auth-recover-password": { auth: "none", rateLimited: true },
  "auth-refresh": { auth: "none", rateLimited: true },
  "auth-sign-in": { auth: "none", rateLimited: true },
  "cancel-access": { auth: "bearer", rateLimited: true, destructive: true },
  "checkout-create-session": { auth: "bearer", rateLimited: true },
  "keep-alive": { auth: "secret", rateLimited: true },
  "legal-registration": { auth: "none" },
  "multi-tester": { auth: "bearer", rateLimited: true },
  "referral-track": { auth: "bearer", rateLimited: true },
  "rewards-spin": { auth: "bearer", rateLimited: true },
  "stripe-webhook": { auth: "stripe" },
  "voucher-preview": { auth: "none", rateLimited: true },
  "voucher-redeem": { auth: "bearer", rateLimited: true },
};

// ------------------------------------------------------------------------------- HTTP helpers
async function call(name, { method = "POST", token, origin, contentType = "application/json", body, raw, headers = {}, path = "" } = {}) {
  const requestHeaders = { ...headers };
  if (contentType) requestHeaders["content-type"] = contentType;
  if (token !== undefined) requestHeaders.authorization = token.startsWith("Basic ") || token.startsWith("Bearer") ? token : `Bearer ${token}`;
  if (origin) requestHeaders.origin = origin;
  if (process.env.QTS_SECURITY_APIKEY) requestHeaders.apikey = process.env.QTS_SECURITY_APIKEY;
  const payload = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
  const response = await guardedFetch(`${target.functionsBaseUrl}/${name}${path}`, {
    method,
    headers: requestHeaders,
    body: ["GET", "HEAD", "OPTIONS"].includes(method) ? undefined : payload,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { name, status: response.status, headers: response.headers, text, json };
}

function assertNoLeak(res) {
  // Multi Testador chat is text the testers typed themselves (the suite posts hostile strings such as
  // "pg_sleep" on purpose) and the room state echoes it back by design: it is user content, not a
  // server error, so only the chat texts are left out of the leak scan; everything else is scanned.
  const text = Array.isArray(res.json?.chat)
    ? JSON.stringify({ ...res.json, chat: res.json.chat.map((message) => ({ ...message, text: "" })) })
    : res.text;
  for (const [label, pattern] of LEAK_PATTERNS) {
    assert.doesNotMatch(text, pattern, `${res.name}: response leaks ${label}: ${text.slice(0, 200)}`);
  }
}

function assertSecurityHeaders(res) {
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", `${res.name}: missing nosniff`);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/, `${res.name}: missing cache-control no-store`);
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/, `${res.name}: missing CSP`);
  assert.equal(res.headers.get("x-frame-options"), "DENY", `${res.name}: missing x-frame-options`);
}

/**
 * Core assertion. `expected` = { status, error?, statuses?, check? }.
 * Real mode tolerates 429 on rate-limited functions (counted and reported as "masked").
 */
function expectSafe(res, expected, { gatewayAuth = false } = {}) {
  assertNoLeak(res);
  assert.ok(res.status < 500, `${res.name}: server error ${res.status}: ${res.text.slice(0, 200)}`);
  if (MODE === "real" && res.status === 429 && SPECS[res.name]?.rateLimited) {
    masked.set(res.name, (masked.get(res.name) ?? 0) + 1);
    return;
  }
  // Supabase's gateway (verify_jwt on, see account-delete) answers bad JWTs itself, with its own body.
  if (MODE === "real" && gatewayAuth && res.status === 401) return;
  const allowed = expected.statuses ?? [expected.status];
  assert.ok(allowed.includes(res.status), `${res.name}: expected ${allowed.join("/")} got ${res.status}: ${res.text.slice(0, 200)}`);
  if (res.text) assertSecurityHeaders(res);
  if (res.status >= 400 && res.text) {
    assert.ok(res.json && typeof res.json.error === "string", `${res.name}: error body is not {"error": code}: ${res.text.slice(0, 120)}`);
    assert.match(res.json.error, /^[a-z_]+$/, `${res.name}: error code is not a plain snake_case code`);
    const errors = expected.errors ?? (expected.error ? [expected.error] : null);
    if (errors) assert.ok(errors.includes(res.json.error), `${res.name}: expected error ${errors.join("/")} got ${res.json.error}`);
  }
  if (expected.check && res.status < 300) expected.check(res.json, res);
}

function forgedJwt({ alg = "HS256", exp = Math.floor(Date.now() / 1000) + 3_600, sub = randomUUID() } = {}) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg, typ: "JWT" })}.${part({ sub, role: "authenticated", exp, email: "forged@example.com" })}.${alg === "none" ? "" : Buffer.from("forged-signature").toString("base64url")}`;
}

function uniqueEmail() {
  return `qts-security-${randomUUID().slice(0, 12)}@example.com`;
}

function describeValue(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}...` : text);
}

// Token used for the generic checks of bearer functions (auth happens before body parsing).
function genericToken(name) {
  if (name === "multi-tester") return tokenOf(IDS.outsider) || tokenOf(IDS.plain);
  return tokenOf(IDS.plain);
}

function minimalBody(name) {
  return {
    "account-delete": { password: "test-wrong-password-qts" },
    "admin-email-otp": { action: "revoke", mfaToken: "short" },
    "auth-recover-password": { email: "qts-security@example.com" },
    "auth-refresh": { refreshToken: "test-not-a-refresh-token" },
    "auth-sign-in": { email: uniqueEmail(), password: "test-wrong-password-qts" },
    "checkout-create-session": { planKey: "qts-security-missing-plan", billingCycle: "monthly", requestId: randomUUID() },
    "multi-tester": { action: "state", roomId: randomUUID() },
    "referral-track": { referralCode: "QTS-00000000" },
    "rewards-spin": { requestId: "not-a-uuid" },
    "voucher-preview": { code: "QTS-SECURITY-UNKNOWN" },
    "voucher-redeem": { code: "x" },
  }[name] ?? {};
}

// Functions that read a JSON body, and whether a token is needed to get past auth to the body.
function bodyReaders() {
  return Object.entries(BODY_LIMITS).filter(([name, limit]) => limit !== null && name !== "stripe-webhook").map(([name, limit]) => ({
    name, limit, needsToken: SPECS[name].auth === "bearer",
  }));
}

// ------------------------------------------------------------------------------- coverage
describe("coverage", () => {
  test("every supabase/functions/*/index.ts has a security spec", () => {
    const dir = resolve(ROOT, "supabase", "functions");
    const functions = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(resolve(dir, entry.name, "index.ts")))
      .map((entry) => entry.name).sort();
    assert.deepEqual(functions.filter((name) => !SPECS[name]), [], "add the new function to SPECS, BODY_LIMITS (contracts.mjs) and the mock");
    assert.deepEqual(Object.keys(SPECS).filter((name) => !functions.includes(name)), [], "SPECS lists a function that no longer exists");
  });
});

// ------------------------------------------------------------------------------- CORS + methods
describe("CORS and HTTP method", () => {
  for (const name of Object.keys(SPECS)) {
    test(`${name}: preflight from a disallowed Origin is 403 without Access-Control-Allow-Origin`, async () => {
      const res = await call(name, { method: "OPTIONS", origin: BAD_ORIGIN, contentType: null, headers: { "access-control-request-method": "POST" } });
      assert.equal(res.status, 403);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
      assertNoLeak(res);
    });
    test(`${name}: preflight without Origin is 403`, async () => {
      const res = await call(name, { method: "OPTIONS", contentType: null });
      assert.equal(res.status, 403);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    });
    test(`${name}: preflight from the allowlisted Origin echoes only that Origin`, { skip: !ALLOWED_ORIGIN && "QTS_SECURITY_ALLOWED_ORIGIN not set" }, async () => {
      const res = await call(name, { method: "OPTIONS", origin: ALLOWED_ORIGIN, contentType: null, headers: { "access-control-request-method": "POST" } });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
      assert.notEqual(res.headers.get("access-control-allow-origin"), "*");
    });
    test(`${name}: POST from a disallowed Origin never gets CORS access`, async () => {
      const res = await call(name, { origin: BAD_ORIGIN, body: minimalBody(name) });
      assert.equal(res.headers.get("access-control-allow-origin"), null);
      if (OWN_SERVE.has(name)) {
        assertNoLeak(res);
        assert.ok(res.status < 500, `${name}: ${res.status}`);
      } else {
        expectSafe(res, { status: 403, error: "origin_not_allowed" });
      }
    });
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      test(`${name}: ${method} is 405`, async () => {
        const res = await call(name, { method, body: method === "GET" ? undefined : {} });
        expectSafe(res, { status: 405, error: "method_not_allowed" });
      });
    }
    test(`${name}: encoded path traversal after the function name stays inside the function`, async () => {
      const res = await call(name, { path: "/..%2F..%2Frest%2Fv1%2Fprofiles%3Fselect%3D*", body: minimalBody(name) });
      assertNoLeak(res);
      assert.ok(res.status < 500, `${name}: ${res.status}`);
      assert.ok(!Array.isArray(res.json), `${name}: traversal returned a table listing`);
    });
  }
});

// ------------------------------------------------------------------------------- authentication
describe("authentication", () => {
  const badBearers = [
    ["missing Authorization", undefined, "authentication_required"],
    ["Basic scheme", "Basic dXNlcjpwYXNz", "authentication_required"],
    ["empty Bearer", "Bearer ", "authentication_required"],
    ["alg none JWT", `Bearer ${forgedJwt({ alg: "none" })}`, "invalid_session"],
    ["forged HS256 JWT", `Bearer ${forgedJwt()}`, "invalid_session"],
    ["forged JWT with past exp", `Bearer ${forgedJwt({ exp: 1 })}`, "invalid_session"],
    ["SQL injection as token", "Bearer ' OR 1=1 --", "invalid_session"],
    ["non-JWT garbage", `Bearer ${"x".repeat(2_000)}`, "invalid_session"],
  ];
  for (const [name, spec] of Object.entries(SPECS)) {
    if (spec.auth === "bearer") {
      for (const [label, header, error] of badBearers) {
        test(`${name}: ${label} is 401`, async () => {
          const res = await call(name, { token: header, body: minimalBody(name) });
          expectSafe(res, { status: 401, error }, { gatewayAuth: spec.gatewayJwt });
        });
      }
      test(`${name}: correctly signed but expired token is 401`, { skip: !IDS.expiredToken && "no expiredToken identity" }, async () => {
        const res = await call(name, { token: IDS.expiredToken, body: minimalBody(name) });
        expectSafe(res, { status: 401, error: "invalid_session" }, { gatewayAuth: spec.gatewayJwt });
      });
    }
    if (spec.auth === "bearer-after-body") {
      for (const action of ["request", "verify", "revoke"]) {
        for (const [label, header, error] of badBearers) {
          test(`${name} (${action}): ${label} is 401`, async () => {
            const res = await call(name, { token: header, body: { action, challengeId: randomUUID(), otp: "12345678" } });
            expectSafe(res, { status: 401, error });
          });
        }
      }
    }
    if (spec.auth === "secret") {
      for (const [label, value] of [["missing", undefined], ["wrong", "wrong-secret"], ["SQL injection", "' OR 1=1 --"], ["huge", "s".repeat(8_000)]]) {
        test(`${name}: ${label} x-keep-alive-secret is 401`, async () => {
          const res = await call(name, { headers: value === undefined ? {} : { "x-keep-alive-secret": value }, body: {} });
          expectSafe(res, { status: 401, error: "unauthorized" });
        });
      }
    }
    if (spec.auth === "stripe") {
      const now = Math.floor(Date.now() / 1000);
      test(`${name}: missing stripe-signature is 400`, async () => {
        expectSafe(await call(name, { raw: "{}" }), { status: 400, error: "signature_required" });
      });
      for (const [label, signature] of [
        ["forged", `t=${now},v1=${"ab".repeat(32)}`],
        ["replayed (old timestamp)", `t=${now - 86_400},v1=${"cd".repeat(32)}`],
        ["SQL injection", "t=' OR 1=1 --,v1=x"],
        ["garbage", "\u0000\u0001"],
      ]) {
        test(`${name}: ${label} signature is 400`, async () => {
          const res = await call(name, { headers: { "stripe-signature": signature.replace(/[\u0000-\u001f]/g, "") || "x" }, raw: JSON.stringify({ id: "evt_forged", type: "invoice.paid" }) });
          expectSafe(res, { status: 400, error: "invalid_signature" });
        });
      }
      test(`${name}: body over 1 MB with a signature header is 413`, async () => {
        const res = await call(name, { headers: { "stripe-signature": `t=${now},v1=00` }, raw: "x".repeat(1_048_577) });
        expectSafe(res, { status: 413, error: "payload_too_large" });
      });
    }
  }
});

// ------------------------------------------------------------------------------- body handling
describe("body handling (content type, size, malformed JSON, prototype pollution)", () => {
  for (const { name, limit, needsToken } of bodyReaders()) {
    const options = { skip: needsToken && !genericToken(name) && "no plain identity token" };
    const tokenFor = () => (needsToken ? genericToken(name) : undefined);
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", null]) {
      test(`${name}: content-type ${contentType ?? "(missing)"} is 415`, options, async () => {
        const res = await call(name, { token: tokenFor(), contentType, raw: JSON.stringify(minimalBody(name)) });
        expectSafe(res, { status: 415, error: "content_type_required" });
      });
    }
    test(`${name}: body of ${limit + 1} bytes is 413`, options, async () => {
      const pad = "A".repeat(limit + 1 - JSON.stringify({ pad: "" }).length);
      const raw = JSON.stringify({ pad });
      assert.equal(Buffer.byteLength(raw), limit + 1);
      expectSafe(await call(name, { token: tokenFor(), raw }), { status: 413, error: "payload_too_large" });
    });
    test(`${name}: multibyte body just over ${limit} bytes (fewer characters) is 413`, options, async () => {
      const raw = JSON.stringify({ pad: "é".repeat(Math.ceil(limit / 2)) });
      assert.ok(raw.length <= limit && Buffer.byteLength(raw) > limit);
      expectSafe(await call(name, { token: tokenFor(), raw }), { status: 413, error: "payload_too_large" });
    });
    test(`${name}: body of exactly ${limit} bytes is not rejected for size`, options, async () => {
      const pad = "A".repeat(limit - JSON.stringify({ pad: "" }).length);
      const res = await call(name, { token: tokenFor(), raw: JSON.stringify({ pad }) });
      assertNoLeak(res);
      assert.ok(res.status < 500, `${name}: ${res.status}`);
      assert.notEqual(res.status, 413);
    });
    for (const raw of INVALID_JSON_BODIES) {
      test(`${name}: malformed JSON ${describeValue(raw)} is 400 invalid_json`, options, async () => {
        expectSafe(await call(name, { token: tokenFor(), raw }), { status: 400, error: "invalid_json" });
      });
    }
    for (const raw of NON_OBJECT_JSON_BODIES) {
      test(`${name}: non-object JSON root ${describeValue(raw)} is handled without 5xx`, options, async () => {
        const res = await call(name, { token: tokenFor(), raw });
        expectSafe(res, nonObjectExpectation(name));
      });
    }
    for (const raw of prototypePollutionBodies()) {
      test(`${name}: prototype pollution body ${describeValue(raw)} is inert`, options, async () => {
        const res = await call(name, { token: tokenFor(), raw });
        expectSafe(res, nonObjectExpectation(name, { pollution: true }));
        // The process must not be polluted for later requests either.
        const follow = await call("voucher-preview", { body: { code: "QTS-SECURITY-UNKNOWN" } });
        expectSafe(follow, { status: 200, check: (json) => assert.equal(json.valid, false) });
        assert.equal(Object.prototype.polluted, undefined);
      });
    }
  }
});

// What a body without the expected fields produces, per function (from the code).
function nonObjectExpectation(name, { pollution = false } = {}) {
  switch (name) {
    case "account-delete": return { status: 400, error: "invalid_request" }; // zod strict
    case "admin-email-otp": return pollution ? { status: 400, error: "invalid_action" } : { status: 400, errors: ["invalid_request"] };
    case "auth-recover-password": return { status: 400, error: "invalid_request" };
    case "auth-refresh": return { status: 400, error: "invalid_request" };
    case "auth-sign-in": return { status: 400, error: "invalid_credentials" };
    case "checkout-create-session": return { status: 400, error: "invalid_request" };
    case "multi-tester": return { status: 400, error: "invalid_id" }; // no action -> roomId required
    case "referral-track": return { status: 400, error: "invalid_referral_code" };
    case "rewards-spin": return { status: 400, error: "invalid_request" };
    case "voucher-preview": return { status: 200, check: (json) => assert.equal(json.valid, false) };
    case "voucher-redeem": return { status: 400, error: "invalid_voucher" };
    default: throw new Error(`no expectation for ${name}`);
  }
}

// ------------------------------------------------------------------------------- hostile field values
const FIELD_CASES = [
  {
    fn: "auth-sign-in", field: "email", values: [...HOSTILE_VALUES, ...EMAIL_HOSTILE],
    body: (value) => ({ email: value, password: "test-wrong-password-qts" }),
    expect: (value) => (emailAccepted(value) ? { status: 401, error: "authentication_failed" } : { status: 400, error: "invalid_credentials" }),
  },
  {
    fn: "auth-sign-in", field: "password",
    body: (value) => ({ email: uniqueEmail(), password: value }),
    expect: (value) => (typeof value === "string" && value.length >= 8 && value.length <= 200 ? { status: 401, error: "authentication_failed" } : { status: 400, error: "invalid_credentials" }),
  },
  {
    fn: "auth-recover-password", field: "email", values: [...HOSTILE_VALUES, ...EMAIL_HOSTILE],
    body: (value) => ({ email: value }),
    expect: (value) => (emailAccepted(value) ? { status: 200, check: (json) => assert.deepEqual(json, { sent: true }) } : { status: 400, error: "invalid_request" }),
  },
  {
    fn: "auth-refresh", field: "refreshToken",
    body: (value) => ({ refreshToken: value }),
    expect: (value) => (typeof value === "string" && value.length >= 1 && value.length <= 4_096 ? { status: 401, error: "refresh_failed" } : { status: 400, error: "invalid_request" }),
  },
  {
    fn: "voucher-preview", field: "code",
    body: (value) => ({ code: value }),
    expect: () => ({ status: 200, check: (json) => assert.deepEqual(json, { valid: false, reason: "voucher_unavailable" }) }),
  },
  {
    fn: "voucher-redeem", field: "code", identity: "plain",
    body: (value) => ({ code: value }),
    expect: (value) => (VOUCHER_CODE.test(upperTrim(value)) ? { status: 409, errors: VOUCHER_REDEEM_ERRORS } : { status: 400, error: "invalid_voucher" }),
  },
  {
    fn: "referral-track", field: "referralCode", identity: "plain",
    body: (value) => ({ referralCode: value }),
    expect: (value) => (REFERRAL_CODE.test(upperTrim(value)) ? { status: 409, error: "referral_unavailable" } : { status: 400, error: "invalid_referral_code" }),
  },
  {
    fn: "rewards-spin", field: "requestId", identity: "plain",
    body: (value) => ({ requestId: value }),
    expect: (value) => (REQUEST_ID.test(String(value)) ? { status: 409, errors: ["insufficient_reward_points", "daily_spin_limit", "reward_program_unavailable", "reward_debt_outstanding"] } : { status: 400, error: "invalid_request" }),
  },
  ...["planKey", "billingCycle", "requestId", "referralCode", "voucherCode"].map((field) => ({
    fn: "checkout-create-session", field, identity: "plain",
    // Base plan key does not exist, so a value that passes validation stops at 404 plan_not_found
    // before any Stripe call: the suite can never open a real checkout.
    body: (value) => ({ planKey: "qts-security-missing-plan", billingCycle: "monthly", requestId: randomUUID(), [field]: value }),
    expect: (value) => (checkoutAccepts({ planKey: "qts-security-missing-plan", billingCycle: "monthly", requestId: "00000000-0000-4000-8000-000000000000", [field]: value })
      ? { status: 404, error: "plan_not_found" } : { status: 400, error: "invalid_request" }),
  })),
  {
    fn: "account-delete", field: "password", identity: "plain",
    body: (value) => ({ password: value }),
    expect: (value) => (typeof value === "string" && value.length >= 8 && value.length <= 200 ? { status: 401, error: "invalid_password" } : { status: 400, error: "invalid_request" }),
  },
  {
    fn: "admin-email-otp", field: "action",
    body: (value) => ({ action: value }),
    expect: (value) => (["request", "verify", "revoke"].includes(value) ? { status: 401, error: "authentication_required" } : { status: 400, error: "invalid_action" }),
  },
  {
    fn: "admin-email-otp", field: "challengeId (non-founder)", identity: "plain",
    body: (value) => ({ action: "verify", challengeId: value, otp: "12345678" }),
    expect: () => ({ status: 403, error: "otp_verification_required" }),
  },
  {
    fn: "admin-email-otp", field: "challengeId (founder)", identity: "founder",
    body: (value) => ({ action: "verify", challengeId: value, otp: "12345678" }),
    expect: (value) => (CHALLENGE_ID.test(typeof value === "string" ? value.trim() : "") ? { status: 401, error: "invalid_or_expired_otp" } : { status: 400, error: "invalid_challenge" }),
  },
  {
    fn: "admin-email-otp", field: "otp (founder)", identity: "founder",
    body: (value) => ({ action: "verify", challengeId: randomUUID(), otp: value }),
    expect: (value) => (OTP.test(typeof value === "string" ? value.trim() : "") ? { status: 401, error: "invalid_or_expired_otp" } : { status: 400, error: "invalid_otp" }),
  },
  {
    fn: "admin-email-otp", field: "mfaToken (revoke)", identity: "plain",
    body: (value) => ({ action: "revoke", mfaToken: value }),
    expect: () => ({ status: 200, check: (json) => assert.deepEqual(json, { revoked: true }) }),
  },
  {
    fn: "multi-tester", field: "action", identity: "plain",
    body: (value) => ({ action: value }),
    expect: () => ({ status: 400, error: "invalid_id" }),
  },
  {
    fn: "multi-tester", field: "code (request)", identity: "outsider",
    body: (value) => ({ action: "request", code: value }),
    expect: (value) => (ROOM_CODE.test(String(value ?? "").trim().toUpperCase()) ? { status: 404, error: "room_not_found" } : { status: 400, error: "invalid_code" }),
  },
  {
    fn: "multi-tester", field: "roomId (state)", identity: "outsider",
    body: (value) => ({ action: "state", roomId: value }),
    expect: (value) => (ANY_UUID.test(String(value ?? "")) ? { status: 404, error: "room_not_found" } : { status: 400, error: "invalid_id" }),
  },
  {
    fn: "multi-tester", field: "roomId (end)", identity: "outsider",
    body: (value) => ({ action: "end", roomId: value }),
    expect: (value) => (ANY_UUID.test(String(value ?? "")) ? { status: 404, error: "room_not_found" } : { status: 400, error: "invalid_id" }),
  },
];

function checkoutAccepts(input) {
  const planKey = String(input.planKey ?? "");
  const billingCycle = String(input.billingCycle ?? "");
  const requestId = String(input.requestId ?? "");
  const referralCode = input.referralCode ? upperTrim(input.referralCode) : undefined;
  const voucherCode = input.voucherCode ? upperTrim(input.voucherCode) : undefined;
  return PLAN_KEY.test(planKey) && ["monthly", "yearly"].includes(billingCycle) && REQUEST_ID.test(requestId)
    && (!referralCode || REFERRAL_CODE.test(referralCode)) && (!voucherCode || VOUCHER_CODE.test(voucherCode));
}

describe("hostile values in every string field (SQL injection, traversal, markup, unicode, wrong types)", () => {
  for (const testCase of FIELD_CASES) {
    const token = testCase.identity ? tokenOf(IDS[testCase.identity]) : undefined;
    const skip = testCase.identity && !token ? `no ${testCase.identity} identity token` : false;
    describe(`${testCase.fn}.${testCase.field}`, () => {
      for (const value of testCase.values ?? HOSTILE_VALUES) {
        test(describeValue(value), { skip }, async () => {
          const res = await call(testCase.fn, { token, body: testCase.body(value) });
          expectSafe(res, testCase.expect(value));
        });
      }
    });
  }
});

// ------------------------------------------------------------------------------- authorization
describe("authorization: Multi Testador room (one user acting on another user's room)", { skip: !has("host", "guests.0", "guests.1", "guests.2", "guests.3", "outsider", "noPlan") && "needs host, 4 guests, outsider and noPlan identities" }, () => {
  const host = IDS.host;
  const [g1, g2, g3, g4] = IDS.guests ?? [];
  const mt = (identity, body) => call("multi-tester", { token: tokenOf(identity), body });
  let room;
  let oldChannel;

  test("host creates a room; hostile nickname/color/duration are sanitized and clamped", async () => {
    let res = await mt(host, { action: "create", nickname: "<b>Host</b>\u0000\u0007 ‮ evil", color: "red;background:url(x)", durationMinutes: -1, idleTimeoutMinutes: 99_999 });
    if (res.json?.room && (res.json.room.durationMinutes !== 5 || res.json.members.length > 1)) {
      // A room left open by an earlier run on a real test project: end it and start clean.
      await mt(host, { action: "end", roomId: res.json.room.id });
      res = await mt(host, { action: "create", nickname: "<b>Host</b>\u0000\u0007 ‮ evil", color: "red;background:url(x)", durationMinutes: -1, idleTimeoutMinutes: 99_999 });
    }
    expectSafe(res, { status: 200 });
    room = res.json.room;
    assert.match(room.code, ROOM_CODE);
    assert.equal(room.durationMinutes, 5);
    assert.equal(room.idleTimeoutMinutes, 120);
    assert.ok(room.channel.startsWith(`mt:${room.id}:`));
    const me = res.json.members.find((member) => member.userId === idOf(host));
    assert.equal(me.role, "host");
    assert.doesNotMatch(me.nickname, /[<>\u0000-\u001f\u007f]/);
    assert.ok(me.nickname.length <= 40);
    assert.equal(me.color, "#5b35e8");
  });

  test("outsider (not a member) cannot read the room", async () => {
    expectSafe(await mt(IDS.outsider, { action: "state", roomId: room.id }), { status: 404, error: "room_not_found" });
  });

  test("user without the Release Manager plan cannot create or request", async () => {
    expectSafe(await mt(IDS.noPlan, { action: "create" }), { status: 403, error: "plan_required" });
    expectSafe(await mt(IDS.noPlan, { action: "request", code: room.code }), { status: 403, error: "plan_required" });
  });

  test("guest request with the code only creates a PENDING request with no member list, channel or code", async () => {
    const res = await mt(g1, { action: "request", code: `  ${room.code.toLowerCase()} `, nickname: "<img src=x onerror=alert(1)>Guest\u0000One", color: "#00ff00" });
    expectSafe(res, { status: 200 });
    assert.equal(res.json.me.status, "pending");
    assert.deepEqual(res.json.members, []);
    assert.equal(res.json.room.channel, null);
    assert.equal(res.json.room.code, null);
  });

  test("pending guest cannot approve itself, chat, or end the room", async () => {
    expectSafe(await mt(g1, { action: "approve", roomId: room.id, userId: idOf(g1) }), { status: 403, error: "host_only" });
    expectSafe(await mt(g1, { action: "chat", roomId: room.id, text: "hi" }), { status: 403, error: "not_allowed" });
    expectSafe(await mt(g1, { action: "end", roomId: room.id }), { status: 403, error: "host_only" });
  });

  test("outsider cannot approve, remove, reject, end or chat in someone else's room", async () => {
    expectSafe(await mt(IDS.outsider, { action: "approve", roomId: room.id, userId: idOf(g1) }), { status: 403, error: "host_only" });
    expectSafe(await mt(IDS.outsider, { action: "remove", roomId: room.id, userId: idOf(host) }), { status: 403, error: "host_only" });
    expectSafe(await mt(IDS.outsider, { action: "reject", roomId: room.id, userId: idOf(g1) }), { status: 403, error: "host_only" });
    expectSafe(await mt(IDS.outsider, { action: "end", roomId: room.id }), { status: 403, error: "host_only" });
    expectSafe(await mt(IDS.outsider, { action: "chat", roomId: room.id, text: "spoof" }), { status: 403, error: "not_allowed" });
  });

  test("outsider prototype-pollution body cannot smuggle action/roomId", async () => {
    const res = await call("multi-tester", { token: tokenOf(IDS.outsider), raw: `{"__proto__": {"action": "end", "roomId": "${room.id}"}}` });
    expectSafe(res, { status: 400, error: "invalid_id" });
    const state = await mt(host, { action: "state", roomId: room.id });
    expectSafe(state, { status: 200 });
    assert.equal(state.json.room.status, "open");
  });

  test("host sees the pending guest with a sanitized nickname", async () => {
    const res = await mt(host, { action: "state", roomId: room.id });
    expectSafe(res, { status: 200 });
    const guest = res.json.members.find((member) => member.userId === idOf(g1));
    assert.equal(guest.status, "pending");
    assert.doesNotMatch(guest.nickname, /[<>\u0000-\u001f\u007f]/);
  });

  test("host decisions validate the target: self, hostile ids, non-member, guest without plan", async () => {
    expectSafe(await mt(host, { action: "approve", roomId: room.id, userId: idOf(host) }), { status: 400, error: "invalid_target" });
    for (const value of [...ALL_HOSTILE_STRINGS.slice(0, 8), 123, null, {}]) {
      expectSafe(await mt(host, { action: "approve", roomId: room.id, userId: value }), { status: 400, error: "invalid_id" });
      expectSafe(await mt(host, { action: "remove", roomId: value, userId: idOf(g1) }), { status: 400, error: "invalid_id" });
    }
    expectSafe(await mt(host, { action: "approve", roomId: room.id, userId: idOf(IDS.outsider) }), { status: 409, error: "status_changed" });
    // A user who never asked to join: same answer as the outsider, whether or not they have the plan
    // (the host cannot probe other users' plans through approve).
    expectSafe(await mt(host, { action: "approve", roomId: room.id, userId: idOf(IDS.noPlan) }), { status: 409, error: "status_changed" });
  });

  test("approved guest gets the channel but never the code", async () => {
    expectSafe(await mt(host, { action: "approve", roomId: room.id, userId: idOf(g1) }), { status: 200 });
    const res = await mt(g1, { action: "state", roomId: room.id });
    expectSafe(res, { status: 200 });
    assert.equal(res.json.me.status, "active");
    assert.ok(res.json.room.channel?.startsWith(`mt:${room.id}:`));
    assert.equal(res.json.room.code, null);
    assert.ok(res.json.members.every((member) => member.status === "active"));
    oldChannel = res.json.room.channel;
  });

  test("active guest still cannot use host-only actions", async () => {
    expectSafe(await mt(g1, { action: "remove", roomId: room.id, userId: idOf(host) }), { status: 403, error: "host_only" });
    expectSafe(await mt(g1, { action: "end", roomId: room.id }), { status: 403, error: "host_only" });
  });

  test("consensus votes: only the host asks/announces, only an active guest votes, outsiders and pending get nothing", async () => {
    const voteId = "vSecuritySuite0001";
    expectSafe(await mt(g1, { action: "vote-request", roomId: room.id, voteId, description: "forged" }), { status: 403, error: "host_only" });
    expectSafe(await mt(g1, { action: "vote-result", roomId: room.id, voteId, approved: true }), { status: 403, error: "host_only" });
    expectSafe(await mt(host, { action: "vote", roomId: room.id, voteId, approve: true }), { status: 403, error: "guest_only" });
    expectSafe(await mt(IDS.outsider, { action: "vote", roomId: room.id, voteId, approve: true }), { status: 403, error: "not_allowed" });
    for (const value of [...ALL_HOSTILE_STRINGS.slice(0, 6), 123, null, {}]) {
      if (VOTE_ID.test(String(value ?? ""))) continue;
      expectSafe(await mt(g1, { action: "vote", roomId: room.id, voteId: value, approve: true }), { status: 400, error: "invalid_vote" });
    }
    expectSafe(await mt(host, { action: "vote-request", roomId: room.id, voteId, description: "\u0000\u0007<>" }), { status: 400, error: "invalid_vote" });
    expectSafe(await mt(g1, { action: "vote", roomId: room.id, voteId: "vNeverRequested01", approve: true }), { status: 404, error: "vote_not_found" });
    expectSafe(await mt(host, { action: "vote-request", roomId: room.id, voteId, description: "\"Salvar\" (POST /api/x)" }), { status: 200, check: (json) => assert.deepEqual(json, { sent: true }) });
    expectSafe(await mt(host, { action: "vote-request", roomId: room.id, voteId, description: "again" }), { status: 409, error: "vote_exists" });
    // The host cannot declare an approval the stored tally does not have.
    expectSafe(await mt(host, { action: "vote-result", roomId: room.id, voteId, approved: true }), { status: 409, error: "vote_not_approved" });
    let state = await mt(host, { action: "state", roomId: room.id });
    let vote = state.json.votes.find((item) => item.id === voteId);
    assert.equal(vote.status, "open");
    assert.deepEqual(vote.approvals, []);
    expectSafe(await mt(g1, { action: "vote", roomId: room.id, voteId, approve: true }), { status: 200, check: (json) => assert.deepEqual(json, { sent: true }) });
    expectSafe(await mt(g1, { action: "vote", roomId: room.id, voteId, approve: false }), { status: 409, errors: ["vote_closed", "already_voted"] });
    state = await mt(host, { action: "state", roomId: room.id });
    vote = state.json.votes.find((item) => item.id === voteId);
    assert.equal(vote.status, "approved");
    assert.deepEqual(vote.approvals, [idOf(g1)]);
    expectSafe(await mt(host, { action: "vote-result", roomId: room.id, voteId, approved: true }), { status: 200, check: (json) => assert.deepEqual(json, { sent: true }) });
    // A rejection settles the vote as rejected; a cancelled vote no longer takes ballots.
    expectSafe(await mt(host, { action: "vote-request", roomId: room.id, voteId: "vSecuritySuite0002", description: "Excluir" }), { status: 200 });
    expectSafe(await mt(g1, { action: "vote", roomId: room.id, voteId: "vSecuritySuite0002", approve: false }), { status: 200 });
    state = await mt(g1, { action: "state", roomId: room.id });
    assert.equal(state.json.votes.find((item) => item.id === "vSecuritySuite0002").status, "rejected");
    expectSafe(await mt(host, { action: "vote-request", roomId: room.id, voteId: "vSecuritySuite0003", description: "Arquivar" }), { status: 200 });
    expectSafe(await mt(host, { action: "vote-result", roomId: room.id, voteId: "vSecuritySuite0003", approved: false }), { status: 200 });
    expectSafe(await mt(g1, { action: "vote", roomId: room.id, voteId: "vSecuritySuite0003", approve: true }), { status: 409, error: "vote_closed" });
    // Outsiders never see votes or chat.
    expectSafe(await mt(IDS.outsider, { action: "state", roomId: room.id }), { status: 404, error: "room_not_found" });
  });

  test("chat is stored server-side with the sender from the token and served only through the state", async () => {
    expectSafe(await mt(g1, { action: "chat", roomId: room.id, text: "<img src=x onerror=alert(1)> oi" }), { status: 200 });
    const state = await mt(host, { action: "state", roomId: room.id });
    expectSafe(state, { status: 200 });
    const message = state.json.chat.at(-1);
    assert.equal(message.from, idOf(g1));
    assert.equal(message.text, "<img src=x onerror=alert(1)> oi");
    assert.ok(state.json.chat.length <= 50);
  });

  test("active member chat: hostile text is accepted as text, empty-after-cleanup is 400", async () => {
    for (const value of ALL_HOSTILE_STRINGS) {
      const cleaned = String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
      expectSafe(await mt(g1, { action: "chat", roomId: room.id, text: value }), cleaned ? { status: 200, check: (json) => assert.deepEqual(json, { sent: true }) } : { status: 400, error: "invalid_message" });
    }
  });

  test("oversized chat: 500+ chars is truncated server-side (200), a body over 16 KB is 413", async () => {
    expectSafe(await mt(g1, { action: "chat", roomId: room.id, text: "x".repeat(5_000) }), { status: 200, check: (json) => assert.deepEqual(json, { sent: true }) });
    expectSafe(await mt(g1, { action: "chat", roomId: room.id, text: "\u0000\u0001\u0007\u001b\u007f" }), { status: 400, error: "invalid_message" });
    const res = await call("multi-tester", { token: tokenOf(g1), raw: JSON.stringify({ action: "chat", roomId: room.id, text: "y".repeat(16_400) }) });
    expectSafe(res, { status: 413, error: "payload_too_large" });
  });

  test("foreign roomId: a member/host of one room cannot act on another user's room", async () => {
    const other = await mt(IDS.outsider, { action: "create", nickname: "Other host" });
    expectSafe(other, { status: 200 });
    const otherRoom = other.json.room;
    try {
      expectSafe(await mt(g1, { action: "state", roomId: otherRoom.id }), { status: 404, error: "room_not_found" });
      expectSafe(await mt(g1, { action: "chat", roomId: otherRoom.id, text: "cross-room" }), { status: 403, error: "not_allowed" });
      expectSafe(await mt(host, { action: "end", roomId: otherRoom.id }), { status: 403, error: "host_only" });
      expectSafe(await mt(host, { action: "remove", roomId: otherRoom.id, userId: idOf(IDS.outsider) }), { status: 403, error: "host_only" });
      expectSafe(await mt(host, { action: "approve", roomId: otherRoom.id, userId: idOf(g1) }), { status: 403, error: "host_only" });
      // Leaving a room you never joined does not touch it.
      expectSafe(await mt(g1, { action: "leave", roomId: otherRoom.id }), { status: 404, error: "room_not_found" });
      const still = await mt(IDS.outsider, { action: "state", roomId: otherRoom.id });
      expectSafe(still, { status: 200, check: (json) => assert.equal(json.room.status, "open") });
    } finally {
      await mt(IDS.outsider, { action: "end", roomId: otherRoom.id });
    }
  });

  test("room never exceeds 4 active members (host + 3)", async () => {
    for (const guest of [g2, g3]) {
      expectSafe(await mt(guest, { action: "request", code: room.code }), { status: 200 });
      expectSafe(await mt(host, { action: "approve", roomId: room.id, userId: idOf(guest) }), { status: 200 });
    }
    expectSafe(await mt(g4, { action: "request", code: room.code }), { status: 200 });
    expectSafe(await mt(host, { action: "approve", roomId: room.id, userId: idOf(g4) }), { status: 409, error: "room_full" });
  });

  test("rejected guest learns only its own status and cannot re-request", async () => {
    expectSafe(await mt(host, { action: "reject", roomId: room.id, userId: idOf(g4) }), { status: 200 });
    const res = await mt(g4, { action: "state", roomId: room.id });
    expectSafe(res, { status: 200 });
    assert.equal(res.json.me.status, "rejected");
    assert.equal(res.json.room.channel, null);
    assert.deepEqual(res.json.members, []);
    expectSafe(await mt(g4, { action: "request", code: room.code }), { status: 403, error: "not_allowed" });
  });

  test("removed guest is cut off: no channel, no members, no chat, cannot re-enter; channel epoch rotates", async () => {
    expectSafe(await mt(host, { action: "remove", roomId: room.id, userId: idOf(g1) }), { status: 200 });
    const hostState = await mt(host, { action: "state", roomId: room.id });
    assert.notEqual(hostState.json.room.channel, oldChannel, "removal must rotate the channel epoch");
    for (const action of ["state", "touch"]) {
      const res = await mt(g1, { action, roomId: room.id });
      expectSafe(res, { status: 200 });
      assert.equal(res.json.me.status, "removed");
      assert.equal(res.json.room.channel, null);
      assert.equal(res.json.room.code, null);
      assert.deepEqual(res.json.members, []);
    }
    expectSafe(await mt(g1, { action: "chat", roomId: room.id, text: "still here?" }), { status: 403, error: "not_allowed" });
    expectSafe(await mt(g1, { action: "request", code: room.code }), { status: 403, error: "not_allowed" });
  });

  test("a guest who left may ask again (pending), never straight back to active", async () => {
    expectSafe(await mt(g2, { action: "leave", roomId: room.id }), { status: 200, check: (json) => assert.equal(json.me.status, "left") });
    expectSafe(await mt(g2, { action: "request", code: room.code }), { status: 200, check: (json) => assert.equal(json.me.status, "pending") });
  });

  test("ended room: members lose the channel, old code is dead, host actions are 409", async () => {
    const code = room.code;
    expectSafe(await mt(host, { action: "end", roomId: room.id }), { status: 200, check: (json) => assert.equal(json.room.status, "ended") });
    const res = await mt(g3, { action: "state", roomId: room.id });
    expectSafe(res, { status: 200 });
    assert.equal(res.json.room.status, "ended");
    assert.equal(res.json.room.channel, null);
    expectSafe(await mt(IDS.outsider, { action: "request", code }), { status: 404, error: "room_not_found" });
    expectSafe(await mt(host, { action: "approve", roomId: room.id, userId: idOf(g2) }), { status: 409, error: "room_ended" });
  });
});

describe("authorization: account and admin surfaces", () => {
  test("account-delete schema is strict: a userId/target key to delete ANOTHER account is rejected", { skip: !has("plain") && "no plain identity" }, async () => {
    for (const extra of [{ userId: randomUUID() }, { user_id: randomUUID() }, { target_user_id: randomUUID() }, { email: "victim@example.com" }]) {
      const res = await call("account-delete", { token: tokenOf(IDS.plain), body: { password: "test-wrong-password-qts", ...extra } });
      expectSafe(res, { status: 400, error: "invalid_request" }, { gatewayAuth: true });
    }
  });

  test("admin-email-otp: a regular user cannot request or verify an admin OTP", { skip: !has("plain") && "no plain identity" }, async () => {
    expectSafe(await call("admin-email-otp", { token: tokenOf(IDS.plain), body: { action: "request" } }), { status: 403, error: "admin_access_denied" });
    expectSafe(await call("admin-email-otp", { token: tokenOf(IDS.plain), body: { action: "verify", challengeId: randomUUID(), otp: "12345678" } }), { status: 403, error: "otp_verification_required" });
  });

  test("cancel-access with a user that has nothing to cancel is 409, never another user's grant", { skip: (!ALLOW_DESTRUCTIVE && "destructive on a real target: set QTS_SECURITY_ALLOW_DESTRUCTIVE=1") || (!has("noPlan") && "no noPlan identity") }, async () => {
    const res = await call("cancel-access", { token: tokenOf(IDS.noPlan), body: { userId: idOf(IDS.plain), target_user_id: idOf(IDS.plain) } });
    expectSafe(res, { status: 409, error: "nothing_to_cancel" });
    if (has("plain")) {
      const access = await call("access-status", { token: tokenOf(IDS.plain), body: {} });
      expectSafe(access, { status: 200, check: (json) => assert.equal(json.active, true, "the other user's plan must be untouched") });
    }
  });

  test("access-status returns only the caller's own access (body cannot select another user)", { skip: !has("plain", "host") && "needs plain and host identities" }, async () => {
    const res = await call("access-status", { token: tokenOf(IDS.plain), body: { userId: idOf(IDS.host), user_id: idOf(IDS.host) } });
    expectSafe(res, { status: 200, check: (json) => assert.notEqual(json.features?.["multiTester.enabled"], true, "plain user must not receive the host's Release Manager features") });
  });
});

after(() => {
  if (masked.size) {
    const summary = [...masked].map(([name, count]) => `${name}=${count}`).join(", ");
    console.log(`# masked by rate limit (429, real target): ${summary}. Those cases proved only that the limiter answered; rerun later for full coverage.`);
  }
});
