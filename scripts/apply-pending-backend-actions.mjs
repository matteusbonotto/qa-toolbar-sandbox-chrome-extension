// Consolidates the two Supabase actions that recur in docs/PENDENCIAS_USUARIO.md: pushing
// pending schema migrations and redeploying Edge Functions. Neither this project nor its CI
// ever applies a migration or redeploys a function automatically — see AGENTS.md ("Nenhum
// deploy... Supabase produtivo é autorizado apenas porque os testes passaram"). This script
// exists to remove the copy/paste tax of doing that by hand, not to remove the human decision:
// it defaults to a dry run and only ever writes to production when you pass --apply.
//
// Credentials are read from local, gitignored env files — never hardcoded, never logged:
//   .env             → SUPABASE_ACCESS_TOKEN (Personal Access Token, from
//                       https://supabase.com/dashboard/account/tokens — grants account-wide
//                       CLI access, treat like a password)
//   .env.edge.local  → SUPABASE_PROJECT_REF (or SUPABASE_URL, ref is derived from it)
//
// Usage:
//   node scripts/apply-pending-backend-actions.mjs              # dry run, writes nothing
//   node scripts/apply-pending-backend-actions.mjs --apply       # pushes migrations + redeploys functions
//   node scripts/apply-pending-backend-actions.mjs --apply --functions-only
//   node scripts/apply-pending-backend-actions.mjs --apply --migrations-only

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        const key = line.slice(0, at).trim();
        const rawValue = line.slice(at + 1).trim();
        const value = /^(['"]).*\1$/.test(rawValue) ? rawValue.slice(1, -1) : rawValue;
        return [key, value];
      }),
  );
}

// File values first, then real process.env wins (so CI or an explicit inline var can override
// what's on disk) — same precedence intent as scripts/publish-chrome-webstore.mjs.
const rootEnv = readEnvFile(resolve(ROOT, ".env"));
const edgeLocalEnv = readEnvFile(resolve(ROOT, ".env.edge.local"));
function envValue(key) {
  return process.env[key] ?? edgeLocalEnv[key] ?? rootEnv[key];
}

// Supabase project refs are always a 20-char lowercase alphanumeric slug. Enforcing that shape
// here (rather than passing the env-derived value straight through) is what makes it safe to
// hand to execFileSync below — CodeQL's js/indirect-command-line-injection check wants proof an
// environment-sourced argv value can't smuggle extra flags/shell metacharacters, and a full-match
// allowlist regex is exactly that proof.
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

const accessToken = envValue("SUPABASE_ACCESS_TOKEN");
const rawProjectRef = envValue("SUPABASE_PROJECT_REF")
  ?? envValue("SUPABASE_URL")?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const projectRef = rawProjectRef && PROJECT_REF_PATTERN.test(rawProjectRef) ? rawProjectRef : undefined;

if (rawProjectRef && !projectRef) {
  console.error(
    `SUPABASE_PROJECT_REF/SUPABASE_URL resolved to "${rawProjectRef}", which isn't a valid ` +
      "20-character lowercase alphanumeric Supabase project ref. Refusing to use it.",
  );
  process.exit(1);
}
if (!accessToken) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN. Generate a Personal Access Token at\n" +
      "https://supabase.com/dashboard/account/tokens and add it to .env as:\n" +
      "  SUPABASE_ACCESS_TOKEN=sbp_...\n" +
      "(it grants account-wide CLI access — treat it like a password, never commit it).",
  );
  process.exit(1);
}
if (!projectRef) {
  console.error("Missing SUPABASE_PROJECT_REF (or SUPABASE_URL to derive it from) in .env.edge.local.");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const migrationsOnly = process.argv.includes("--migrations-only");
const functionsOnly = process.argv.includes("--functions-only");
const doMigrations = !functionsOnly;
const doFunctions = !migrationsOnly;

// The token never touches argv (visible in process lists / shell history) — only the child's
// environment, and only for this process tree.
const childEnv = { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken };

// On Windows, npm/npx ship as .cmd shims that execFileSync can't exec directly ("npx" ENOENTs,
// "npx.cmd" EINVALs) - routing through cmd.exe /c resolves the shim correctly. This still goes
// through execFileSync's normal argv array (no `shell: true`), so Node still escapes each
// argument for the immediate child instead of string-concatenating them.
const isWindows = process.platform === "win32";

function runSupabase(args, { label }) {
  console.log(`\n$ npx supabase ${args.join(" ")}`);
  try {
    const command = isWindows ? "cmd.exe" : "npx";
    const commandArgs = isWindows ? ["/d", "/s", "/c", "npx", "--yes", "supabase", ...args] : ["--yes", "supabase", ...args];
    const output = execFileSync(command, commandArgs, {
      cwd: ROOT,
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(output.trim());
    return { ok: true, output };
  } catch (err) {
    console.error(`${label} failed:`);
    console.error((err.stdout || "").trim());
    console.error((err.stderr || err.message || "").trim());
    return { ok: false };
  }
}

async function main() {
  console.log(`Project: ${projectRef}`);
  console.log(apply ? "Mode: APPLY (this writes to production)" : "Mode: dry run (nothing will be written — pass --apply to actually push)");

  const link = runSupabase(["link", "--project-ref", projectRef], { label: "Link" });
  if (!link.ok) process.exit(1);

  if (doMigrations) {
    const dryRun = runSupabase(["db", "push", "--dry-run", "--linked"], { label: "Migration dry run" });
    if (!dryRun.ok) process.exit(1);
    const upToDate = dryRun.output.includes('"upToDate":false') === false;
    if (upToDate) {
      console.log("Migrations: nothing pending.");
    } else if (apply) {
      // --yes: stdin is not connected here (this runs non-interactively), so the CLI's own
      // "push these migrations?" prompt would otherwise hang forever. --apply on this script
      // *is* the confirmation - the dry run above already listed exactly what's about to run.
      const push = runSupabase(["db", "push", "--linked", "--yes"], { label: "Migration push" });
      if (!push.ok) process.exit(1);
      console.log("Migrations: applied.");
    } else {
      console.log("Migrations: pending (see list above) — rerun with --apply to push for real.");
    }
  }

  if (doFunctions) {
    if (apply) {
      const deploy = runSupabase(["functions", "deploy", "--project-ref", projectRef, "--use-api"], { label: "Functions deploy" });
      if (!deploy.ok) process.exit(1);
      console.log("Functions: redeployed.");
    } else {
      console.log(`Functions: would run "npx supabase functions deploy --project-ref ${projectRef} --use-api" — rerun with --apply to actually redeploy.`);
    }
  }

  console.log("\nDone. This only pushes schema/functions — anything in docs/PENDENCIAS_USUARIO.md that");
  console.log("needs a real login, a real email inbox, or a visual check still needs you.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
