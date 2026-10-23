import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [manifestRaw, background, toolbar, options, storage, releaseNotes] = await Promise.all([
  readFile(new URL("../apps/extension/manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../apps/extension/src/background/background.js", import.meta.url), "utf8"),
  readFile(new URL("../apps/extension/src/toolbar/toolbar.js", import.meta.url), "utf8"),
  readFile(new URL("../apps/extension/src/options/options.js", import.meta.url), "utf8"),
  readFile(new URL("../apps/extension/src/lib/storage.js", import.meta.url), "utf8"),
  readFile(new URL("../apps/extension/src/lib/release-notes-content.js", import.meta.url), "utf8"),
]);
const manifest = JSON.parse(manifestRaw);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.match(background, /details\.reason === "update"/);
assert.match(background, /details\.previousVersion/);
assert.match(background, /pendingReleaseNote/);
// Release notes come from the per-version registry (src/lib/release-notes-content.js). The old
// fixed sentences are a regression: every update showed the same stale list (founder 2026-10-23).
assert.doesNotMatch(toolbar, /A conta ativa agora mostra o plano na Landing Page/);
assert.doesNotMatch(options, /A conta ativa agora mostra o plano na Landing Page/);
assert.match(toolbar, /QTS_RELEASE_NOTES\.copyFor/);
assert.match(options, /QTS_RELEASE_NOTES\.copyFor/);
assert.match(toolbar, /releaseNoteAutoOpened/);
assert.match(background, /src\/lib\/release-notes-content\.js/);
globalThis.window = {};
new Function(releaseNotes)();
const registry = globalThis.window.QTS_RELEASE_NOTES;
assert.ok(registry.notes.some((entry) => entry.version === manifest.version), `release-notes-content.js has no entry for v${manifest.version}`);
for (const entry of registry.notes) for (const locale of ["pt-BR", "en", "es"]) {
  assert.ok(Array.isArray(entry[locale]) && entry[locale].length, `release notes v${entry.version} missing ${locale}`);
  for (const item of entry[locale]) assert.doesNotMatch(item, /\u2014/, `release note uses an em dash: ${item}`);
}
const skipped = registry.copyFor({ version: "1.4.46", previousVersion: "1.4.44", locale: "pt-BR" });
assert.ok(skipped.items.some((item) => item.includes("login lembra")) && skipped.items.some((item) => item.includes("Cursor personalizado")), "a user who skipped versions must see every newer version's notes");
assert.ok(!skipped.items.some((item) => item.startsWith("Multi Testador")), "notes of the version the user already had must not repeat");
assert.equal(registry.copyFor({ version: "1.4.46", locale: "en" }).items[0].startsWith("Custom cursor"), true);
assert.match(toolbar, /FIELD_VALIDATOR_HISTORY_KEY/);
assert.match(toolbar, /const INSPECTOR_HISTORY_KEY = "qtsInspectorHistoryV1"/);
assert.match(toolbar, /chrome\.storage\.local\.set\(\{ \[INSPECTOR_HISTORY_KEY\]: history \}\)/);
assert.match(toolbar, /data-report-export-pdf/);
assert.match(toolbar, /class="markerMobileOnly" type="button" data-marker-pick="pass"/);
assert.match(toolbar, /class="markerMobileOnly" type="button" data-marker-pick="fail"/);
assert.doesNotMatch(toolbar, /id="mobilePassItem"/);
assert.doesNotMatch(toolbar, /id="mobileFailItem"/);
assert.match(toolbar, /testAccountComposer/);
assert.match(toolbar, /paymentMethodComposer/);
assert.match(toolbar, /resourceComposer/);
assert.doesNotMatch(toolbar, /workspaceQuickComposer/);
assert.match(background, /query\.set\("composer"/);
assert.match(options, /allowedComposers/);
assert.match(toolbar, /openReleaseNotes/);
assert.match(toolbar, /lastSeenReleaseVersion/);
assert.match(options, /showPendingReleaseNotes/);
assert.match(storage, /schemaVersion:\s*19/);
assert.match(storage, /source\.schemaVersion[^\n]*< 11/);
assert.match(storage, /source\.schemaVersion[^\n]*< 13/);
console.log(`Update experience checks passed for v${manifest.version}.`);
