import fs from "node:fs";
import path from "node:path";

const envArgIndex = process.argv.indexOf("--env-file");
const projectArgIndex = process.argv.indexOf("--project-ref");
const emitSigningSecret = process.argv.includes("--emit-signing-secret");
const confirmLive = process.argv.includes("--confirm-live");
const envPath = path.resolve(envArgIndex >= 0 ? process.argv[envArgIndex + 1] : ".env.edge.local");
const projectRef = projectArgIndex >= 0 ? process.argv[projectArgIndex + 1] : "";
if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("Use --project-ref with the 20-character Supabase reference ID.");
const source = fs.readFileSync(envPath, "utf8");
const env = Object.fromEntries(source.split(/\r?\n/)
  .map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => { const at = line.indexOf("="); const value = line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, "$2"); return [line.slice(0, at).trim(), value]; }));
const secretKey = confirmLive ? (env.STRIPE_LIVE_SECRET_KEY ?? env.STRIP_SECRET_PROD ?? env.STRIP_SECRET_PRD) : (env.STRIPE_TEST_SECRET_KEY ?? env.STRIPE_SECRET_KEY ?? env.STRIP_SECRET);
const liveMode = secretKey?.startsWith("sk_live_");
if (!liveMode && !secretKey?.startsWith("sk_test_")) throw new Error("Webhook bootstrap requires a valid Stripe secret key.");
if (liveMode && !confirmLive) throw new Error("Live Stripe changes require --confirm-live.");

async function stripeRequest(method, endpoint, values) {
  const headers = { Authorization: `Bearer ${secretKey}` };
  const options = { method, headers };
  if (values) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(values);
  }
  const response = await fetch(`https://api.stripe.com/v1${endpoint}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`Stripe ${method} ${endpoint} failed: ${body.error?.message ?? response.status}`);
  return body;
}

const targetUrl = `https://${projectRef}.supabase.co/functions/v1/stripe-webhook`;
const listed = await stripeRequest("GET", "/webhook_endpoints?limit=100");
const existing = listed.data.find((item) => item.url === targetUrl && item.status === "enabled");
if (existing) {
  const signingSecret = env[liveMode ? "STRIPE_LIVE_WEBHOOK_SECRET" : "STRIPE_TEST_WEBHOOK_SECRET"];
  if (!/^whsec_[A-Za-z0-9]{16,128}$/.test(signingSecret ?? "")
    || !/^we_[A-Za-z0-9]{8,128}$/.test(existing.id ?? "")
    || env[liveMode ? "STRIPE_LIVE_WEBHOOK_ENDPOINT_ID" : "STRIPE_TEST_WEBHOOK_ENDPOINT_ID"] !== existing.id) {
    throw new Error("Endpoint already exists but its matching signing secret is not available locally; roll the secret in Stripe and update the env file.");
  }
  process.stdout.write(JSON.stringify({ created: false, endpointId: existing.id, url: targetUrl }));
} else {
  if (!emitSigningSecret) {
    throw new Error("Use the PowerShell wrapper so the new signing secret is captured without printing it.");
  }
  const events = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.closed",
  ];
  const values = { url: targetUrl, description: `QA Toolbar Sandbox — Supabase ${liveMode ? "production" : "test"} webhook` };
  events.forEach((event, index) => { values[`enabled_events[${index}]`] = event; });
  const created = await stripeRequest("POST", "/webhook_endpoints", values);
  if (created.object !== "webhook_endpoint" || created.url !== targetUrl
    || !/^whsec_[A-Za-z0-9]{16,128}$/.test(created.secret ?? "")
    || !/^we_[A-Za-z0-9]{8,128}$/.test(created.id ?? "")) {
    throw new Error("Stripe returned an invalid webhook endpoint response.");
  }
  process.stdout.write(JSON.stringify({
    created: true,
    endpointId: created.id,
    url: targetUrl,
    signingSecret: created.secret,
  }));
}
