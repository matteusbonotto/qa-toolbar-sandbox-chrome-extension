import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const configuredIds = source.match(/^ALLOWED_EXTENSION_IDS=(.+)$/m)?.[1]
  .split(",").map((value) => value.trim()).filter(Boolean) ?? [];
const additionalIds = process.env.CORS_EXTENSION_IDS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
const extensionIds = [...new Set([...configuredIds, ...additionalIds])];
const projectRef = process.env.SUPABASE_PROJECT_REF ?? "rvkgwhosnjrgyeztugtg";
const functions = [
  "auth-sign-in", "auth-sign-up", "auth-refresh", "billing-status", "register-installation",
  "redeem-voucher", "create-checkout", "create-customer-portal", "promotion-status",
];
const disallowedExtensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const disallowedWebOrigin = "https://evil.example";

if (!extensionIds.length) throw new Error("No extension IDs are configured for the CORS matrix");

const failures = [];

// 1. Positive matrix: every configured extension ID must get a matching preflight for every function.
for (const extensionId of extensionIds) {
  const origin = `chrome-extension://${extensionId}`;
  for (const functionName of functions) {
    const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/${functionName}`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,apikey,content-type",
      },
    });
    const allowedOrigin = response.headers.get("access-control-allow-origin");
    if (response.status !== 204 || allowedOrigin !== origin) {
      failures.push({ check: "positive-preflight", functionName, origin, status: response.status, allowedOrigin });
    }
  }
}

// 2. Negative preflight: an origin/ID that is NOT in the allowlist must be rejected (403), never echoed back.
for (const origin of [`chrome-extension://${disallowedExtensionId}`, disallowedWebOrigin]) {
  for (const functionName of [functions[0], functions[3]]) {
    const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/${functionName}`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,apikey,content-type",
      },
    });
    const allowedOrigin = response.headers.get("access-control-allow-origin");
    if (response.status !== 403 || allowedOrigin) {
      failures.push({ check: "negative-preflight-rejected", functionName, origin, status: response.status, allowedOrigin });
    }
  }
}

// 3. Real POST request (not just OPTIONS): confirm the function is actually reachable end to end
//    from an allowed extension origin and still returns the correct CORS header on the real response
//    (including on error responses, per the CORS checklist), using an intentionally invalid body so no
//    real account/session is required to run this check.
for (const extensionId of extensionIds) {
  const origin = `chrome-extension://${extensionId}`;
  const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/billing-status`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const allowedOrigin = response.headers.get("access-control-allow-origin");
  const acceptableStatus = response.status === 400 || response.status === 401;
  if (!acceptableStatus || allowedOrigin !== origin) {
    failures.push({ check: "real-post-request", functionName: "billing-status", origin, status: response.status, allowedOrigin });
  }
}

if (failures.length) throw new Error(`CORS matrix failed:\n${JSON.stringify(failures, null, 2)}`);
console.log(`CORS matrix passed (${extensionIds.length} extension IDs x ${functions.length} functions, positive + negative + real-POST checks)`);
