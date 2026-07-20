// Applies (idempotently) the exact plan/feature matrix that
// supabase/migrations/20260717080000_new_qa_tools_feature_flags.sql defines, using ordinary
// table upserts instead of raw SQL — no Postgres connection string needed, just the same
// service-role key every other script in supabase/ already uses. This exists because that
// migration was written and merged but never actually run against the live project, which
// silently blocked characterCounter/multiClick/inputLab/fakerFill/macroStudio/keyView for every
// plan, including Release Manager. Safe to re-run any number of times.
//
// This script must be run by YOU, locally, with your own Supabase service-role key — Claude
// never receives or uses that key.
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/apply-plan-features-migration.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing env vars. Run as:\n" +
      "  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/apply-plan-features-migration.mjs",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const FEATURES = [
  { key: "characterCounter.enabled", value_type: "boolean", description: "Character/word/line/byte counter tool" },
  { key: "multiClick.enabled", value_type: "boolean", description: "Multiclick tool with visual selection and limits" },
  { key: "inputLab.enabled", value_type: "boolean", description: "Input Lab: tests input classes without submitting the form" },
  { key: "fakerFill.enabled", value_type: "boolean", description: "Faker Fill: local synthetic data autofill" },
  { key: "macroStudio.enabled", value_type: "boolean", description: "Macro Studio: record/replay, Vibe Code, Playwright export" },
  { key: "keyView.enabled", value_type: "boolean", description: "Key View: on-screen keystroke/typing/mouse visualizer" },
  { key: "elementCapture.enabled", value_type: "boolean", description: "Capturar Elementos: exports a CSV of interactive elements with CSS selector/XPath for automation" },
];

// Same tiered distribution as the migration and docs/GUIA_FERRAMENTAS_QA.md.
const MATRIX = {
  "characterCounter.enabled": { "smoke-test": true, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "multiClick.enabled": { "smoke-test": true, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "inputLab.enabled": { "smoke-test": false, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "fakerFill.enabled": { "smoke-test": false, "regression-runner": true, "root-cause-analyst": true, "release-manager": true },
  "macroStudio.enabled": { "smoke-test": false, "regression-runner": false, "root-cause-analyst": true, "release-manager": true },
  "keyView.enabled": { "smoke-test": false, "regression-runner": false, "root-cause-analyst": false, "release-manager": true },
  "elementCapture.enabled": { "smoke-test": false, "regression-runner": false, "root-cause-analyst": true, "release-manager": true },
};

async function main() {
  console.log("1/3 — Upserting feature definitions...");
  const { error: featuresError } = await supabase.from("features").upsert(FEATURES, { onConflict: "key" });
  if (featuresError) throw featuresError;
  console.log(`  ok — ${FEATURES.length} feature(s) present.`);

  console.log("2/3 — Loading plan and feature ids...");
  const { data: plans, error: plansError } = await supabase.from("plans").select("id,key");
  if (plansError) throw plansError;
  const { data: features, error: loadFeaturesError } = await supabase.from("features").select("id,key").in("key", FEATURES.map((f) => f.key));
  if (loadFeaturesError) throw loadFeaturesError;
  const planByKey = new Map(plans.map((p) => [p.key, p]));
  const featureByKey = new Map(features.map((f) => [f.key, f]));

  console.log("3/3 — Upserting plan_features matrix...");
  const rows = [];
  for (const [featureKey, byPlan] of Object.entries(MATRIX)) {
    const feature = featureByKey.get(featureKey);
    if (!feature) throw new Error(`Feature "${featureKey}" was not found after upsert — this should not happen.`);
    for (const [planKey, value] of Object.entries(byPlan)) {
      const plan = planByKey.get(planKey);
      if (!plan) throw new Error(`Plan "${planKey}" does not exist in the live "plans" table.`);
      rows.push({ plan_id: plan.id, feature_id: feature.id, value });
    }
  }
  const { error: pfError } = await supabase.from("plan_features").upsert(rows, { onConflict: "plan_id,feature_id" });
  if (pfError) throw pfError;
  console.log(`  ok — ${rows.length} plan × feature cell(s) written.`);

  console.log("\nVerifying...");
  const { data: verifyRows, error: verifyError } = await supabase.from("plan_features").select("plan_id,feature_id,value");
  if (verifyError) throw verifyError;
  const valueByCell = new Map(verifyRows.map((row) => [`${row.plan_id}:${row.feature_id}`, row.value]));
  const problems = [];
  for (const [featureKey, byPlan] of Object.entries(MATRIX)) {
    const feature = featureByKey.get(featureKey);
    for (const [planKey, expected] of Object.entries(byPlan)) {
      const plan = planByKey.get(planKey);
      const actual = valueByCell.get(`${plan.id}:${feature.id}`);
      if (actual !== expected) problems.push(`${featureKey} × ${planKey}: expected ${expected}, got ${actual}`);
    }
  }
  if (problems.length) {
    console.error("\nSomething is still off after applying:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`\nDone. All ${FEATURES.length} tools are now correctly gated for every plan — Release Manager has all ${FEATURES.length} enabled.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
