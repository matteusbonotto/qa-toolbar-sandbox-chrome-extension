import fs from "node:fs";
import path from "node:path";

const envArgIndex = process.argv.indexOf("--env-file");
const projectArgIndex = process.argv.indexOf("--project-ref");
const envPath = path.resolve(envArgIndex >= 0 ? process.argv[envArgIndex + 1] : ".env.edge.local");
const projectRef = projectArgIndex >= 0 ? process.argv[projectArgIndex + 1] : "";
if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("Use --project-ref with the 20-character Supabase reference ID.");
const source = fs.readFileSync(envPath, "utf8");
const env = Object.fromEntries(source.split(/\r?\n/)
  .map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => { const at = line.indexOf("="); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; }));
const secretKey = env.STRIPE_SECRET_KEY;
if (!secretKey?.startsWith("sk_test_")) throw new Error("Webhook bootstrap requires a Stripe test-mode secret key.");

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
  if (!env.STRIPE_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_ENDPOINT_ID !== existing.id) {
    throw new Error("Endpoint already exists but its matching signing secret is not available locally; roll the secret in Stripe and update the env file.");
  }
  process.stdout.write(JSON.stringify({ created: false, endpointId: existing.id, url: targetUrl }));
} else {
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
  const values = { url: targetUrl, description: "QA Toolbar Sandbox — Supabase test webhook" };
  events.forEach((event, index) => { values[`enabled_events[${index}]`] = event; });
  const created = await stripeRequest("POST", "/webhook_endpoints", values);
  if (!created.secret?.startsWith("whsec_")) throw new Error("Stripe did not return a webhook signing secret.");

  const nextLine = `STRIPE_WEBHOOK_SECRET=${created.secret}`;
  let updated = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(source)
    ? source.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, nextLine)
    : `${source.replace(/\s*$/, "")}\n${nextLine}\n`;
  const endpointLine = `STRIPE_WEBHOOK_ENDPOINT_ID=${created.id}`;
  updated = /^STRIPE_WEBHOOK_ENDPOINT_ID=.*$/m.test(updated)
    ? updated.replace(/^STRIPE_WEBHOOK_ENDPOINT_ID=.*$/m, endpointLine)
    : `${updated.replace(/\s*$/, "")}\n${endpointLine}\n`;
  fs.writeFileSync(envPath, updated, "utf8");
  process.stdout.write(JSON.stringify({ created: true, endpointId: created.id, url: targetUrl }));
}
