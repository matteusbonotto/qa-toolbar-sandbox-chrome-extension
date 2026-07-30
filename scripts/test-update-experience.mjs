import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [manifestRaw, background, toolbar, options, storage] = await Promise.all([
  readFile(new URL("../apps/extension/manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../apps/extension/src/background/background.js", import.meta.url), "utf8"),
  readFile(new URL("../apps/extension/src/toolbar/toolbar.js", import.meta.url), "utf8"),
  readFile(new URL("../apps/extension/src/options/options.js", import.meta.url), "utf8"),
  readFile(new URL("../apps/extension/src/lib/storage.js", import.meta.url), "utf8"),
]);
const manifest = JSON.parse(manifestRaw);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.match(background, /details\.reason === "update"/);
assert.match(background, /details\.previousVersion/);
assert.match(background, /pendingReleaseNote/);
assert.match(toolbar, /Os nomes estão consistentes em Tools, Configurações, Workspace e Landing Page/);
assert.match(options, /Nomes consistentes em Tools, Configurações, Workspace e Landing Page/);
assert.match(toolbar, /Macros abre um submenu com os fluxos salvos/);
assert.match(options, /El Validador de campos muestra reglas, resultado e historial local seguro/);
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
assert.match(storage, /schemaVersion:\s*17/);
assert.match(storage, /source\.schemaVersion[^\n]*< 11/);
assert.match(storage, /source\.schemaVersion[^\n]*< 13/);
console.log(`Update experience checks passed for v${manifest.version}.`);
