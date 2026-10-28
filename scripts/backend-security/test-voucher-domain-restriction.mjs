// Regression test for the 2026-10-28 voucher incident: campaigns meant only for @mblabs.com.br /
// @bankeiro.com.br e-mails ("Release Manager vitalicio") were redeemed by outside users, because no
// e-mail domain restriction existed anywhere. The fix lives in Postgres (allowed_email_domains +
// voucher_email_domain_allowed() called by redeem_voucher / reserve_voucher_discount), so this test
// runs the REAL SQL in a real Postgres: PGlite (Postgres compiled to WASM, in-process, no Docker),
// against BOTH sources that can build a database:
//   1. supabase/schema.sql (bootstrap of a new project);
//   2. every file in supabase/migrations/ replayed in order (what production actually ran).
// A divergence between the two (AGENTS.md rule 6) shows up as one of them failing.
//
// The only Supabase pieces faked here are the ones PGlite does not ship: the auth/realtime schemas,
// auth.users and the auth.uid()/auth.role()/auth.jwt() helpers, and the API roles. Nothing the
// voucher RPCs do is faked.
//
// PGlite comes from node_modules (today a transitive dependency of firebase-tools, version 0.3.x).
// If it is ever missing the test FAILS with an explicit message instead of skipping, so the
// regression coverage can't silently disappear.
//
// Usage: node --test scripts/backend-security/test-voucher-domain-restriction.mjs

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let PGlite;
let pgcrypto;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto"));
} catch (error) {
  throw new Error(`@electric-sql/pglite is not installed (run npm install at the repo root): ${error.message}`);
}

// Minimal stand-ins for what a Supabase project provides before schema.sql/migrations run.
const SUPABASE_PREAMBLE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create schema realtime;
grant usage on schema auth, extensions to anon, authenticated, service_role;
create extension pgcrypto schema extensions;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  email_change text default '',
  reauthentication_token text,
  reauthentication_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table realtime.messages (id bigserial primary key, topic text, extension text, event text, payload jsonb);
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
`;

const sha = (code) => createHash("sha256").update(code).digest("hex");

async function buildDatabase(source) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_PREAMBLE);
  if (source === "schema.sql") {
    await db.exec(readFileSync(join(ROOT, "supabase", "schema.sql"), "utf8"));
  } else {
    const dir = join(ROOT, "supabase", "migrations");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
      try {
        await db.exec(readFileSync(join(dir, file), "utf8"));
      } catch (error) {
        throw new Error(`migration ${file} failed: ${error.message}`);
      }
    }
  }
  return db;
}

async function rpcError(promise) {
  try {
    await promise;
  } catch (error) {
    return error.message;
  }
  return null;
}

for (const source of ["schema.sql", "migrations"]) {
  describe(`voucher e-mail domain restriction (${source})`, () => {
    let db;
    const users = {};
    let planId;

    async function addUser(key, email, confirmed = true, emailChange = "") {
      const { rows } = await db.query(
        "insert into auth.users (email, email_confirmed_at, email_change) values ($1, $2, $3) returning id",
        [email, confirmed ? new Date().toISOString() : null, emailChange],
      );
      users[key] = rows[0].id;
    }

    async function addCampaign(code, kind, domains, extra = {}) {
      const { rows } = await db.query(
        `insert into public.voucher_campaigns (code_hash, label, kind, plan_id, grant_days, discount_percent_off, allowed_email_domains)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [sha(code), `Campanha ${code}`, kind, kind === "discount" ? null : planId, extra.grantDays ?? null, kind === "discount" ? 20 : null, domains],
      );
      return rows[0].id;
    }

    async function addVoucher(code, kind, domains) {
      const { rows } = await db.query(
        `insert into public.vouchers (code_hash, label, kind, plan_id, discount_percent_off, allowed_email_domains)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [sha(code), `Voucher ${code}`, kind, kind === "discount" ? null : planId, kind === "discount" ? 15 : null, domains],
      );
      return rows[0].id;
    }

    const redeem = (userKey, code) => db.query("select * from public.redeem_voucher($1, $2)", [users[userKey], sha(code)]);
    const reserve = (userKey, code, requestId = randomUUID()) =>
      db.query("select * from public.reserve_voucher_discount($1, $2, $3)", [users[userKey], sha(code), requestId]);
    const grantsOf = async (userKey) =>
      (await db.query("select count(*)::int as n from public.entitlement_grants where user_id = $1 and source = 'voucher'", [users[userKey]])).rows[0].n;

    before(async () => {
      db = await buildDatabase(source);
      planId = (await db.query(
        `insert into public.plans (key, name) values ('release-manager', 'Release Manager')
         on conflict (key) do update set name = excluded.name returning id`,
      )).rows[0].id;
      await addUser("outsider", "someone@gmail.com");
      await addUser("insider", "dev@mblabs.com.br");
      await addUser("insiderUpper", "QA.Lead@MBLabs.com.BR");
      await addUser("bankeiro", "ops@bankeiro.com.br");
      await addUser("unconfirmed", "fake@mblabs.com.br", false);
      await addUser("lookalikePrefix", "x@evil-mblabs.com.br");
      await addUser("lookalikeSuffix", "x@mblabs.com.br.evil.com");
      await addUser("subdomain", "x@sub.mblabs.com.br");
      await addUser("doubleAt", "\"mblabs.com.br\"@evil.com");
      await addUser("noEmail", null);
      // U+0130 (capital I with dot): a libc lower() may fold it into ASCII "i" (security review 2026-10-28).
      await addUser("nonAsciiDomain", "x@bankeİro.com.br");
      await addUser("nonAsciiDomainLower", "x@bankeıro.com.br");
      // Confirmed outside address with a PENDING change to a company address: not proven yet.
      await addUser("pendingChange", "outsider@evil.com", true, "x@mblabs.com.br");
      await addUser("nonAsciiLocalPart", "joão@mblabs.com.br");

      await addCampaign("MBLABS-RM-TEST01", "lifetime", ["mblabs.com.br"]);
      await addCampaign("COMPANIES-RM-TEST", "lifetime", ["mblabs.com.br", "bankeiro.com.br"]);
      await addCampaign("EDUFULL-TEST", "days", null, { grantDays: 30 });
      await addCampaign("EMPTYLIST-TEST", "days", [], { grantDays: 30 });
      await addCampaign("MBLABS-DISC-TEST", "discount", ["mblabs.com.br"]);
      await addVoucher("MBLABS-SINGLE-01", "lifetime", ["mblabs.com.br"]);
      await addVoucher("MBLABS-SINGLE-DISC", "discount", ["mblabs.com.br"]);
    });

    after(async () => {
      await db?.close();
    });

    test("incident scenario: an outside e-mail cannot redeem a domain-restricted lifetime campaign", async () => {
      assert.equal(await rpcError(redeem("outsider", "MBLABS-RM-TEST01")), "voucher_domain_not_allowed");
      assert.equal(await grantsOf("outsider"), 0, "no entitlement grant may be created");
      const { rows } = await db.query("select redemption_count from public.voucher_campaigns where code_hash = $1", [sha("MBLABS-RM-TEST01")]);
      assert.equal(rows[0].redemption_count, 0, "a rejected attempt must not consume a campaign slot");
    });

    test("a confirmed matching e-mail redeems the restricted campaign and gets a lifetime grant", async () => {
      const { rows } = await redeem("insider", "MBLABS-RM-TEST01");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].access_expires_at, null);
      assert.equal(await grantsOf("insider"), 1);
    });

    test("domain comparison is case-insensitive on the user's e-mail", async () => {
      const { rows } = await redeem("insiderUpper", "MBLABS-RM-TEST01");
      assert.equal(rows.length, 1);
    });

    test("an unconfirmed e-mail with the right domain is rejected", async () => {
      assert.equal(await rpcError(redeem("unconfirmed", "MBLABS-RM-TEST01")), "voucher_domain_not_allowed");
      assert.equal(await grantsOf("unconfirmed"), 0);
    });

    test("look-alike domains, subdomains and a quoted '@' in the local part are rejected (exact match only)", async () => {
      for (const key of ["lookalikePrefix", "lookalikeSuffix", "subdomain", "doubleAt", "noEmail"]) {
        assert.equal(await rpcError(redeem(key, "MBLABS-RM-TEST01")), "voucher_domain_not_allowed", key);
        assert.equal(await grantsOf(key), 0, key);
      }
    });

    test("non-ASCII domains never match an ASCII domain, even if lower() could fold them", async () => {
      for (const key of ["nonAsciiDomain", "nonAsciiDomainLower"]) {
        assert.equal(await rpcError(redeem(key, "COMPANIES-RM-TEST")), "voucher_domain_not_allowed", key);
        assert.equal(await rpcError(reserve(key, "MBLABS-DISC-TEST")), "voucher_domain_not_allowed", key);
        assert.equal(await grantsOf(key), 0, key);
      }
    });

    test("a pending email_change to an allowed domain does not count (only the confirmed current e-mail)", async () => {
      assert.equal(await rpcError(redeem("pendingChange", "MBLABS-RM-TEST01")), "voucher_domain_not_allowed");
      assert.equal(await rpcError(reserve("pendingChange", "MBLABS-DISC-TEST")), "voucher_domain_not_allowed");
      assert.equal(await grantsOf("pendingChange"), 0);
    });

    test("a non-ASCII local part does not matter when the domain is the allowed ASCII one", async () => {
      assert.equal((await redeem("nonAsciiLocalPart", "MBLABS-RM-TEST01")).rows.length, 1);
    });

    test("audit_logs of a redemption carry the campaign/voucher id and only the e-mail domain", async () => {
      const { rows } = await db.query(
        `select target_type, target_id, metadata from public.audit_logs
         where actor_id = $1 and action = 'voucher.redeemed' order by created_at`,
        [users.insider],
      );
      const campaign = rows.find((row) => row.target_type === "voucher_campaign");
      assert.ok(campaign, "campaign redemption audited");
      assert.equal(campaign.metadata.campaign_id, campaign.target_id);
      assert.equal(campaign.metadata.email_domain, "mblabs.com.br");
      assert.ok(!JSON.stringify(rows).includes("dev@mblabs.com.br"), "the full e-mail address must never be logged");
    });

    test("a list with several domains accepts each listed domain and nothing else", async () => {
      assert.equal((await redeem("bankeiro", "COMPANIES-RM-TEST")).rows.length, 1);
      assert.equal((await redeem("insider", "COMPANIES-RM-TEST")).rows.length, 1);
      assert.equal(await rpcError(redeem("outsider", "COMPANIES-RM-TEST")), "voucher_domain_not_allowed");
    });

    test("NULL or empty list keeps the old behavior: any e-mail redeems (EDUFULL-style vouchers)", async () => {
      assert.equal((await redeem("outsider", "EDUFULL-TEST")).rows.length, 1);
      assert.equal((await redeem("unconfirmed", "EDUFULL-TEST")).rows.length, 1);
      assert.equal((await redeem("outsider", "EMPTYLIST-TEST")).rows.length, 1);
    });

    test("an allowed user still cannot redeem the same campaign twice (no double grant)", async () => {
      assert.equal(await rpcError(redeem("insider", "MBLABS-RM-TEST01")), "voucher_already_redeemed");
    });

    test("single-use voucher: outsider rejected and the voucher stays available; insider consumes it", async () => {
      assert.equal(await rpcError(redeem("outsider", "MBLABS-SINGLE-01")), "voucher_domain_not_allowed");
      let status = (await db.query("select status from public.vouchers where code_hash = $1", [sha("MBLABS-SINGLE-01")])).rows[0].status;
      assert.equal(status, "available");
      assert.equal((await redeem("insider", "MBLABS-SINGLE-01")).rows.length, 1);
      status = (await db.query("select status from public.vouchers where code_hash = $1", [sha("MBLABS-SINGLE-01")])).rows[0].status;
      assert.equal(status, "used");
    });

    test("discount campaign/voucher: reserve_voucher_discount enforces the same rule", async () => {
      assert.equal(await rpcError(reserve("outsider", "MBLABS-DISC-TEST")), "voucher_domain_not_allowed");
      assert.equal(await rpcError(reserve("lookalikeSuffix", "MBLABS-DISC-TEST")), "voucher_domain_not_allowed");
      assert.equal(await rpcError(reserve("unconfirmed", "MBLABS-DISC-TEST")), "voucher_domain_not_allowed");
      const pending = (await db.query("select count(*)::int as n from public.voucher_reservations where status = 'pending'")).rows[0].n;
      assert.equal(pending, 0, "a rejected reserve must not hold a reservation");
      const requestId = randomUUID();
      const { rows } = await reserve("insider", "MBLABS-DISC-TEST", requestId);
      assert.equal(rows[0].percent_off, 20);
      // Idempotent retry with the same request id still answers for the qualifying user.
      assert.equal((await reserve("insider", "MBLABS-DISC-TEST", requestId)).rows[0].percent_off, 20);

      assert.equal(await rpcError(reserve("outsider", "MBLABS-SINGLE-DISC")), "voucher_domain_not_allowed");
      assert.equal(await rpcError(reserve("bankeiro", "MBLABS-SINGLE-DISC")), "voucher_domain_not_allowed");
      assert.equal((await reserve("insider", "MBLABS-SINGLE-DISC")).rows[0].percent_off, 15);

      // The discount flow is audited when the Stripe webhook finalizes the reservation.
      assert.equal((await db.query("select public.finalize_voucher_reservation($1) as ok", [requestId])).rows[0].ok, true);
      const audit = (await db.query(
        "select metadata from public.audit_logs where action = 'voucher.discount_finalized' and actor_id = $1", [users.insider],
      )).rows[0];
      assert.equal(audit.metadata.email_domain, "mblabs.com.br");
      assert.equal(audit.metadata.request_id, requestId);
      assert.ok(audit.metadata.campaign_id);
    });

    test("an unrestricted discount campaign reserves for anyone (regression: bare `kind` was ambiguous with the OUT param)", async () => {
      await addCampaign("OPEN-DISC-TEST", "discount", null);
      const { rows } = await reserve("outsider", "OPEN-DISC-TEST");
      assert.equal(rows[0].kind, "discount");
      assert.equal(rows[0].percent_off, 20);
    });

    test("CHECK constraint accepts only sane lowercase domains", async () => {
      const valid = [["mblabs.com.br"], ["mblabs.com.br", "bankeiro.com.br"], ["a-b.example.io"], []];
      const invalid = [
        ["MBLabs.com.br"], ["@mblabs.com.br"], ["mblabs"], ["mblabs.com.br,evil.com"], [" mblabs.com.br"],
        ["-mblabs.com.br"], ["mblabs-.com.br"], ["mblabs..com.br"], ["*.mblabs.com.br"], ["mblabs.com.br."], [null],
      ];
      let index = 0;
      for (const domains of valid) {
        await addCampaign(`CHECK-OK-${index++}`, "days", domains, { grantDays: 1 });
      }
      for (const domains of invalid) {
        const message = await rpcError(addCampaign(`CHECK-BAD-${index++}`, "days", domains, { grantDays: 1 }));
        assert.match(String(message), /allowed_email_domains_check/, JSON.stringify(domains));
        const voucherMessage = await rpcError(addVoucher(`CHECK-BADV-${index++}`, "lifetime", domains));
        assert.match(String(voucherMessage), /allowed_email_domains_check/, JSON.stringify(domains));
      }
      const tooMany = Array.from({ length: 21 }, (_, i) => `d${i}.com`);
      assert.match(String(await rpcError(addCampaign("CHECK-TOO-MANY", "days", tooMany, { grantDays: 1 }))), /allowed_email_domains_check/);
    });

    test("privileges: the domain predicate is not callable by API roles; the validator is callable by authenticated", async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role}`);
        try {
          const message = await rpcError(db.query("select public.voucher_email_domain_allowed(array['mblabs.com.br'], $1)", [users.insider]));
          assert.match(String(message), /permission denied/, role);
        } finally {
          await db.exec("reset role");
        }
      }
      await db.exec("set role authenticated");
      try {
        assert.equal((await db.query("select public.is_valid_email_domain_list(array['mblabs.com.br']) as ok")).rows[0].ok, true);
      } finally {
        await db.exec("reset role");
      }
      for (const fn of ["redeem_voucher(uuid, text)", "reserve_voucher_discount(uuid, text, uuid, integer)"]) {
        const { rows } = await db.query(
          `select has_function_privilege('anon', 'public.${fn}', 'execute') as anon,
                  has_function_privilege('authenticated', 'public.${fn}', 'execute') as auth,
                  has_function_privilege('service_role', 'public.${fn}', 'execute') as service`,
        );
        assert.deepEqual(rows[0], { anon: false, auth: false, service: true }, fn);
      }
    });
  });
}
