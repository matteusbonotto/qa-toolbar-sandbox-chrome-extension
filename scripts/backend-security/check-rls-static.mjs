// Static RLS / SECURITY DEFINER audit of supabase/schema.sql (the "new project from zero" source of
// truth, kept in sync with migrations by check-schema-sync.mjs). No database needed. Fails when:
//   1. a public table has no `enable row level security`;
//   2. a policy uses `using (true)` / `with check (true)` for anything other than SELECT on an
//      explicitly allowlisted public catalog table (sensitive tables are never allowlisted);
//   3. a SECURITY DEFINER function has no `set search_path` (search_path hijack);
//   4. a SECURITY DEFINER function (not a trigger) keeps the default EXECUTE for PUBLIC: Postgres
//      grants it to everyone unless revoked, which exposes it to `anon` through PostgREST RPC.
//      Exceptions must be justified in PUBLIC_EXECUTE_ALLOWED.
//
// Usage: node scripts/backend-security/check-rls-static.mjs [--schema=path]

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Catalog data the Landing reads anonymously. Anything else with `using (true)` fails.
export const PUBLIC_READ_TABLES = new Set([
  "features", "plan_features", "app_versions", "store_listing_status", "legal_registration", "feature_flags",
]);
// Never readable with `true`, even if someone adds them to the allowlist by mistake.
export const SENSITIVE_TABLES = new Set([
  "profiles", "user_roles", "roles", "entitlement_grants", "entitlement_overrides", "installations", "payment_customers",
  "checkout_sessions", "subscriptions", "webhook_events", "payment_events", "license_keys", "license_activations",
  "vouchers", "voucher_campaigns", "voucher_campaign_redemptions", "voucher_reservations", "referral_profiles", "referrals",
  "engagement_campaign_submissions", "audit_logs", "api_rate_limits", "admin_otp_challenges", "admin_mfa_sessions",
  "reward_wallets", "reward_point_entries", "reward_spins", "reward_benefits", "mt_rooms", "mt_members",
]);
// SECURITY DEFINER functions intentionally left executable by PUBLIC, each with its own guard.
export const PUBLIC_EXECUTE_ALLOWED = {
  is_founder: "boolean predicate on auth.uid() + MFA header; used inside RLS policies",
  bootstrap_founder: "acts only on auth.uid() and only for the confirmed founder e-mail; audited",
  admin_list_users: "raises 'forbidden' unless is_founder()",
};

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export function auditSchema(rawSql) {
  const failures = [];
  const sql = stripComments(rawSql);
  const lower = sql.toLowerCase();

  // 1. tables and RLS
  const tables = new Set([...lower.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/g)].map((match) => match[1]));
  const rls = new Set([...lower.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/g)].map((match) => match[1]));
  for (const table of tables) if (!rls.has(table)) failures.push(`table public.${table} has no "enable row level security"`);

  // 2. permissive policies
  for (const match of sql.matchAll(/create\s+policy\s+("[^"]+"|[a-z0-9_]+)\s+on\s+([a-z0-9_]+)\.([a-z0-9_]+)([\s\S]*?);/gi)) {
    const [, name, schema, table, rest] = match;
    const body = rest.toLowerCase().replace(/\s+/g, " ");
    const command = body.match(/\bfor (all|select|insert|update|delete)\b/)?.[1] ?? "all";
    const roles = body.match(/\bto ([a-z_, ]+?)(?= using| with|$)/)?.[1]?.trim() ?? "public";
    const permissive = /\busing ?\( ?true ?\)/.test(body) || /\bwith check ?\( ?true ?\)/.test(body);
    if (!permissive || schema.toLowerCase() !== "public") continue;
    const where = `policy ${name} on public.${table} (for ${command}, to ${roles})`;
    if (SENSITIVE_TABLES.has(table.toLowerCase())) failures.push(`${where} uses (true) on a SENSITIVE table`);
    else if (command !== "select") failures.push(`${where} allows writes with (true)`);
    else if (!PUBLIC_READ_TABLES.has(table.toLowerCase())) failures.push(`${where} uses (true) on a table not in PUBLIC_READ_TABLES`);
  }

  // 3/4. SECURITY DEFINER functions
  const functions = [];
  for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\bas\s+(\$[a-z_]*\$)([\s\S]*?)\3/gi)) {
    const [, name, header, , body] = match;
    functions.push({ name: name.toLowerCase(), header: header.toLowerCase().replace(/\s+/g, " "), body });
  }
  for (const fn of functions) {
    if (!/\bsecurity definer\b/.test(fn.header)) continue;
    if (!/\bset search_path\b/.test(fn.header)) failures.push(`SECURITY DEFINER function public.${fn.name} has no "set search_path"`);
    if (/\breturns trigger\b/.test(fn.header)) continue;
    const revoked = new RegExp(`revoke\\s+(?:all|execute)[^;]*\\bon\\s+function\\s+[^;]*\\b(?:public\\.)?${fn.name}\\s*\\([^;]*\\bfrom\\s+[^;]*\\bpublic\\b`, "i").test(sql);
    if (!revoked && !PUBLIC_EXECUTE_ALLOWED[fn.name]) {
      failures.push(`SECURITY DEFINER function public.${fn.name} keeps default EXECUTE for PUBLIC (add "revoke all on function ... from public, anon" or justify it in PUBLIC_EXECUTE_ALLOWED)`);
    }
  }
  return { failures: [...new Set(failures)], tables: tables.size, definerFunctions: functions.filter((fn) => /security definer/.test(fn.header)).length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const schemaArg = process.argv.find((item) => item.startsWith("--schema="))?.slice("--schema=".length);
  const path = resolve(ROOT, schemaArg ?? "supabase/schema.sql");
  const result = auditSchema(readFileSync(path, "utf8"));
  if (result.failures.length) {
    console.error(`RLS static audit FAILED (${path}):\n${result.failures.map((item) => `- ${item}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`RLS static audit passed: ${result.tables} public tables with RLS, ${result.definerFunctions} SECURITY DEFINER definitions with search_path, no permissive policy outside the public catalog allowlist.`);
}
