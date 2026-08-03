// Read-only check: does the LIVE Supabase project actually have the plan/feature matrix that
// supabase/migrations/20260717080000_new_qa_tools_feature_flags.sql defines? Migration files
// living in the repo prove nothing about what's deployed — nothing in this project auto-applies
// them (no CI step does `supabase db push`), so every migration after the one confirmed in
// docs/handoff/archive/CHECKLIST_RECONSTRUCAO.md needs a human to actually run it against the real
// database. This script exists because that gap silently blocked release-manager users from six
// tools they're entitled to (characterCounter/multiClick/inputLab/fakerFill/macroStudio/keyView)
// even though the code, the schema.sql source of truth, and the migration file were all correct.
//
// This script must be run by YOU, locally — Claude never receives or uses your Supabase key.
// It only reads; it changes nothing. Credentials: SUPABASE_URL/SUPABASE_PROJECT_REF come from the
// gitignored .env.edge.local file every other backend script here already reads; the service-role
// key itself is fetched fresh from the authenticated Supabase CLI session (same
// `supabase projects api-keys` call scripts/run-live-backend-smokes.ps1 already relies on) instead
// of trusting a static env var, since a stale/rotated key would otherwise fail with a confusing
// "Invalid API key" error. Nothing to type by hand.
//
// Usage:
//   npm run backend:verify-plan-features

import { createClient } from "@supabase/supabase-js";
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

const edgeLocalEnv = readEnvFile(resolve(ROOT, ".env.edge.local"));
const SUPABASE_URL = process.env.SUPABASE_URL ?? edgeLocalEnv.SUPABASE_URL;

// Same allowlist-regex-before-execFileSync proof as apply-pending-backend-actions.mjs.
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const rawProjectRef = process.env.SUPABASE_PROJECT_REF
  ?? edgeLocalEnv.SUPABASE_PROJECT_REF
  ?? SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const projectRef = rawProjectRef && PROJECT_REF_PATTERN.test(rawProjectRef) ? rawProjectRef : undefined;

if (!SUPABASE_URL || !projectRef) {
  console.error("Missing SUPABASE_URL / SUPABASE_PROJECT_REF in .env.edge.local.");
  process.exit(1);
}

let SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? "cmd.exe" : "npx";
  const args = isWindows
    ? ["/d", "/s", "/c", "npx", "--yes", "supabase", "projects", "api-keys", "--project-ref", projectRef, "-o", "json"]
    : ["--yes", "supabase", "projects", "api-keys", "--project-ref", projectRef, "-o", "json"];
  let apiKeysJson;
  try {
    apiKeysJson = execFileSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    console.error("Could not fetch API keys through the Supabase CLI:");
    console.error((err.stdout || "").trim() || (err.stderr || err.message || "").trim());
    process.exit(1);
  }
  const apiKeys = JSON.parse(apiKeysJson);
  SERVICE_ROLE_KEY = apiKeys.find((key) => key.name === "service_role" && key.type === "legacy")?.api_key;
}

if (!SERVICE_ROLE_KEY) {
  console.error("Could not obtain a service-role key for this project (CLI returned none).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// The tiered distribution the migration/schema.sql define as the intended factory default —
// this is what "correct" means for this check, independent of whatever the live DB says.
const EXPECTED = {
  "characterCounter.enabled": { "smoke-test": true, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "multiClick.enabled": { "smoke-test": true, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "inputLab.enabled": { "smoke-test": false, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "fakerFill.enabled": { "smoke-test": false, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "macroStudio.enabled": { "smoke-test": false, "regression-runner": false, "root-cause-analyst": true, "release-manager": true },
  "keyView.enabled": { "smoke-test": false, "regression-runner": false, "root-cause-analyst": false, "release-manager": true },
  "elementCapture.enabled": { "smoke-test": false, "regression-runner": false, "root-cause-analyst": true, "release-manager": true },
  "stepsRecorder.enabled": { "smoke-test": true, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "clearSiteData.enabled": { "smoke-test": true, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  // These four were only just wired up in the extension's code (jsonStudio/breakpoints tools now
  // call requirePlanFeature; recording checks recording.mp4/recording.gif before starting) — until
  // this run confirms they're correct in the live database too, publishing that extension version
  // would silently take these away from every plan, including paying Release Manager users.
  "jsonStudio.enabled": { "smoke-test": false, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "breakpointViewer.enabled": { "smoke-test": false, "regression-runner": false, "root-cause-analyst": true, "release-manager": true },
  "recording.mp4": { "smoke-test": false, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "recording.gif": { "smoke-test": false, "regression-runner": false, "root-cause-analyst": true, "release-manager": true },
};

async function main() {
  const { data: plans, error: plansError } = await supabase.from("plans").select("id,key,name");
  if (plansError) throw plansError;
  const { data: features, error: featuresError } = await supabase.from("features").select("id,key,value_type");
  if (featuresError) throw featuresError;
  const { data: planFeatures, error: pfError } = await supabase.from("plan_features").select("plan_id,feature_id,value");
  if (pfError) throw pfError;

  const planByKey = new Map(plans.map((p) => [p.key, p]));
  const featureByKey = new Map(features.map((f) => [f.key, f]));
  const valueByCell = new Map(planFeatures.map((row) => [`${row.plan_id}:${row.feature_id}`, row.value]));

  const problems = [];
  const rows = [];

  for (const [featureKey, byPlan] of Object.entries(EXPECTED)) {
    const feature = featureByKey.get(featureKey);
    if (!feature) {
      problems.push(`Feature "${featureKey}" does not exist in the live "features" table at all — the migration was never applied.`);
      rows.push({ feature: featureKey, ...Object.fromEntries(Object.keys(byPlan).map((planKey) => [planKey, "MISSING"])) });
      continue;
    }
    const row = { feature: featureKey };
    for (const [planKey, expectedValue] of Object.entries(byPlan)) {
      const plan = planByKey.get(planKey);
      if (!plan) { row[planKey] = "NO PLAN ROW"; problems.push(`Plan "${planKey}" does not exist.`); continue; }
      const actual = valueByCell.get(`${plan.id}:${feature.id}`);
      row[planKey] = actual === undefined ? "unset" : String(actual);
      if (actual !== expectedValue) {
        problems.push(`${featureKey} × ${planKey}: expected ${expectedValue}, live value is ${actual === undefined ? "UNSET (no row)" : actual}.`);
      }
    }
    rows.push(row);
  }

  console.table(rows);

  if (problems.length) {
    console.error(`\n${problems.length} mismatch(es) found between the intended matrix and the live database:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\nFix: run\n" +
        "  npm run backend:apply-pending -- --apply\n" +
        "(pushes every pending migration using the same .env.edge.local credentials, idempotent —\n" +
        "safe to run even if some of it was already applied). Or fix individual cells by hand in\n" +
        "/admin/ → Feature flags. Re-run this script afterward to confirm.",
    );
    process.exit(1);
  }

  console.log("\nAll plan × feature values match the intended matrix. Nothing to fix.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
