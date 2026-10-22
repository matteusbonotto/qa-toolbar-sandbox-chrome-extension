// Runner of the backend security suite.
//
//   npm run test:security:local            mock target (scripts/backend-security/mock-edge-server.mjs),
//                                          then a mutation self-check: the same suite must FAIL against
//                                          mocks with deliberately injected vulnerabilities.
//   npm run test:security -- --target=http://127.0.0.1:54321      local Supabase (`supabase start`)
//   npm run test:security -- --i-own-this-test-target            separate Supabase TEST project from
//        QTS_TEST_SUPABASE_URL + QTS_TEST_SUPABASE_PROJECT_REF (+ QTS_TEST_IDENTITIES_FILE)
//
// Production is refused by target-guard.mjs before any request, flag or not.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argValue, guardedFetchFor, OWNERSHIP_FLAG, resolveTarget, TargetRefusedError } from "./target-guard.mjs";
import { KNOWN_FAULTS } from "./mock-edge-server.mjs";
import { startMockProcess } from "./mock-process.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITE = resolve(HERE, "edge-functions.security.test.mjs");
const argv = process.argv.slice(2);
const local = argv.includes("--local");

function runNode(args, env = {}, { quiet = false } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit" });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { output += chunk; });
    child.on("exit", (code) => resolvePromise({ code: code ?? 1, output }));
  });
}

function suiteEnv(target, identities, mode, allowedOrigin) {
  return {
    QTS_SECURITY_TARGET_ORIGIN: target.origin,
    QTS_SECURITY_MODE: mode,
    QTS_SECURITY_IDENTITIES: JSON.stringify(identities),
    QTS_SECURITY_ALLOWED_ORIGIN: allowedOrigin ?? process.env.QTS_TEST_ALLOWED_ORIGIN ?? "",
    QTS_SECURITY_OWNERSHIP_CONFIRMED: argv.includes(OWNERSHIP_FLAG) ? "1" : "0",
    QTS_SECURITY_ALLOW_DESTRUCTIVE: argv.includes("--allow-destructive") ? "1" : "0",
    QTS_SECURITY_APIKEY: process.env.QTS_TEST_SUPABASE_ANON_KEY ?? "",
  };
}

// Identities file (never committed): { "plain": {"email","password"} | {"accessToken","userId"}, "host": ...,
// "guests": [4 x ...], "outsider": ..., "noPlan": ..., "founder"?: ..., "expiredToken"?: "<jwt>" }.
async function realIdentities(target) {
  const file = argValue(argv, "identities-file", process.env.QTS_TEST_IDENTITIES_FILE);
  if (!file) {
    console.warn("No QTS_TEST_IDENTITIES_FILE: authenticated cases will be SKIPPED (reported as skipped, not passed).");
    return {};
  }
  const raw = JSON.parse(readFileSync(resolve(file), "utf8"));
  const guardedFetch = guardedFetchFor(target);
  async function session(entry) {
    if (!entry || typeof entry !== "object") return entry;
    if (entry.accessToken) return entry;
    const response = await guardedFetch(`${target.functionsBaseUrl}/auth-sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.QTS_TEST_SUPABASE_ANON_KEY ? { apikey: process.env.QTS_TEST_SUPABASE_ANON_KEY } : {}) },
      body: JSON.stringify({ email: entry.email, password: entry.password }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`sign-in failed for ${entry.email}: ${response.status} ${json.error ?? ""}`);
    return { accessToken: json.accessToken, userId: json.user?.id, email: entry.email };
  }
  const output = { expiredToken: raw.expiredToken };
  for (const key of ["plain", "host", "outsider", "noPlan", "founder"]) if (raw[key]) output[key] = await session(raw[key]);
  if (Array.isArray(raw.guests)) output.guests = await Promise.all(raw.guests.map(session));
  return output;
}

async function main() {
  console.log("== RLS static audit (supabase/schema.sql)");
  const rls = await runNode([resolve(HERE, "check-rls-static.mjs")]);
  if (rls.code !== 0) process.exit(rls.code);

  if (local) {
    const mock = await startMockProcess(["--rate-limit-scale=1000"]);
    let result;
    try {
      const target = resolveTarget({ url: mock.url, argv: [] });
      console.log(`== Security suite against LOCAL MOCK ${target.origin} (emulates the documented contracts; proves the suite, not production)`);
      result = await runNode(["--test", "--test-reporter=spec", SUITE], suiteEnv(target, mock.identities, "mock", mock.allowedOrigin));
    } finally {
      await mock.stop();
    }
    if (result.code !== 0) {
      console.error("Security suite FAILED against the safe mock.");
      process.exit(result.code);
    }
    if (argv.includes("--no-self-check")) return;

    console.log("\n== Mutation self-check: the suite must FAIL against each deliberately vulnerable mock");
    const escaped = [];
    for (const fault of KNOWN_FAULTS) {
      const faulty = await startMockProcess(["--rate-limit-scale=1000", `--faults=${fault}`]);
      try {
        const target = resolveTarget({ url: faulty.url, argv: [] });
        const run = await runNode(["--test", "--test-reporter=tap", SUITE], suiteEnv(target, faulty.identities, "mock", faulty.allowedOrigin), { quiet: true });
        const failures = (run.output.match(/^\s*not ok \d+/gm) ?? []).length;
        const failedLeaves = (run.output.match(/^# fail (\d+)/m) ?? [])[1] ?? "?";
        console.log(`  fault ${fault.padEnd(22)} -> exit ${run.code}, failing tests: ${failedLeaves} (not ok lines: ${failures}) ${run.code !== 0 ? "DETECTED" : "ESCAPED"}`);
        if (run.code === 0) escaped.push(fault);
      } finally {
        await faulty.stop();
      }
    }
    if (escaped.length) {
      console.error(`Self-check FAILED: the suite did not detect: ${escaped.join(", ")}`);
      process.exit(1);
    }
    console.log(`Self-check passed: all ${KNOWN_FAULTS.length} injected vulnerabilities were detected.`);
    return;
  }

  const target = resolveTarget({ url: argValue(argv, "target"), argv });
  console.log(`== Security suite against ${target.kind === "local" ? "LOCAL" : "TEST PROJECT"} ${target.origin}`);
  const identities = await realIdentities(target);
  const result = await runNode(["--test", "--test-reporter=spec", SUITE], suiteEnv(target, identities, "real"));
  process.exit(result.code);
}

main().catch((error) => {
  if (error instanceof TargetRefusedError) {
    console.error(`\n${error.message}\nNo request was sent.`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
