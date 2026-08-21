// Static (no Postgres connection needed) check that supabase/schema.sql agrees with the RLS
// policies and function grants that replaying every file in supabase/migrations/ would produce.
//
// Why this exists: on 2026-08-04 a real security fix (removing a self-service RLS update policy
// on `profiles` that let any authenticated user overwrite trial_ends_at and keep indefinite free
// paid access) was applied to production via migration, but supabase/schema.sql - the "bootstrap a
// project from zero" reference - was never updated to match. Anyone bootstrapping a new project
// from schema.sql would have recreated the exact vulnerability the migration fixed. Nothing caught
// that until a manual audit did (see docs/AUDITORIA_2026-08-21_RLS_ENTITLEMENTS.md). This script is
// the automated version of that manual check: it doesn't need Docker/a live Postgres (per
// docs/migration-strategy.md, that's normally required to actually apply schema.sql), it just
// parses both sources as text and compares the "final state" they each imply.
//
// Scope: RLS policies (create/drop policy) and function grants (grant/revoke on function). This is
// exactly the class of statement the 2026-08-04 incident involved, and the class of statement most
// likely to matter for future authorization-relevant drift. It is not a general schema differ - it
// does not track tables, columns, triggers, or RPC bodies.
//
// Statements in this codebase are consistently one CREATE/DROP/GRANT/REVOKE per logical block,
// terminated by `;`, sometimes wrapped across 2-3 lines (see 20260721010000_voucher_discounts_and_kind.sql
// for an example) but never containing an embedded `;` of their own - so matching from the keyword
// to the next top-level `;` (dotall) is reliable here without a real SQL parser.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const SCHEMA_PATH = path.join(ROOT, "supabase", "schema.sql");

function normalize(text) {
  return text.replace(/\s+/g, "").toLowerCase();
}

function normalizeRoles(rolesText) {
  return rolesText
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

// Returns { policies: Map<"table::name", { op, body }>, grants: Map<"signature", Set<role>> }
// by replaying every create/drop/grant/revoke statement found, in the order they appear in `sql`.
function extractFinalState(sql, state = { policies: new Map(), grants: new Map() }) {
  const createPolicyRe = /create\s+policy\s+"([^"]+)"\s+on\s+([\w.]+)\s+for\s+(\w+)([\s\S]*?);/gi;
  const dropPolicyRe = /drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+([\w.]+)\s*;/gi;
  const grantRe = /grant\s+execute\s+on\s+function\s+([\w.]+\([^)]*\))\s+to\s+([\w,\s]+?)\s*;/gi;
  const revokeRe = /revoke\s+all\s+on\s+function\s+([\w.]+\([^)]*\))\s+from\s+([\w,\s]+?)\s*;/gi;
  const dropFunctionRe = /drop\s+function\s+if\s+exists\s+([\w.]+\([^)]*\))\s*;/gi;

  // Interleave all four statement kinds in source order (drop-before-create in the same file must
  // be respected), by collecting matches with their index and sorting once.
  const events = [];
  for (const match of sql.matchAll(createPolicyRe)) {
    events.push({ index: match.index, kind: "create-policy", name: match[1], table: match[2].replace(/^public\./, ""), op: match[3].toLowerCase(), body: match[4] });
  }
  for (const match of sql.matchAll(dropPolicyRe)) {
    events.push({ index: match.index, kind: "drop-policy", name: match[1], table: match[2].replace(/^public\./, "") });
  }
  for (const match of sql.matchAll(grantRe)) {
    events.push({ index: match.index, kind: "grant", signature: normalize(match[1].replace(/^public\./, "")), roles: normalizeRoles(match[2]) });
  }
  for (const match of sql.matchAll(revokeRe)) {
    events.push({ index: match.index, kind: "revoke", signature: normalize(match[1].replace(/^public\./, "")), roles: normalizeRoles(match[2]) });
  }
  for (const match of sql.matchAll(dropFunctionRe)) {
    events.push({ index: match.index, kind: "drop-function", signature: normalize(match[1].replace(/^public\./, "")) });
  }
  events.sort((a, b) => a.index - b.index);

  for (const event of events) {
    if (event.kind === "create-policy") {
      state.policies.set(`${event.table}::${event.name}`, { op: event.op, body: normalize(event.body) });
    } else if (event.kind === "drop-policy") {
      state.policies.delete(`${event.table}::${event.name}`);
    } else if (event.kind === "grant") {
      const current = state.grants.get(event.signature) || new Set();
      for (const role of event.roles) current.add(role);
      state.grants.set(event.signature, current);
    } else if (event.kind === "revoke") {
      const current = state.grants.get(event.signature) || new Set();
      for (const role of event.roles) current.delete(role);
      state.grants.set(event.signature, current);
    } else if (event.kind === "drop-function") {
      state.grants.delete(event.signature);
    }
  }
  return state;
}

function rolesSetEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const role of a) if (!b.has(role)) return false;
  return true;
}

function main() {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort(); // filenames are YYYYMMDDHHMMSS_description.sql - lexicographic sort is chronological

  let migrationsFinal = { policies: new Map(), grants: new Map() };
  for (const file of migrationFiles) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    migrationsFinal = extractFinalState(sql, migrationsFinal);
  }

  const schemaSql = readFileSync(SCHEMA_PATH, "utf8");
  const schemaFinal = extractFinalState(schemaSql);

  const problems = [];
  const info = [];

  for (const [key, expected] of migrationsFinal.policies) {
    const actual = schemaFinal.policies.get(key);
    if (!actual) {
      problems.push(`POLICY MISSING in schema.sql: ${key} (migrations expect: for ${expected.op} ...)`);
    } else if (actual.op !== expected.op || actual.body !== expected.body) {
      problems.push(`POLICY MISMATCH: ${key}\n  migrations (final state): for ${expected.op} ${expected.body}\n  schema.sql:               for ${actual.op} ${actual.body}`);
    }
  }
  for (const key of schemaFinal.policies.keys()) {
    if (!migrationsFinal.policies.has(key)) info.push(`schema.sql defines a policy migrations don't track: ${key} (only a problem if a migration should have dropped/replaced it)`);
  }

  for (const [signature, expectedRoles] of migrationsFinal.grants) {
    const actualRoles = schemaFinal.grants.get(signature) || new Set();
    if (!rolesSetEqual(expectedRoles, actualRoles)) {
      problems.push(`GRANT MISMATCH: ${signature}\n  migrations (final state): ${[...expectedRoles].sort().join(", ") || "(none)"}\n  schema.sql:               ${[...actualRoles].sort().join(", ") || "(none)"}`);
    }
  }
  for (const signature of schemaFinal.grants.keys()) {
    if (!migrationsFinal.grants.has(signature)) info.push(`schema.sql grants on a function migrations don't track: ${signature}`);
  }

  if (info.length) {
    console.log(`${info.length} informational note(s) (not failing the check):`);
    for (const line of info) console.log(`  - ${line}`);
  }

  if (problems.length) {
    console.error(`\nschema.sql is out of sync with supabase/migrations/ (${problems.length} problem(s)):\n`);
    for (const problem of problems) console.error(`- ${problem}\n`);
    console.error("Fix: update supabase/schema.sql so a project bootstrapped from it ends up in the same state as one that replayed every migration (see docs/migration-strategy.md).");
    process.exit(1);
  }

  console.log(`schema.sql sync check passed: ${migrationsFinal.policies.size} polic${migrationsFinal.policies.size === 1 ? "y" : "ies"} and ${migrationsFinal.grants.size} function grant set(s) verified against ${migrationFiles.length} migration file(s).`);
}

main();
