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
assert.match(toolbar, /O dispositivo usado agora acompanha passos, relatórios e o resumo da sessão/);
assert.match(options, /O dispositivo usado agora acompanha passos, relatórios e o resumo da sessão/);
assert.match(toolbar, /The device used now follows steps, reports, and the test session summary/);
assert.match(options, /El dispositivo utilizado ahora acompaña los pasos, informes y el resumen de la sesión/);
assert.match(toolbar, /openReleaseNotes/);
assert.match(toolbar, /lastSeenReleaseVersion/);
assert.match(options, /showPendingReleaseNotes/);
assert.match(storage, /schemaVersion:\s*17/);
assert.match(storage, /source\.schemaVersion[^\n]*< 11/);
assert.match(storage, /source\.schemaVersion[^\n]*< 13/);
console.log(`Update experience checks passed for v${manifest.version}.`);
