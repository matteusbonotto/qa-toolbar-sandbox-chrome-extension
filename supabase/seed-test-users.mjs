// Creates the QA test accounts requested for this project.
//
// This script must be run by YOU, locally, with your own Supabase
// service-role key — Claude never receives or uses that key.
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   QTS_TEST_USER_PASSWORD='<local password>' \
//   node supabase/seed-test-users.mjs
//
// What it does:
//   1. Creates (or reuses) 4 auth users, one per plan, all pre-confirmed,
//      password supplied through QTS_TEST_USER_PASSWORD, and grants each an entitlement_grant for its
//      matching plan (source = 'manual', permanent).
//   2. Creates a 5th "voucher tester" account (no plan) plus 3 ready-to-use
//      voucher codes (percent-off, extra-days, lifetime) printed to stdout
//      in plaintext ONCE — only the SHA-256 hash is stored in the database,
//      exactly like a real voucher, so write the codes down when they print.
//
// Safe to re-run: existing users/plans/vouchers are detected and skipped.

import { createClient } from "@supabase/supabase-js";
import { webcrypto } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_PASSWORD = process.env.QTS_TEST_USER_PASSWORD;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TEST_USER_PASSWORD) {
  console.error(
    "Missing env vars. Run as:\n" +
      "  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... QTS_TEST_USER_PASSWORD='<local password>' node supabase/seed-test-users.mjs",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_USERS = [
  { email: "matteusbonotto+st@gmail.com", planKey: "smoke-test", label: "Free / Smoke Test" },
  { email: "matteusbonotto+rr@gmail.com", planKey: "regression-runner", label: "Regression Runner" },
  { email: "matteusbonotto+rca@gmail.com", planKey: "root-cause-analyst", label: "Root Cause Analyst" },
  { email: "matteusbonotto+rm@gmail.com", planKey: "release-manager", label: "Release Manager" },
];

const VOUCHER_TESTER_EMAIL = "matteusbonotto+voucher@gmail.com";

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await webcrypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomCode(prefix) {
  const bytes = webcrypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes)
    .map((b) => b.toString(36))
    .join("")
    .toUpperCase()
    .slice(0, 8);
  return `${prefix}-${suffix}`;
}

async function findUserByEmail(email) {
  // Admin API has no direct "get by email"; page through until found.
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureUser(email) {
  const existing = await findUserByEmail(email);
  if (existing) {
    console.log(`  user exists: ${email} (${existing.id})`);
    return existing;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: TEST_USER_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`  created: ${email} (${data.user.id})`);
  return data.user;
}

async function ensurePlanGrant(userId, planKey) {
  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id")
    .eq("key", planKey)
    .single();
  if (planError) throw planError;

  const { data: existingGrant } = await supabase
    .from("entitlement_grants")
    .select("id")
    .eq("user_id", userId)
    .eq("plan_id", plan.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (existingGrant) {
    console.log(`    already has an active grant for ${planKey}`);
    return;
  }

  const { error: grantError } = await supabase.from("entitlement_grants").insert({
    user_id: userId,
    plan_id: plan.id,
    source: "manual",
    expires_at: null,
  });
  if (grantError) throw grantError;
  console.log(`    granted plan ${planKey}`);
}

async function ensureVoucher({ label, planKey, grantDays, kind }) {
  const { data: existing } = await supabase
    .from("vouchers")
    .select("id, code_hash")
    .eq("label", label)
    .maybeSingle();
  if (existing) {
    console.log(`  voucher already exists: ${label} (code not re-printed — check your records)`);
    return;
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id")
    .eq("key", planKey)
    .single();
  if (planError) throw planError;

  const code = randomCode(kind);
  const codeHash = await sha256Hex(code);

  const { error } = await supabase.from("vouchers").insert({
    code_hash: codeHash,
    label,
    plan_id: plan.id,
    grant_days: grantDays,
    status: "available",
  });
  if (error) throw error;

  console.log(`  created voucher "${label}": ${code}  (write this down now — it will not be shown again)`);
}

async function main() {
  console.log("Creating plan test users...");
  for (const u of TEST_USERS) {
    console.log(`- ${u.label} <${u.email}>`);
    const user = await ensureUser(u.email);
    await ensurePlanGrant(user.id, u.planKey);
  }

  console.log("\nCreating voucher tester account...");
  await ensureUser(VOUCHER_TESTER_EMAIL);

  console.log("\nCreating sample vouchers to redeem with that account...");
  await ensureVoucher({
    label: "QA test — 20% desconto",
    planKey: "regression-runner",
    grantDays: 30,
    kind: "DESC20",
  });
  await ensureVoucher({
    label: "QA test — 30 dias extra",
    planKey: "root-cause-analyst",
    grantDays: 30,
    kind: "EXTRA30",
  });
  await ensureVoucher({
    label: "QA test — vitalício",
    planKey: "release-manager",
    grantDays: 36500,
    kind: "LIFETIME",
  });

  console.log("\nDone. All plan-test accounts use the password supplied through QTS_TEST_USER_PASSWORD.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
