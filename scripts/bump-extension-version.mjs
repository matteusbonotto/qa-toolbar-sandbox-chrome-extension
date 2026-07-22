// Auto-bumps apps/extension/manifest.json's patch version. Written because the Chrome Web Store
// upload step (scripts/publish-chrome-webstore.mjs, run from .github/workflows/chrome-store-package.yml
// on every push to main touching apps/extension/**) rejects an upload whose version matches what's
// already live -- every release this project has shipped needed a human to remember to bump the
// manifest by hand first, and more than once that step got missed and only surfaced as a CI
// failure. Wired into `npm run release:chrome:*` below so it happens automatically as part of the
// normal release flow, before packaging.
//
// Deliberately NOT wired into the GitHub Actions auto-publish-on-push workflow itself: doing that
// safely needs the workflow to commit the bump back to `main` (extra permissions, a bot identity,
// and a real risk of a bad interaction with branch protection or a concurrent push) -- outside the
// safe-to-automate-unsupervised scope for this round. Run this manually (or via the release:chrome:*
// scripts) before merging/publishing.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = resolve(import.meta.dirname, "..", "apps/extension/manifest.json");

export async function bumpExtensionVersion({ part = "patch" } = {}) {
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const segments = String(manifest.version || "0.0.0").split(".").map((value) => Number.parseInt(value, 10) || 0);
  while (segments.length < 3) segments.push(0);
  const [major, minor, patch] = segments;
  const previous = `${major}.${minor}.${patch}`;
  const next = part === "major" ? `${major + 1}.0.0` : part === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  // Preserve the file's own formatting style (2-space indent, trailing newline) instead of
  // re-serializing the whole object, so this stays a minimal, reviewable diff.
  const updated = raw.replace(/"version":\s*"[^"]+"/, `"version": "${next}"`);
  await writeFile(manifestPath, updated);
  return { previous, next };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const part = process.argv.includes("--major") ? "major" : process.argv.includes("--minor") ? "minor" : "patch";
  const { previous, next } = await bumpExtensionVersion({ part });
  console.log(`Extension version bumped: ${previous} -> ${next}`);
}
