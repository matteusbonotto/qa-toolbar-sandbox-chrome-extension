// Read-only check: does the LIVE Supabase project actually have the plan/feature matrix that
// supabase/migrations/20260717080000_new_qa_tools_feature_flags.sql defines? Migration files
// living in the repo prove nothing about what's deployed — nothing in this project auto-applies
// them (no CI step does `supabase db push`), so every migration after the one confirmed in
// docs/handoff/CHECKLIST_RECONSTRUCAO.md needs a human to actually run it against the real
// database. This script exists because that gap silently blocked release-manager users from six
// tools they're entitled to (characterCounter/multiClick/inputLab/fakerFill/macroStudio/keyView)
// even though the code, the schema.sql source of truth, and the migration file were all correct.
//
// This script must be run by YOU, locally, with your own Supabase service-role key — Claude
// never receives or uses that key. It only reads; it changes nothing.
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/verify-plan-features.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing env vars. Run as:\n" +
      "  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-plan-features.mjs",
  );
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
      "\nFix: open supabase/migrations/20260717080000_new_qa_tools_feature_flags.sql, copy its\n" +
        "contents into the Supabase dashboard's SQL Editor for this project, and run it (it's\n" +
        "idempotent — safe to run even if partially applied). Or fix individual cells by hand in\n" +
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
