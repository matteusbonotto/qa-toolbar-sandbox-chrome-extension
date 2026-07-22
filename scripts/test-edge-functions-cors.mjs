import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((item, index, all) => {
  if (!item.startsWith("--")) return [Symbol.for(`ignored-${index}`), item];
  return [item.slice(2), all[index + 1]];
}).filter(([key]) => typeof key === "string"));

const envFile = path.resolve(String(args["env-file"] ?? ".env.edge.local"));
if (!fs.existsSync(envFile)) throw new Error(`Environment file not found: ${envFile}`);

const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/)
  .map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => { const at = line.indexOf("="); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; }));
const baseUrl = String(args["base-url"] ?? env.SUPABASE_URL ?? "").replace(/^['"]|['"]$/g, "").replace(/\/$/, "");
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(baseUrl)) {
  throw new Error("Use --base-url https://<project-ref>.supabase.co or set SUPABASE_URL in the ignored env file");
}
const webOrigins = (env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const extensionOrigins = (env.ALLOWED_EXTENSION_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  .map((id) => `chrome-extension://${id}`);
const allowedOrigins = [...webOrigins, ...extensionOrigins];
if (!allowedOrigins.length) throw new Error("ALLOWED_ORIGINS / ALLOWED_EXTENSION_IDS are empty");

const functions = ["checkout-create-session", "stripe-webhook", "voucher-redeem", "voucher-preview", "legal-registration", "referral-track", "keep-alive", "access-status", "auth-sign-in", "auth-refresh", "auth-recover-password", "admin-email-otp"];
let assertions = 0;
for (const functionName of functions) {
  const endpoint = `${baseUrl}/functions/v1/${functionName}`;
  for (const origin of allowedOrigins) {
    const response = await fetch(endpoint, {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,x-correlation-id,x-admin-mfa-token" },
    });
    if (response.status !== 204) throw new Error(`${functionName}: ${origin} returned ${response.status}, expected 204`);
    if (response.headers.get("access-control-allow-origin") !== origin) {
      throw new Error(`${functionName}: Access-Control-Allow-Origin mismatch for ${origin}`);
    }
    if (!(response.headers.get("access-control-allow-headers") ?? "").includes("x-admin-mfa-token")) {
      throw new Error(`${functionName}: admin MFA header is not allowed by CORS`);
    }
    assertions += 3;
  }
  const denied = await fetch(endpoint, {
    method: "OPTIONS",
    headers: { origin: "https://origin-not-authorized.invalid", "access-control-request-method": "POST" },
  });
  if (denied.status !== 403 || denied.headers.has("access-control-allow-origin")) {
    throw new Error(`${functionName}: unknown origin was not rejected safely`);
  }
  assertions += 2;
}
console.log(`CORS verification passed: ${functions.length} functions, ${allowedOrigins.length} allowed origins, ${assertions} assertions.`);
