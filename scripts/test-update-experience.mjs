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
assert.match(toolbar, /Dispositivos exibem nome, sistemas e navegadores nos relatórios e seletores/);
assert.match(options, /Dispositivos exibem nome, sistemas e navegadores nos relatórios e seletores/);
assert.match(toolbar, /Adding from a sidebar opens the original Settings form/);
assert.match(options, /Agregar desde un panel lateral abre el formulario original de Settings/);
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
