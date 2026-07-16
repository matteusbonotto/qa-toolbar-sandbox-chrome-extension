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

if (!extensionIds.length) throw new Error("No extension IDs are configured for the CORS matrix");

const failures = [];
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
    if (response.status !== 204 || allowedOrigin !== origin) failures.push({ functionName, origin, status: response.status, allowedOrigin });
  }
}

if (failures.length) throw new Error(`CORS matrix failed:\n${JSON.stringify(failures, null, 2)}`);
console.log(`CORS matrix passed (${extensionIds.length} extension IDs x ${functions.length} Edge Functions)`);
