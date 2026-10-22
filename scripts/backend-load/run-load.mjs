// Backend load runner (no dependency). Scenarios:
//   access-status        N VUs polling access-status with their own tokens
//   multi-tester         R rooms x 4 users (host + 3 approved guests) polling state/touch
//   sign-in-rate-limit   wrong passwords per e-mail: the limiter (10 per 15 min, auth-sign-in) must
//                        answer 429 from the 11th attempt on, never 200, never 5xx
//
//   npm run test:load:local                                    mock target, then a self-check that
//                                                              thresholds really fail (slow mock /
//                                                              limiter off)
//   npm run test:load -- --target=http://127.0.0.1:54321       local Supabase
//   npm run test:load -- --i-own-this-test-target              separate TEST project
//        (QTS_TEST_SUPABASE_URL + QTS_TEST_SUPABASE_PROJECT_REF + QTS_TEST_LOAD_USERS_FILE)
//
// Options: --scenario=all|access-status|multi-tester|sign-in-rate-limit --vus=N --duration=20s
//   --ramp-up=5s --think-ms=N --rooms=N --threshold="p95<800" (repeatable) --report=path.json
// Production is refused by scripts/backend-security/target-guard.mjs before any request.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { argValue, guardedFetchFor, OWNERSHIP_FLAG, resolveTarget, TargetRefusedError } from "../backend-security/target-guard.mjs";
import { startMockProcess } from "../backend-security/mock-process.mjs";
import { evaluateThresholds, formatReport, Metrics, parseDuration, runVirtualUsers, timedRequest } from "./load-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const local = argv.includes("--local");
const MAX_REMOTE_VUS = 200;
const MAX_REMOTE_DURATION_MS = 10 * 60_000;
const SIGN_IN_LIMIT = 10; // auth-sign-in/index.ts: enforceRateLimit(email, "auth-sign-in", 10, 900)

const userThresholds = argv.filter((item) => item.startsWith("--threshold=")).map((item) => item.slice("--threshold=".length));

function options(defaults) {
  return {
    vus: Number(argValue(argv, "vus", defaults.vus)),
    durationMs: parseDuration(argValue(argv, "duration"), defaults.durationMs),
    rampUpMs: parseDuration(argValue(argv, "ramp-up"), defaults.rampUpMs),
    thinkMs: Number(argValue(argv, "think-ms", defaults.thinkMs)),
    rooms: Number(argValue(argv, "rooms", defaults.rooms ?? 0)),
    thresholds: userThresholds.length ? userThresholds : defaults.thresholds,
  };
}

function post(ctx, name, body, token) {
  return [
    `${ctx.target.functionsBaseUrl}/${name}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ctx.apikey ? { apikey: ctx.apikey } : {}) },
      body: JSON.stringify(body),
    },
  ];
}

// ------------------------------------------------------------------------------- scenarios
const SCENARIOS = {
  "access-status": {
    defaults: { vus: 20, durationMs: 20_000, rampUpMs: 3_000, thinkMs: 200, thresholds: ["p95<800", "p99<1500", "error_rate<0.01"] },
    usersNeeded: (opts) => opts.vus,
    async run(ctx, opts, metrics) {
      await runVirtualUsers({
        ...opts,
        iteration: async (vu) => {
          const user = ctx.users[vu % ctx.users.length];
          const result = await timedRequest(metrics, "access-status", ctx.fetch, ...post(ctx, "access-status", {}, user.accessToken));
          if (result.status === 200 && typeof result.json?.active !== "boolean") metrics.check("access-status body has boolean active", false, JSON.stringify(result.json).slice(0, 80));
        },
      });
      metrics.check("access-status body has boolean active", true);
    },
  },

  "multi-tester": {
    defaults: { vus: 0, durationMs: 20_000, rampUpMs: 3_000, thinkMs: 1_000, rooms: 5, thresholds: ["p95<800", "p99<1500", "error_rate<0.01"] },
    usersNeeded: (opts) => opts.rooms * 4,
    async run(ctx, opts, metrics) {
      const setup = new Metrics();
      const rooms = [];
      for (let index = 0; index < opts.rooms; index += 1) {
        const [host, ...guests] = ctx.users.slice(index * 4, index * 4 + 4);
        let created = await timedRequest(setup, "setup.create", ctx.fetch, ...post(ctx, "multi-tester", { action: "create", nickname: `Load host ${index}`, durationMinutes: 60, idleTimeoutMinutes: 10 }, host.accessToken));
        if (created.status === 200 && created.json.members.length > 1) {
          // Leftover room from a previous run on a real test project: end it, start clean.
          await timedRequest(setup, "setup.end", ctx.fetch, ...post(ctx, "multi-tester", { action: "end", roomId: created.json.room.id }, host.accessToken));
          created = await timedRequest(setup, "setup.create", ctx.fetch, ...post(ctx, "multi-tester", { action: "create", nickname: `Load host ${index}`, durationMinutes: 60, idleTimeoutMinutes: 10 }, host.accessToken));
        }
        if (created.status !== 200) throw new Error(`room setup failed: create returned ${created.status} ${JSON.stringify(created.json)}`);
        const room = created.json.room;
        for (const guest of guests) {
          const requested = await timedRequest(setup, "setup.request", ctx.fetch, ...post(ctx, "multi-tester", { action: "request", code: room.code, nickname: "Load guest" }, guest.accessToken));
          const approved = await timedRequest(setup, "setup.approve", ctx.fetch, ...post(ctx, "multi-tester", { action: "approve", roomId: room.id, userId: guest.userId }, host.accessToken));
          if (requested.status !== 200 || approved.status !== 200) throw new Error(`room setup failed: request ${requested.status}, approve ${approved.status} ${JSON.stringify(approved.json)}`);
        }
        rooms.push({ room, members: [host, ...guests] });
      }
      const lastState = new Map();
      try {
        await runVirtualUsers({
          ...opts,
          vus: rooms.length * 4,
          iteration: async (vu, iterationIndex) => {
            const { room, members } = rooms[Math.floor(vu / 4)];
            const member = members[vu % 4];
            // Host keeps the room alive (touch); guests mostly poll state and touch every 5th poll,
            // like the toolbar does on activity.
            const action = vu % 4 === 0 || iterationIndex % 5 === 4 ? "touch" : "state";
            const result = await timedRequest(metrics, `multi-tester.${action}`, ctx.fetch, ...post(ctx, "multi-tester", { action, roomId: room.id }, member.accessToken));
            if (result.status === 200) lastState.set(vu, result.json);
          },
        });
      } finally {
        for (const { room, members } of rooms) await timedRequest(setup, "teardown.end", ctx.fetch, ...post(ctx, "multi-tester", { action: "end", roomId: room.id }, members[0].accessToken));
      }
      // Functional check under load: every member ended the run still active in an open room of 4.
      const broken = [...lastState.values()].filter((state) => state.me.status !== "active" || state.room.status !== "open" || state.members.length !== 4);
      metrics.check("every member stayed active in an open room of 4 during the run", broken.length === 0 && lastState.size === rooms.length * 4, `${lastState.size} members reported, ${broken.length} inconsistent`);
    },
  },

  "sign-in-rate-limit": {
    defaults: { vus: 5, durationMs: 10_000, rampUpMs: 0, thinkMs: 50, thresholds: ["error_rate<0.001"] },
    usersNeeded: () => 0,
    async run(ctx, opts, metrics) {
      // One random e-mail per VU, never an existing account: the limiter is keyed by e-mail, so
      // this never locks a real user out.
      const emails = Array.from({ length: opts.vus }, () => `qts-load-${randomUUID().slice(0, 12)}@example.com`);
      const perEmail = emails.map(() => ({ unauthorized: 0, limited: 0, firstLimitedAt: null, unexpected: 0 }));
      await runVirtualUsers({
        ...opts,
        iteration: async (vu) => {
          const stats = perEmail[vu];
          const result = await timedRequest(metrics, "auth-sign-in.wrong-password", ctx.fetch, ...post(ctx, "auth-sign-in", { email: emails[vu], password: `test-wrong-${randomUUID()}` }), [401, 429]);
          if (result.status === 401) stats.unauthorized += 1;
          else if (result.status === 429) {
            stats.limited += 1;
            stats.firstLimitedAt ??= stats.unauthorized + stats.limited;
          } else stats.unexpected += 1;
        },
      });
      const over = perEmail.filter((stats) => stats.unauthorized > SIGN_IN_LIMIT);
      const never = perEmail.filter((stats) => stats.limited === 0);
      metrics.check(`no e-mail got more than ${SIGN_IN_LIMIT} password attempts evaluated`, over.length === 0, over.length ? `max attempts evaluated: ${Math.max(...perEmail.map((stats) => stats.unauthorized))}` : "");
      metrics.check("429 kicked in for every e-mail", never.length === 0, `first 429 at attempt ${perEmail.map((stats) => stats.firstLimitedAt).join(",")}`);
      metrics.check("never 200 / 5xx for wrong passwords", perEmail.every((stats) => stats.unexpected === 0));
    },
  },
};

// ------------------------------------------------------------------------------- users
async function signIn(ctx, entry) {
  if (entry.accessToken) return entry;
  const response = await ctx.fetch(...post(ctx, "auth-sign-in", { email: entry.email, password: entry.password }));
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`sign-in failed for ${entry.email}: ${response.status} ${json.error ?? ""}`);
  return { accessToken: json.accessToken, userId: json.user?.id };
}

async function realUsers(ctx, needed) {
  if (!needed) return [];
  const file = argValue(argv, "users-file", process.env.QTS_TEST_LOAD_USERS_FILE);
  if (!file) throw new Error(`This scenario needs ${needed} test users: set QTS_TEST_LOAD_USERS_FILE (JSON array of {email,password} or {accessToken,userId}; Release Manager plan for multi-tester).`);
  const entries = JSON.parse(readFileSync(resolve(file), "utf8"));
  if (entries.length < needed) throw new Error(`QTS_TEST_LOAD_USERS_FILE has ${entries.length} users, scenario needs ${needed}.`);
  const users = [];
  for (const entry of entries.slice(0, needed)) users.push(await signIn(ctx, entry)); // sequential: sign-in has its own per-e-mail limit
  return users;
}

async function runScenario(name, ctx, opts) {
  const metrics = new Metrics();
  await SCENARIOS[name].run(ctx, opts, metrics);
  metrics.finish();
  const report = metrics.report();
  const failures = evaluateThresholds(report, opts.thresholds);
  console.log(formatReport(`${name} @ ${ctx.target.origin} vus=${name === "multi-tester" ? opts.rooms * 4 : opts.vus} think=${opts.thinkMs}ms`, report));
  console.log(failures.length ? `RESULT ${name}: FAIL\n${failures.map((item) => `  - ${item}`).join("\n")}` : `RESULT ${name}: PASS (thresholds: ${opts.thresholds.join(", ")})`);
  return { name, report, failures, thresholds: opts.thresholds };
}

function saveReport(results, label) {
  const path = resolve(ROOT, argValue(argv, "report", `artifacts/load-reports/${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`report: ${path}`);
}

async function main() {
  const selected = argValue(argv, "scenario", "all");
  const names = selected === "all" ? Object.keys(SCENARIOS) : selected.split(",");
  for (const name of names) if (!SCENARIOS[name]) throw new Error(`unknown scenario ${name}; use ${Object.keys(SCENARIOS).join(", ")}`);

  if (local) {
    // Shorter defaults locally so the suite is a quick, repeatable gate.
    const localDefaults = { "access-status": { durationMs: 8_000 }, "multi-tester": { durationMs: 8_000 }, "sign-in-rate-limit": { durationMs: 5_000 } };
    const plans = names.map((name) => ({ name, opts: options({ ...SCENARIOS[name].defaults, ...localDefaults[name] }) }));
    const needed = Math.max(0, ...plans.map(({ name, opts }) => SCENARIOS[name].usersNeeded(opts)));
    const mock = await startMockProcess([`--extra-rm-users=${needed}`]);
    const results = [];
    try {
      const target = resolveTarget({ url: mock.url, argv: [] });
      const ctx = { target, fetch: guardedFetchFor(target), users: mock.identities.loadUsers };
      console.log(`== Load suite against LOCAL MOCK ${target.origin} (mock in a child process on this machine: numbers validate the suite, not production capacity)`);
      for (const { name, opts } of plans) results.push(await runScenario(name, ctx, opts));
    } finally {
      await mock.stop();
    }
    saveReport(results, "local");
    if (results.some((result) => result.failures.length)) process.exit(1);
    if (argv.includes("--no-self-check")) return;

    console.log("\n== Self-check: thresholds must FAIL when the target is slow or the limiter is off");
    const escaped = [];
    const slow = await startMockProcess(["--extra-rm-users=4", "--latency-ms=300"]);
    try {
      const target = resolveTarget({ url: slow.url, argv: [] });
      const ctx = { target, fetch: guardedFetchFor(target), users: slow.identities.loadUsers };
      const result = await runScenario("access-status", ctx, { vus: 4, durationMs: 2_000, rampUpMs: 0, thinkMs: 0, thresholds: ["p95<200"] });
      if (!result.failures.length) escaped.push("slow target (300 ms) passed p95<200");
    } finally {
      await slow.stop();
    }
    const open = await startMockProcess(["--disable-rate-limit"]);
    try {
      const target = resolveTarget({ url: open.url, argv: [] });
      const ctx = { target, fetch: guardedFetchFor(target), users: [] };
      const result = await runScenario("sign-in-rate-limit", ctx, { vus: 2, durationMs: 2_000, rampUpMs: 0, thinkMs: 10, thresholds: ["error_rate<0.001"] });
      if (!result.failures.length) escaped.push("disabled limiter passed the 429 checks");
    } finally {
      await open.stop();
    }
    if (escaped.length) {
      console.error(`Self-check FAILED: ${escaped.join("; ")}`);
      process.exit(1);
    }
    console.log("Self-check passed: the slow target and the disabled limiter were both detected (the FAIL lines above are expected).");
    return;
  }

  const target = resolveTarget({ url: argValue(argv, "target"), argv });
  const ctx = { target, fetch: guardedFetchFor(target), apikey: process.env.QTS_TEST_SUPABASE_ANON_KEY ?? "" };
  const plans = names.map((name) => ({ name, opts: options(SCENARIOS[name].defaults) }));
  if (target.kind !== "local") {
    for (const { name, opts } of plans) {
      const vus = name === "multi-tester" ? opts.rooms * 4 : opts.vus;
      if (vus > MAX_REMOTE_VUS || opts.durationMs > MAX_REMOTE_DURATION_MS) {
        throw new TargetRefusedError(`Refused: ${name} asks for ${vus} VUs / ${opts.durationMs} ms; the remote cap is ${MAX_REMOTE_VUS} VUs / ${MAX_REMOTE_DURATION_MS / 60_000} min (Supabase test projects have quotas too).`);
      }
    }
    console.log(`== Load suite against TEST PROJECT ${target.origin} (${OWNERSHIP_FLAG} given)`);
  }
  ctx.users = await realUsers(ctx, Math.max(0, ...plans.map(({ name, opts }) => SCENARIOS[name].usersNeeded(opts))));
  const results = [];
  for (const { name, opts } of plans) results.push(await runScenario(name, ctx, opts));
  saveReport(results, target.kind);
  if (results.some((result) => result.failures.length)) process.exit(1);
}

main().catch((error) => {
  if (error instanceof TargetRefusedError) {
    console.error(`\n${error.message}\nNo request was sent.`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
