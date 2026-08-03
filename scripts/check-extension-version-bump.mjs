// CI guard: if this change touches apps/extension/** at all, manifest.json's version must differ
// from what's on the base commit. This project has silently shipped extension changes without a
// version bump more than once (see git history - e.g. "...e esquece bump de versão") because the
// bump only happens manually, right before a Chrome Web Store upload, which is easy to forget when
// a change merges to main without immediately publishing. This makes that mistake fail CI instead
// of quietly landing.
//
// BASE_SHA is provided by the workflow: the PR's base commit on pull_request, or the previous
// commit on a push to main/master. If it's missing/unusable (shallow history, first commit on a
// branch, etc.) this skips rather than false-failing - it's a safety net, not a blocker for cases
// it can't reason about.
import { execSync } from "node:child_process";

const baseSha = (process.env.BASE_SHA || "").trim();

function git(args) {
  return execSync(`git ${args}`, { encoding: "utf8" }).trim();
}

if (!baseSha || /^0+$/.test(baseSha)) {
  console.log("No usable base commit to compare against - skipping extension version-bump check.");
  process.exit(0);
}

let changedFiles;
try {
  changedFiles = git(`diff --name-only ${baseSha} HEAD`).split("\n").filter(Boolean);
} catch {
  console.log(`Could not diff against ${baseSha} (shallow history?) - skipping extension version-bump check.`);
  process.exit(0);
}

const extensionChanged = changedFiles.some((file) => file.startsWith("apps/extension/"));
if (!extensionChanged) {
  console.log("apps/extension/ did not change - nothing to check.");
  process.exit(0);
}

function versionAt(ref) {
  try {
    return JSON.parse(git(`show ${ref}:apps/extension/manifest.json`)).version;
  } catch {
    return null;
  }
}

const baseVersion = versionAt(baseSha);
const headVersion = versionAt("HEAD");

if (!baseVersion || !headVersion) {
  console.log("Could not read manifest.json version on one side of the diff - skipping.");
  process.exit(0);
}

if (baseVersion === headVersion) {
  console.error(
    `apps/extension/** changed but manifest.json's version is still ${headVersion} (same as ` +
      `${baseSha.slice(0, 7)}).\nRun "npm run bump:extension" and commit the result before merging.`,
  );
  process.exit(1);
}

console.log(`Extension version bumped: ${baseVersion} -> ${headVersion}. OK.`);
