import fs from "node:fs";
import path from "node:path";

const envArgIndex = process.argv.indexOf("--env-file");
const envPath = path.resolve(envArgIndex >= 0 ? process.argv[envArgIndex + 1] : ".env.edge.local");
const archiveLegacy = process.argv.includes("--archive-legacy");
const confirmLive = process.argv.includes("--confirm-live");
if (!fs.existsSync(envPath)) throw new Error(`Environment file not found: ${envPath}`);
const env = Object.fromEntries(fs.readFileSync(envPath, "utf8").split(/\r?\n/)
  .map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => { const at = line.indexOf("="); const value = line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, "$2"); return [line.slice(0, at).trim(), value]; }));
const secretKey = confirmLive ? (env.STRIPE_LIVE_SECRET_KEY ?? env.STRIP_SECRET_PROD ?? env.STRIP_SECRET_PRD) : (env.STRIPE_TEST_SECRET_KEY ?? env.STRIPE_SECRET_KEY ?? env.STRIP_SECRET);
const liveMode = secretKey?.startsWith("sk_live_");
if (!liveMode && !secretKey?.startsWith("sk_test_")) throw new Error("Catalog bootstrap requires a valid Stripe secret key.");
if (liveMode && !confirmLive) throw new Error("Live Stripe changes require --confirm-live.");

async function stripeRequest(method, endpoint, values, idempotencyKey) {
  const headers = { Authorization: `Bearer ${secretKey}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
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

const catalogVersion = "qts-2026-07";
const plans = [
  { key: "regression-runner", name: "QA Toolbar — Regression Runner", monthly: 1900, yearly: 18200 },
  { key: "root-cause-analyst", name: "QA Toolbar — Root Cause Analyst", monthly: 3900, yearly: 37400 },
  { key: "release-manager", name: "QA Toolbar — Release Manager", monthly: 6900, yearly: 66200 },
];
const listedProducts = await stripeRequest("GET", "/products?active=true&limit=100");
const output = {};
for (const plan of plans) {
  let product = listedProducts.data.find((item) =>
    item.metadata?.qts_plan_key === plan.key && item.metadata?.qts_catalog_version === catalogVersion);
  if (!product) {
    product = await stripeRequest("POST", "/products", {
      name: plan.name,
      "metadata[qts_plan_key]": plan.key,
      "metadata[qts_catalog_version]": catalogVersion,
    }, `qts-product-${catalogVersion}-${plan.key}`);
  }
  const listedPrices = await stripeRequest("GET", `/prices?active=true&product=${encodeURIComponent(product.id)}&limit=100`);
  for (const [cycle, amount] of [["monthly", plan.monthly], ["yearly", plan.yearly]]) {
    const interval = cycle === "monthly" ? "month" : "year";
    let price = listedPrices.data.find((item) => item.currency === "brl" && item.unit_amount === amount
      && item.recurring?.interval === interval && item.metadata?.qts_catalog_version === catalogVersion);
    if (!price) {
      price = await stripeRequest("POST", "/prices", {
        product: product.id,
        currency: "brl",
        unit_amount: String(amount),
        "recurring[interval]": interval,
        "metadata[qts_plan_key]": plan.key,
        "metadata[qts_billing_cycle]": cycle,
        "metadata[qts_catalog_version]": catalogVersion,
      }, `qts-price-${catalogVersion}-${plan.key}-${cycle}`);
    }
    const envKey = `STRIPE_${plan.key.replaceAll("-", "_").toUpperCase()}_${cycle.toUpperCase()}_PRICE_ID`;
    output[envKey] = price.id;
  }
}

if (archiveLegacy) {
  for (const product of listedProducts.data) {
    if (["QA Toolbar Pro", "QA Toolbar Scale"].includes(product.name)
      && product.metadata?.qts_catalog_version !== catalogVersion) {
      await stripeRequest("POST", `/products/${product.id}`, { active: "false" }, `qts-archive-${product.id}`);
    }
  }
}

process.stdout.write(JSON.stringify(output));
