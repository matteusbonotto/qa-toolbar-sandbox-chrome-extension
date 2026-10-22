// Target guard shared by the backend security suite (scripts/backend-security) and the load
// runner (scripts/backend-load). Founder rule, non-negotiable: no load or attack traffic ever goes
// to PRODUCTION or to any third party. The guard runs BEFORE any socket is opened and fails closed:
//
// - 127.0.0.1 / localhost / ::1 (the local mock or `supabase start`) are always allowed.
// - A remote target is allowed only when it is a separate Supabase TEST project named explicitly in
//   QTS_TEST_SUPABASE_URL + QTS_TEST_SUPABASE_PROJECT_REF, the URL is exactly
//   https://<ref>.supabase.co, and the caller passed --i-own-this-test-target.
// - The production project (and any ref hard-coded in the shipped extension) is refused even with
//   the flag. Any other host is refused.
//
// Requests made with the resolved target must also use `redirect: "manual"` (see guardedFetch) so a
// redirect can never carry the traffic to a host the guard did not approve.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const PRODUCTION_PROJECT_REF = "xhusvkylbouwtpcevgri";
export const OWNERSHIP_FLAG = "--i-own-this-test-target";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export class TargetRefusedError extends Error {
  constructor(message) {
    super(message);
    this.name = "TargetRefusedError";
  }
}

// Every Supabase ref the shipped extension talks to is production by definition. Reading it from
// the source means a future production move is blocked automatically, not only the ref above.
export function productionRefs(root = REPO_ROOT) {
  const refs = new Set([PRODUCTION_PROJECT_REF]);
  for (const relative of ["apps/extension/src/background/auth.js", "apps/extension/src/background/multi-tester.js"]) {
    let source = "";
    try {
      source = readFileSync(resolve(root, relative), "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(/([a-z0-9]{20})\.supabase\.co/gi)) refs.add(match[1].toLowerCase());
  }
  return refs;
}

function containsBlockedRef(text, blocked) {
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // keep the raw text: a malformed escape cannot hide the ref from the raw check below
  }
  const haystacks = [text.toLowerCase(), decoded.toLowerCase()];
  return [...blocked].some((ref) => haystacks.some((value) => value.includes(ref)));
}

/**
 * Resolves and validates the target. Throws TargetRefusedError on any doubt.
 * @param {{ url?: string, argv?: string[], env?: Record<string, string | undefined>, blockedRefs?: Set<string> }} options
 * @returns {{ origin: string, functionsBaseUrl: string, kind: "local" | "test-project", projectRef: string | null }}
 */
export function resolveTarget({ url, argv = process.argv.slice(2), env = process.env, blockedRefs = productionRefs() } = {}) {
  const candidate = String(url ?? env.QTS_TEST_SUPABASE_URL ?? "").trim();
  if (!candidate) {
    throw new TargetRefusedError(
      "No target. Use the :local script (mock server), pass --target=http://127.0.0.1:<port> for a local "
      + "Supabase, or set QTS_TEST_SUPABASE_URL + QTS_TEST_SUPABASE_PROJECT_REF for a SEPARATE test project "
      + `and pass ${OWNERSHIP_FLAG}.`,
    );
  }
  for (const value of [candidate, env.QTS_TEST_SUPABASE_URL ?? "", env.QTS_TEST_SUPABASE_PROJECT_REF ?? ""]) {
    if (value && containsBlockedRef(value, blockedRefs)) {
      throw new TargetRefusedError("Refused: the target names the PRODUCTION Supabase project. Production is never a load/attack target, flag or not.");
    }
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new TargetRefusedError(`Refused: target is not a valid URL (${candidate}).`);
  }
  if (parsed.username || parsed.password) throw new TargetRefusedError("Refused: credentials embedded in the target URL.");
  if (!["http:", "https:"].includes(parsed.protocol)) throw new TargetRefusedError(`Refused: protocol ${parsed.protocol} is not http/https.`);
  const host = parsed.hostname.toLowerCase();

  if (LOCAL_HOSTS.has(host)) {
    return { origin: parsed.origin, functionsBaseUrl: `${parsed.origin}/functions/v1`, kind: "local", projectRef: null };
  }

  const declaredRef = String(env.QTS_TEST_SUPABASE_PROJECT_REF ?? "").trim().toLowerCase();
  const declaredUrl = String(env.QTS_TEST_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!argv.includes(OWNERSHIP_FLAG)) {
    throw new TargetRefusedError(`Refused: remote host ${host} needs ${OWNERSHIP_FLAG} (and it must be a separate test project you own).`);
  }
  if (!/^[a-z0-9]{20}$/.test(declaredRef)) {
    throw new TargetRefusedError("Refused: QTS_TEST_SUPABASE_PROJECT_REF must name the separate test project (20 lowercase letters/digits).");
  }
  if (blockedRefs.has(declaredRef)) {
    throw new TargetRefusedError("Refused: QTS_TEST_SUPABASE_PROJECT_REF is the PRODUCTION project.");
  }
  if (parsed.protocol !== "https:" || host !== `${declaredRef}.supabase.co` || (parsed.port && parsed.port !== "443")) {
    throw new TargetRefusedError(`Refused: ${host} is not allowlisted. Only https://${declaredRef}.supabase.co (the declared test project) is.`);
  }
  if (declaredUrl.toLowerCase() !== parsed.origin.toLowerCase()) {
    throw new TargetRefusedError("Refused: the target must be exactly QTS_TEST_SUPABASE_URL (origin only, no path).");
  }
  return { origin: parsed.origin, functionsBaseUrl: `${parsed.origin}/functions/v1`, kind: "test-project", projectRef: declaredRef };
}

/** fetch that never follows redirects and refuses any URL outside the approved origin. */
export function guardedFetchFor(target) {
  return async function guardedFetch(input, init = {}) {
    const requestUrl = new URL(String(input));
    if (requestUrl.origin !== target.origin) {
      throw new TargetRefusedError(`Refused: request to ${requestUrl.origin} is outside the approved target ${target.origin}.`);
    }
    return fetch(requestUrl, { ...init, redirect: "manual" });
  };
}

export function argValue(argv, name, fallback = undefined) {
  const prefix = `--${name}=`;
  const found = argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}
