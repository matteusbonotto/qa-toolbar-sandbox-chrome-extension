import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_KEY = process.env.SUPABASE_PUBLIC_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ORIGIN = "https://matteusbonotto.github.io";
const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const label = `qts-live-smoke-${runId}`;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PUBLIC_KEY || !STRIPE_SECRET_KEY) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLIC_KEY and STRIPE_SECRET_KEY are required");
}
if (!STRIPE_SECRET_KEY.startsWith("sk_test_")) throw new Error("Live Stripe keys are refused by this smoke test");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const createdUserIds = [];
const createdStripeIds = { customer: null, subscription: null };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function publicClient() {
  return createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function unwrap(promise, context) {
  const result = await promise;
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

async function createUser(role) {
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const email = `qts-smoke-${role}-${runId}@example.com`;
  const data = await unwrap(admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${role} user`);
  createdUserIds.push(data.user.id);
  const client = publicClient();
  const signedIn = await unwrap(client.auth.signInWithPassword({ email, password }), `sign in ${role} user`);
  assert(signedIn.session?.access_token, `${role} user has no access token`);
  return { id: data.user.id, email, client, token: signedIn.session.access_token };
}

async function edge(name, token, body) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: PUBLIC_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      origin: ORIGIN,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function stripe(path, values = {}, method = "POST") {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(method === "POST" ? { body: new URLSearchParams(values) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Stripe ${method} ${path} failed: ${payload.error?.message || response.status}`);
  return payload;
}

async function poll(description, callback, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await callback();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function fillAcrossFrames(page, selector, value) {
  return poll(`field ${selector}`, async () => {
    for (const frame of page.frames()) {
      const field = frame.locator(selector).first();
      if (await field.count() && await field.isVisible().catch(() => false)) {
        await field.fill(value);
        return true;
      }
    }
    return false;
  }, 30_000);
}

async function fillOptionalAcrossFrames(page, selector, value) {
  for (const frame of page.frames()) {
    try {
      const field = frame.locator(selector).first();
      if (await field.count() && await field.isVisible().catch(() => false)) {
        await field.fill(value);
        return;
      }
    } catch { /* Stripe can detach payment frames while completing validation. */ }
  }
}

async function completeHostedCheckout(checkoutUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await fillAcrossFrames(page, 'input[name="cardNumber"], input#cardNumber', "4242424242424242");
    await fillAcrossFrames(page, 'input[name="cardExpiry"], input#cardExpiry', "1234");
    await fillAcrossFrames(page, 'input[name="cardCvc"], input#cardCvc', "123");
    for (const [selector, value] of [
      ['input[name="billingName"], input#billingName', "QA Live Smoke"],
      ['input[name="billingPostalCode"], input#billingPostalCode', "01310100"],
    ]) {
      await fillOptionalAcrossFrames(page, selector, value);
    }
    assert(!page.isClosed(), "Stripe Checkout closed unexpectedly before submission");
    const submit = page.locator('button[type="submit"], [data-testid="hosted-payment-submit-button"]').filter({ visible: true }).last();
    await submit.click({ timeout: 30_000 });
    await page.waitForURL((url) => url.hostname === "matteusbonotto.github.io", { timeout: 120_000 });
  } catch (error) {
    const evidenceDir = resolve("artifacts", "live-backend-smoke");
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDir, "checkout-failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

async function smokeVoucherAndCampaign(planId) {
  const voucherUser = await createUser("voucher");
  const campaignUser = await createUser("campaign");
  const voucherCode = `LIVE-${randomBytes(6).toString("hex").toUpperCase()}`;
  const campaignCode = `CAMP-${randomBytes(6).toString("hex").toUpperCase()}`;

  const voucher = await unwrap(admin.from("vouchers").insert({
    code_hash: sha256(voucherCode), label: `${label}-voucher`, plan_id: planId,
    grant_days: null, status: "available",
  }).select("id").single(), "insert live voucher");
  const campaign = await unwrap(admin.from("voucher_campaigns").insert({
    code_hash: sha256(campaignCode), label: `${label}-campaign`, plan_id: planId,
    grant_days: 30, maximum_redemptions: 1, enabled: true,
  }).select("id").single(), "insert live campaign");

  const redeemed = await edge("voucher-redeem", voucherUser.token, { code: voucherCode });
  assert(redeemed.response.status === 200 && redeemed.payload.redeemed, "Authenticated single-use voucher redemption failed");
  assert(redeemed.payload.expiresAt === null, "Lifetime voucher did not create permanent access");
  const reused = await edge("voucher-redeem", voucherUser.token, { code: voucherCode });
  assert(reused.response.status === 409, "Single-use voucher was accepted twice");

  const campaignRedeemed = await edge("voucher-redeem", campaignUser.token, { code: campaignCode });
  assert(campaignRedeemed.response.status === 200 && campaignRedeemed.payload.redeemed, "Campaign voucher redemption failed");
  const campaignRow = await unwrap(admin.from("voucher_campaigns").select("redemption_count").eq("id", campaign.id).single(), "read campaign count");
  assert(campaignRow.redemption_count === 1, "Campaign redemption count was not updated transactionally");

  const voucherRow = await unwrap(admin.from("vouchers").select("status,redeemed_by").eq("id", voucher.id).single(), "read voucher status");
  assert(voucherRow.status === "used" && voucherRow.redeemed_by === voucherUser.id, "Voucher state was not persisted");
  console.log("[x] voucher-redeem: authenticated single-use and campaign redemption validated live");
}

async function smokeCheckoutReferralAndWebhook(planId, priceId) {
  const referrer = await createUser("referrer");
  const referred = await createUser("referred");
  const referralCode = `QTS-${randomBytes(4).toString("hex").toUpperCase()}`;
  await unwrap(admin.from("referral_profiles").update({ referral_code: referralCode }).eq("user_id", referrer.id).select("user_id").single(), "configure referral profile");

  const referral = await edge("referral-track", referred.token, { referralCode });
  assert(referral.response.status === 200 && referral.payload.registered, "Authenticated referral registration failed");

  const checkout = await edge("checkout-create-session", referred.token, {
    planKey: "regression-runner", billingCycle: "monthly", requestId: randomUUID(),
  });
  assert(checkout.response.status === 200 && checkout.payload.checkoutUrl?.startsWith("https://checkout.stripe.com/"), "Checkout did not return a hosted Stripe URL");
  const customer = await unwrap(admin.from("payment_customers").select("provider_customer_id").eq("user_id", referred.id).single(), "read Stripe customer");
  createdStripeIds.customer = customer.provider_customer_id;

  await completeHostedCheckout(checkout.payload.checkoutUrl);
  const subscription = await poll("Stripe subscription webhook", async () => {
    const result = await admin.from("subscriptions").select("provider_subscription_id,status,plan_id,provider_price_id").eq("user_id", referred.id).maybeSingle();
    if (result.error) throw result.error;
    return result.data?.status === "active" ? result.data : null;
  });
  createdStripeIds.subscription = subscription.provider_subscription_id;
  assert(subscription.plan_id === planId && subscription.provider_price_id === priceId, "Webhook synchronized the wrong plan/price");

  const completedSession = await unwrap(admin.from("checkout_sessions").select("status").eq("user_id", referred.id).single(), "read Checkout session");
  assert(completedSession.status === "complete", "checkout.session.completed did not mark the local Checkout session complete");
  const rewarded = await poll("referral reward", async () => {
    const result = await admin.from("referrals").select("status,reward_reference").eq("referred_user_id", referred.id).single();
    if (result.error) throw result.error;
    return result.data.status === "rewarded" ? result.data : null;
  });
  assert(rewarded.reward_reference, "Referral was rewarded without a grant reference");
  const rewardGrant = await unwrap(admin.from("entitlement_grants").select("user_id,source,expires_at").eq("id", rewarded.reward_reference).single(), "read referral reward grant");
  assert(rewardGrant.user_id === referrer.id && rewardGrant.source === "manual" && new Date(rewardGrant.expires_at) > new Date(), "Referral reward grant is invalid");

  const access = await edge("access-status", referred.token, {});
  assert(access.response.status === 200 && access.payload.active === true, "access-status did not release paid access after the webhook");
  const invoiceEvent = await unwrap(admin.from("payment_events").select("id").eq("user_id", referred.id).eq("event_type", "invoice.paid").limit(1).maybeSingle(), "read invoice event");
  assert(invoiceEvent, "A real invoice.paid event was not persisted");
  console.log("[x] checkout + Stripe payment + signed webhooks + access-status validated live");
  console.log("[x] referral-track + first-payment reward validated live");
}

async function cleanup() {
  if (createdStripeIds.subscription) {
    await stripe(`/subscriptions/${createdStripeIds.subscription}`, {}, "DELETE").catch(() => {});
  }
  if (createdStripeIds.customer) {
    await stripe(`/customers/${createdStripeIds.customer}`, {}, "DELETE").catch(() => {});
  }
  if (createdStripeIds.subscription || createdStripeIds.customer) await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));

  if (createdUserIds.length) {
    const payments = await admin.from("payment_events").select("id,webhook_event_id").in("user_id", createdUserIds);
    const webhookIds = [...new Set((payments.data || []).map((row) => row.webhook_event_id))];
    await admin.from("payment_events").delete().in("user_id", createdUserIds);
    if (webhookIds.length) await admin.from("webhook_events").delete().in("id", webhookIds);
    await admin.from("audit_logs").delete().in("actor_id", createdUserIds);
  }
  await admin.from("vouchers").delete().like("label", `${label}%`);
  await admin.from("voucher_campaigns").delete().like("label", `${label}%`);
  for (const userId of [...createdUserIds].reverse()) {
    const result = await admin.auth.admin.deleteUser(userId);
    if (result.error) console.warn(`cleanup warning for disposable user: ${result.error.message}`);
  }
}

async function main() {
  const plan = await unwrap(admin.from("plans").select("id").eq("key", "regression-runner").single(), "read regression plan");
  const price = await unwrap(admin.from("stripe_prices").select("provider_price_id").eq("plan_id", plan.id).eq("billing_cycle", "monthly").eq("is_active", true).single(), "read monthly Stripe price");
  await smokeVoucherAndCampaign(plan.id);
  await smokeCheckoutReferralAndWebhook(plan.id, price.provider_price_id);
}

try {
  await main();
  console.log("LIVE_BACKEND_SMOKE=passed");
} finally {
  await cleanup();
}
