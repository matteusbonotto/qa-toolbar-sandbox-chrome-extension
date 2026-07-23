import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_KEY = process.env.SUPABASE_PUBLIC_KEY;
const FOUNDER_EMAIL = "matteusbonotto+admin@gmail.com";
const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const label = `qts-admin-smoke-${runId}`;
const startedAt = new Date().toISOString();

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PUBLIC_KEY) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_PUBLIC_KEY are required");
}

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
let targetUser = null;
let founderSession = null;
let founderUserId = null;
let disposableFounderCreated = false;
let mfaSessionId = null;
const created = { voucher: null, campaign: null, grant: null, license: null };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function unwrap(promise, context) {
  const result = await promise;
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

async function findUserByEmail(email) {
  let page = 1;
  for (;;) {
    const data = await unwrap(service.auth.admin.listUsers({ page, perPage: 200 }), "list auth users");
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function createTargetUser() {
  const email = `qts-admin-target-${runId}@example.com`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const data = await unwrap(service.auth.admin.createUser({ email, password, email_confirm: true }), "create target user");
  targetUser = { ...data.user, password };
  return targetUser;
}

async function createFounderSession() {
  let founder = await findUserByEmail(FOUNDER_EMAIL);
  if (!founder) {
    const password = `${randomBytes(24).toString("base64url")}Aa1!`;
    const created = await unwrap(service.auth.admin.createUser({ email: FOUNDER_EMAIL, password, email_confirm: true }), "create disposable founder user");
    founder = created.user;
    disposableFounderCreated = true;
  } else if (!founder.email_confirmed_at) {
    throw new Error("Existing founder account is not confirmed; refusing to modify it");
  }
  founderUserId = founder.id;
  const link = await unwrap(service.auth.admin.generateLink({ type: "magiclink", email: FOUNDER_EMAIL }), "generate disposable founder link");
  assert(link.properties?.hashed_token, "Supabase did not return a hashed magic-link token");
  const authClient = createClient(SUPABASE_URL, PUBLIC_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const verified = await unwrap(authClient.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }), "verify disposable founder link");
  assert(verified.session?.access_token && verified.session?.refresh_token, "Disposable founder session was not created");
  founderSession = verified.session;

  const bootstrap = await unwrap(authClient.rpc("bootstrap_founder"), "bootstrap founder role");
  assert(bootstrap === true, "Founder bootstrap was refused");
  return founder;
}

async function clientForSession(session, mfaToken = null) {
  const client = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(mfaToken ? { global: { headers: { "x-admin-mfa-token": mfaToken } } } : {}),
  });
  await unwrap(client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }), "set authenticated session");
  return client;
}

async function proveMfa(founderId) {
  const rawToken = randomBytes(32).toString("base64url");
  assert(rawToken.length === 43, "MFA proof token has the wrong shape");
  const expiry = new Date(Date.now() + 55 * 60_000).toISOString();
  const inserted = await unwrap(service.from("admin_mfa_sessions").insert({
    user_id: founderId,
    token_hash: sha256(rawToken),
    expires_at: expiry,
  }).select("id").single(), "create disposable MFA proof");
  mfaSessionId = inserted.id;

  const overlong = await service.from("admin_mfa_sessions").insert({
    user_id: founderId,
    token_hash: sha256(randomBytes(32).toString("base64url")),
    expires_at: new Date(Date.now() + 61 * 60_000).toISOString(),
  });
  assert(overlong.error, "Database accepted an MFA proof longer than 60 minutes");
  return { rawToken, expiry };
}

async function assertMfaBoundary(noMfa, founder, planId) {
  const noProofDirectory = await noMfa.rpc("admin_list_users");
  assert(noProofDirectory.error, "admin_list_users worked without MFA proof");
  const noProofInsert = await noMfa.from("vouchers").insert({
    code_hash: sha256(`${label}-negative`), label: `${label}-negative`, plan_id: planId, kind: "days", grant_days: 1,
  });
  assert(noProofInsert.error, "Protected voucher mutation worked without MFA proof");
  const expiresAt = await unwrap(founder.rpc("admin_mfa_expires_at"), "verify live MFA expiry");
  assert(Date.parse(expiresAt) > Date.now() && Date.parse(expiresAt) <= Date.now() + 60 * 60_000, "Founder MFA proof expiry is invalid");
  console.log("[x] founder RLS requires a live MFA proof capped at 60 minutes");
}

async function smokeAdminCrud(founder, founderId, planId) {
  const voucher = await unwrap(founder.from("vouchers").insert({
    code_hash: sha256(`${label}-voucher`), label: `${label}-voucher`, plan_id: planId, kind: "lifetime", grant_days: null,
  }).select("id").single(), "founder creates voucher");
  created.voucher = voucher.id;
  await unwrap(founder.from("vouchers").update({ label: `${label}-voucher-edited`, status: "disabled" }).eq("id", voucher.id).select("id").single(), "founder edits voucher");
  await unwrap(founder.from("vouchers").update({ status: "available" }).eq("id", voucher.id).select("id").single(), "founder re-enables voucher");

  const campaign = await unwrap(founder.from("voucher_campaigns").insert({
    code_hash: sha256(`${label}-campaign`), label: `${label}-campaign`, plan_id: planId,
    kind: "days", grant_days: 30, maximum_redemptions: 2, enabled: true,
  }).select("id").single(), "founder creates campaign");
  created.campaign = campaign.id;
  await unwrap(founder.from("voucher_campaigns").update({ label: `${label}-campaign-edited`, enabled: false }).eq("id", campaign.id).select("id").single(), "founder edits campaign");
  await unwrap(founder.from("voucher_campaigns").update({ enabled: true }).eq("id", campaign.id).select("id").single(), "founder re-enables campaign");

  const grant = await unwrap(founder.from("entitlement_grants").insert({
    user_id: targetUser.id, plan_id: planId, source: "manual", expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  }).select("id").single(), "founder creates entitlement");
  created.grant = grant.id;
  await unwrap(founder.from("entitlement_grants").update({ revoked_at: new Date().toISOString() }).eq("id", grant.id).select("id").single(), "founder revokes entitlement");

  const licenseKey = `QTS-${randomBytes(6).toString("hex").toUpperCase()}`;
  const license = await unwrap(founder.from("license_keys").insert({
    key_prefix: licenseKey, key_hash: sha256(licenseKey), plan_id: planId,
    maximum_activations: 2, created_by: founderId,
  }).select("id").single(), "founder creates license");
  created.license = license.id;
  await unwrap(founder.from("license_keys").update({ revoked_at: new Date().toISOString() }).eq("id", license.id).select("id").single(), "founder revokes license");

  console.log("[x] live founder CRUD: vouchers, campaigns, entitlements and licenses");
}

async function smokeUsersRolesDashboardAudit(founder, founderId) {
  const roles = await unwrap(founder.from("roles").select("id,key"), "founder reads roles");
  const support = roles.find((role) => role.key === "support");
  const adminRole = roles.find((role) => role.key === "admin");
  const founderRole = roles.find((role) => role.key === "founder");
  assert(support && adminRole && founderRole, "Required role seed is incomplete");
  for (const role of [support, adminRole]) {
    await unwrap(founder.from("user_roles").insert({
      user_id: targetUser.id, role_id: role.id, granted_by: founderId, reason: `${label} matrix validation`,
    }), `grant ${role.key} role`);
  }

  const escalation = await founder.from("user_roles").insert({
    user_id: targetUser.id, role_id: founderRole.id, granted_by: founderId, reason: `${label} forbidden founder escalation`,
  });
  assert(escalation.error, "Founder role was granted outside bootstrap_founder()");

  const directory = await unwrap(founder.rpc("admin_list_users"), "founder lists users");
  assert(directory.some((user) => user.id === targetUser.id) && directory.some((user) => user.id === founderId), "Admin user directory is incomplete");

  const targetAuth = createClient(SUPABASE_URL, PUBLIC_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const targetSignIn = await unwrap(targetAuth.auth.signInWithPassword({ email: targetUser.email, password: targetUser.password }), "sign in target role user");
  const targetClient = await clientForSession(targetSignIn.session);
  const forbiddenMutation = await targetClient.from("vouchers").update({ status: "disabled" }).eq("id", created.voucher).select("id");
  assert(!forbiddenMutation.error && forbiddenMutation.data.length === 0, "Support/admin target mutated a founder-only voucher");
  const hiddenRoles = await targetClient.from("roles").select("id");
  assert(!hiddenRoles.error && hiddenRoles.data.length === 0, "Support/admin target read the founder-only role catalog");

  const dashboardTables = [
    ["subscriptions", "status,provider_price_id"],
    ["stripe_prices", "provider_price_id,billing_cycle,amount_minor,currency"],
    ["vouchers", "status"],
    ["license_activations", "revoked_at"],
    ["referrals", "status"],
    ["profiles", "id"],
  ];
  for (const [table, columns] of dashboardTables) await unwrap(founder.from(table).select(columns).limit(10), `dashboard reads ${table}`);

  for (const role of [support, adminRole]) {
    await unwrap(founder.from("user_roles").delete().eq("user_id", targetUser.id).eq("role_id", role.id).select("user_id"), `revoke ${role.key} role`);
  }
  const audit = await unwrap(founder.from("audit_logs").select("action,target_type,actor_id,created_at").eq("actor_id", founderId).gte("created_at", startedAt).limit(200), "read admin audit");
  for (const targetType of ["vouchers", "voucher_campaigns", "entitlement_grants", "license_keys", "user_roles"]) {
    assert(audit.some((entry) => entry.target_type === targetType), `Audit trail is missing ${targetType} mutations`);
  }
  console.log("[x] live users/roles matrix, dashboard queries and audit trail");
}

async function cleanup(founder) {
  if (founder) {
    if (created.voucher) await founder.from("vouchers").delete().eq("id", created.voucher);
    if (created.campaign) await founder.from("voucher_campaigns").delete().eq("id", created.campaign);
    if (created.grant) await founder.from("entitlement_grants").delete().eq("id", created.grant);
    if (created.license) await founder.from("license_keys").delete().eq("id", created.license);
  } else {
    await service.from("vouchers").delete().like("label", `${label}%`);
    await service.from("voucher_campaigns").delete().like("label", `${label}%`);
    if (created.grant) await service.from("entitlement_grants").delete().eq("id", created.grant);
    if (created.license) await service.from("license_keys").delete().eq("id", created.license);
  }
  if (mfaSessionId) await service.from("admin_mfa_sessions").delete().eq("id", mfaSessionId);
  if (targetUser) {
    await service.from("audit_logs").delete().eq("actor_id", targetUser.id);
    const result = await service.auth.admin.deleteUser(targetUser.id);
    if (result.error) console.warn(`cleanup warning for disposable admin target: ${result.error.message}`);
  }
  if (founderSession) await service.auth.admin.signOut(founderSession.access_token, "local").catch(() => {});
  if (disposableFounderCreated && founderUserId) {
    await service.from("audit_logs").delete().eq("actor_id", founderUserId);
    const result = await service.auth.admin.deleteUser(founderUserId);
    if (result.error) console.warn(`cleanup warning for disposable founder: ${result.error.message}`);
  }
}

let founderClient = null;
try {
  const founder = await createFounderSession();
  if (founder) {
    await createTargetUser();
    const plan = await unwrap(service.from("plans").select("id").eq("key", "regression-runner").single(), "read admin smoke plan");
    const proof = await proveMfa(founder.id);
    const noMfaClient = await clientForSession(founderSession);
    founderClient = await clientForSession(founderSession, proof.rawToken);
    await assertMfaBoundary(noMfaClient, founderClient, plan.id);
    await smokeAdminCrud(founderClient, founder.id, plan.id);
    await smokeUsersRolesDashboardAudit(founderClient, founder.id);
    console.log("LIVE_ADMIN_SMOKE=passed");
  }
} finally {
  await cleanup(founderClient);
}
