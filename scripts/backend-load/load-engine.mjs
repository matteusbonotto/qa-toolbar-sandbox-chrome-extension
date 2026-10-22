// Minimal load engine (a small k6/Gatling-like core) on Node built-ins only: virtual users (VUs)
// ramped up linearly, each running a scenario iteration in a loop until the duration ends, with
// per-request latency/status recording, percentiles, throughput and thresholds.

export function parseDuration(value, fallbackMs) {
  if (value === undefined || value === null || value === "") return fallbackMs;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) throw new Error(`invalid duration: ${value} (use 500ms, 20s, 2m)`);
  const number = Number(match[1]);
  return Math.round(match[2] === "ms" ? number : match[2] === "m" ? number * 60_000 : number * 1_000);
}

/** Nearest-rank percentile over an ascending array. */
export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export class Metrics {
  constructor() {
    this.byName = new Map();
    this.startedAt = Date.now();
    this.endedAt = null;
    this.checks = [];
  }

  record(name, { status, ms, ok }) {
    const entry = this.byName.get(name) ?? { latencies: [], statuses: {}, errors: 0, count: 0 };
    entry.latencies.push(ms);
    entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
    entry.count += 1;
    if (!ok) entry.errors += 1;
    this.byName.set(name, entry);
  }

  check(name, passed, detail = "") {
    this.checks.push({ name, passed: Boolean(passed), detail });
  }

  finish() {
    this.endedAt = Date.now();
  }

  summarize(entry, seconds) {
    const sorted = [...entry.latencies].sort((a, b) => a - b);
    return {
      count: entry.count,
      rps: Number((entry.count / Math.max(seconds, 0.001)).toFixed(2)),
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      max: Math.round(sorted.at(-1) ?? 0),
      error_rate: Number((entry.errors / Math.max(entry.count, 1)).toFixed(4)),
      statuses: entry.statuses,
    };
  }

  report() {
    const seconds = ((this.endedAt ?? Date.now()) - this.startedAt) / 1000;
    const total = { latencies: [], statuses: {}, errors: 0, count: 0 };
    const metrics = {};
    for (const [name, entry] of this.byName) {
      metrics[name] = this.summarize(entry, seconds);
      total.latencies.push(...entry.latencies);
      total.errors += entry.errors;
      total.count += entry.count;
      for (const [status, count] of Object.entries(entry.statuses)) total.statuses[status] = (total.statuses[status] ?? 0) + count;
    }
    return { durationSeconds: Number(seconds.toFixed(2)), overall: this.summarize(total, seconds), metrics, checks: this.checks };
  }
}

/** Timed fetch that records into metrics. `expected` = statuses counted as success. */
export async function timedRequest(metrics, name, fetchFn, url, init, expected = [200], timeoutMs = 10_000) {
  const started = performance.now();
  let status = 0;
  let json = null;
  try {
    const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    status = response.status;
    json = await response.json().catch(() => null);
  } catch {
    status = 0; // network error or timeout: always an error
  }
  const ms = performance.now() - started;
  metrics.record(name, { status, ms, ok: expected.includes(status) });
  return { status, json, ms };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `iteration(vuIndex, iterationIndex)` on `vus` virtual users for `durationMs`, starting VUs
 * linearly across `rampUpMs` and pausing `thinkMs` between iterations of the same VU.
 */
export async function runVirtualUsers({ vus, durationMs, rampUpMs = 0, thinkMs = 0, iteration }) {
  const endsAt = Date.now() + durationMs;
  const workers = Array.from({ length: vus }, async (_, vu) => {
    const delay = vus > 1 ? Math.round((rampUpMs * vu) / (vus - 1)) : 0;
    if (delay) await sleep(delay);
    let index = 0;
    while (Date.now() < endsAt) {
      await iteration(vu, index);
      index += 1;
      if (thinkMs) await sleep(thinkMs);
    }
  });
  await Promise.all(workers);
}

/**
 * Thresholds: "p95<800", "p99<=1500", "error_rate<0.01", "rps>5", "max<3000", optionally
 * prefixed by a metric name: "multi-tester.state:p95<500". Returns failure messages.
 */
export function evaluateThresholds(report, thresholds) {
  const failures = [];
  for (const raw of thresholds) {
    const match = String(raw).match(/^(?:([\w.-]+):)?(p50|p95|p99|max|error_rate|rps|count)\s*(<=|>=|<|>|==)\s*([\d.]+)$/);
    if (!match) {
      failures.push(`invalid threshold "${raw}"`);
      continue;
    }
    const [, metricName, key, operator, limitText] = match;
    const source = metricName ? report.metrics[metricName] : report.overall;
    if (!source) {
      failures.push(`threshold "${raw}": metric ${metricName} has no samples`);
      continue;
    }
    const value = source[key];
    const limit = Number(limitText);
    const passed = { "<": value < limit, "<=": value <= limit, ">": value > limit, ">=": value >= limit, "==": value === limit }[operator];
    if (!passed) failures.push(`threshold "${raw}" failed: ${key}=${value}`);
  }
  for (const check of report.checks) if (!check.passed) failures.push(`check "${check.name}" failed${check.detail ? `: ${check.detail}` : ""}`);
  return failures;
}

export function formatReport(title, report) {
  const rows = [["metric", "count", "rps", "p50", "p95", "p99", "max", "err%", "statuses"]];
  const add = (name, value) => rows.push([name, value.count, value.rps, value.p50, value.p95, value.p99, value.max, (value.error_rate * 100).toFixed(2), JSON.stringify(value.statuses)]);
  for (const [name, value] of Object.entries(report.metrics)) add(name, value);
  add("OVERALL", report.overall);
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  const lines = rows.map((row) => row.map((cell, column) => String(cell).padEnd(widths[column])).join("  "));
  const checks = report.checks.map((check) => `  [${check.passed ? "ok" : "FAIL"}] ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
  return [`-- ${title} (${report.durationSeconds}s, latency in ms)`, ...lines, ...(checks.length ? ["checks:", ...checks] : [])].join("\n");
}
