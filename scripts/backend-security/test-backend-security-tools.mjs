// Unit tests of the security/load tooling itself (part of `npm test`, no network): the production
// block of the target guard, the RLS static auditor against deliberately bad SQL, and the load
// engine's percentile/threshold math. A guard that silently accepted production would be the worst
// possible bug in this suite, so it is tested case by case.

import assert from "node:assert/strict";
import { auditSchema } from "./check-rls-static.mjs";
import { OWNERSHIP_FLAG, PRODUCTION_PROJECT_REF, productionRefs, resolveTarget, TargetRefusedError } from "./target-guard.mjs";
import { evaluateThresholds, Metrics, parseDuration, percentile } from "../backend-load/load-engine.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const refuses = (options, pattern) => assert.throws(() => resolveTarget(options), (error) => error instanceof TargetRefusedError && (!pattern || pattern.test(error.message)));
const TEST_REF = "abcdefghijklmnopqrst";
const testEnv = { QTS_TEST_SUPABASE_URL: `https://${TEST_REF}.supabase.co`, QTS_TEST_SUPABASE_PROJECT_REF: TEST_REF };

// ---------------------------------------------------------------- target guard
check("production ref is in the blocked set (also read from the extension source)", () => {
  assert.ok(productionRefs().has(PRODUCTION_PROJECT_REF));
});
check("production URL is refused even with the ownership flag and matching env", () => {
  const prod = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
  refuses({ url: prod, argv: [OWNERSHIP_FLAG], env: { QTS_TEST_SUPABASE_URL: prod, QTS_TEST_SUPABASE_PROJECT_REF: PRODUCTION_PROJECT_REF } }, /PRODUCTION/);
});
check("production ref hidden in path, query, upper case or percent-encoding is refused", () => {
  for (const url of [
    `http://127.0.0.1:8080/${PRODUCTION_PROJECT_REF}`,
    `http://localhost/?next=https://${PRODUCTION_PROJECT_REF.toUpperCase()}.supabase.co`,
    `http://127.0.0.1/%78husvkylbouwtpcevgri`,
  ]) refuses({ url, argv: [OWNERSHIP_FLAG], env: {} }, /PRODUCTION/);
});
check("production named only in QTS_TEST_SUPABASE_PROJECT_REF is refused", () => {
  refuses({ url: `https://${TEST_REF}.supabase.co`, argv: [OWNERSHIP_FLAG], env: { ...testEnv, QTS_TEST_SUPABASE_PROJECT_REF: PRODUCTION_PROJECT_REF } }, /PRODUCTION/);
});
check("no target at all is refused", () => refuses({ url: undefined, argv: [], env: {} }, /No target/));
check("localhost / 127.0.0.1 / ::1 are allowed without flag", () => {
  for (const url of ["http://127.0.0.1:54321", "http://localhost:3000", "http://[::1]:9000"]) {
    assert.equal(resolveTarget({ url, argv: [], env: {} }).kind, "local");
  }
});
check("a separate test project needs the ownership flag", () => {
  refuses({ url: testEnv.QTS_TEST_SUPABASE_URL, argv: [], env: testEnv }, /i-own-this-test-target/);
});
check("a separate test project with flag + matching env is allowed", () => {
  const target = resolveTarget({ url: testEnv.QTS_TEST_SUPABASE_URL, argv: [OWNERSHIP_FLAG], env: testEnv });
  assert.equal(target.kind, "test-project");
  assert.equal(target.functionsBaseUrl, `https://${TEST_REF}.supabase.co/functions/v1`);
});
check("third-party hosts are refused even with the flag", () => {
  for (const url of ["https://example.com", "https://api.stripe.com", `https://${TEST_REF}.supabase.co.evil.com`, `https://evil.com/${TEST_REF}.supabase.co`]) {
    refuses({ url, argv: [OWNERSHIP_FLAG], env: { ...testEnv, QTS_TEST_SUPABASE_URL: url } });
  }
});
check("test project over http, with credentials, other port or a different ref is refused", () => {
  refuses({ url: `http://${TEST_REF}.supabase.co`, argv: [OWNERSHIP_FLAG], env: { ...testEnv, QTS_TEST_SUPABASE_URL: `http://${TEST_REF}.supabase.co` } });
  refuses({ url: `https://user:pw@${TEST_REF}.supabase.co`, argv: [OWNERSHIP_FLAG], env: testEnv });
  refuses({ url: `https://${TEST_REF}.supabase.co:8443`, argv: [OWNERSHIP_FLAG], env: testEnv });
  refuses({ url: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co", argv: [OWNERSHIP_FLAG], env: testEnv });
});
check("target must equal QTS_TEST_SUPABASE_URL (a --target pointing elsewhere is refused)", () => {
  refuses({ url: `https://${TEST_REF}.supabase.co`, argv: [OWNERSHIP_FLAG], env: { QTS_TEST_SUPABASE_PROJECT_REF: TEST_REF } });
});
check("non-http protocols are refused", () => {
  refuses({ url: "file:///etc/passwd", argv: [OWNERSHIP_FLAG], env: {} });
  refuses({ url: "ws://127.0.0.1:1", argv: [], env: {} });
});

// ---------------------------------------------------------------- RLS auditor
const goodSql = `
create table if not exists public.secrets (id uuid);
alter table public.secrets enable row level security;
create table if not exists public.features (key text);
alter table public.features enable row level security;
create policy "features are publicly readable" on public.features for select using (true);
create or replace function public.do_thing(target uuid) returns void language plpgsql security definer set search_path = '' as $$ begin end; $$;
revoke all on function public.do_thing(uuid) from public, anon, authenticated;
`;
check("auditor accepts a compliant schema", () => assert.deepEqual(auditSchema(goodSql).failures, []));
check("auditor flags a public table without RLS", () => {
  const result = auditSchema(`${goodSql}\ncreate table public.leaky (id uuid);`);
  assert.ok(result.failures.some((item) => item.includes("public.leaky")));
});
check("auditor flags using (true) on a sensitive table and on a non-allowlisted table", () => {
  const result = auditSchema(`${goodSql}
create table public.profiles (id uuid); alter table public.profiles enable row level security;
create policy "oops" on public.profiles for select to anon, authenticated using ( true );
create policy "oops2" on public.secrets for select using (true);`);
  assert.ok(result.failures.some((item) => item.includes("SENSITIVE")));
  assert.ok(result.failures.some((item) => item.includes("public.secrets") && item.includes("PUBLIC_READ_TABLES")));
});
check("auditor flags write policies with (true), even on catalog tables", () => {
  const result = auditSchema(`${goodSql}\ncreate policy "w" on public.features for insert with check (true);`);
  assert.ok(result.failures.some((item) => item.includes("allows writes")));
});
check("auditor flags SECURITY DEFINER without search_path and with default PUBLIC execute", () => {
  const result = auditSchema(`${goodSql}
create or replace function public.unsafe(target uuid) returns void language plpgsql security definer as $fn$ begin end; $fn$;`);
  assert.ok(result.failures.some((item) => item.includes("public.unsafe") && item.includes("search_path")));
  assert.ok(result.failures.some((item) => item.includes("public.unsafe") && item.includes("PUBLIC")));
});
check("auditor ignores SQL comments that merely mention (true)", () => {
  assert.deepEqual(auditSchema(`${goodSql}\n-- create policy "x" on public.secrets for all using (true);`).failures, []);
});

// ---------------------------------------------------------------- load engine
check("percentile is nearest-rank", () => {
  const sorted = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 95), 95);
  assert.equal(percentile(sorted, 99), 99);
  assert.equal(percentile([7], 99), 7);
  assert.equal(percentile([], 95), 0);
});
check("durations parse ms/s/m", () => {
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("20s"), 20_000);
  assert.equal(parseDuration("2m"), 120_000);
  assert.equal(parseDuration(undefined, 42), 42);
  assert.throws(() => parseDuration("abc"));
});
check("thresholds pass and fail on the right side, per metric and overall, and failed checks fail the run", () => {
  const metrics = new Metrics();
  for (let index = 1; index <= 100; index += 1) metrics.record("a", { status: index <= 98 ? 200 : 500, ms: index, ok: index <= 98 });
  metrics.finish();
  const report = metrics.report();
  assert.deepEqual(evaluateThresholds(report, ["p95<96", "a:p99<=99", "error_rate<0.03"]), []);
  assert.equal(evaluateThresholds(report, ["p95<95"]).length, 1);
  assert.equal(evaluateThresholds(report, ["error_rate<0.01"]).length, 1);
  assert.equal(evaluateThresholds(report, ["missing:p95<1"]).length, 1);
  assert.equal(evaluateThresholds(report, ["nonsense"]).length, 1);
  metrics.check("functional", false, "detail");
  assert.equal(evaluateThresholds(metrics.report(), []).length, 1);
});

console.log(`backend security tooling: ${passed} checks passed`);
