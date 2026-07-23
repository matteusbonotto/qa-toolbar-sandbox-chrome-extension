import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
execFileSync(process.execPath, ["scripts/package-extension-test.mjs"], { cwd: root, stdio: "pipe" });

const productionManifest = JSON.parse(await readFile(resolve(root, "apps/extension/manifest.json"), "utf8"));
const testManifest = JSON.parse(await readFile(resolve(root, "artifacts/extension-test/manifest.json"), "utf8"));
const testAuth = await readFile(resolve(root, "artifacts/extension-test/src/background/auth.js"), "utf8");
const workflow = await readFile(resolve(root, ".github/workflows/chrome-store-package.yml"), "utf8");

assert.equal(productionManifest.name, "QA Toolbar Sandbox");
assert.equal(productionManifest.key, undefined);
assert.match(testManifest.name, /\[TESTE\]/);
assert.equal(testManifest.version, productionManifest.version);
assert.equal(testManifest.version_name, `${productionManifest.version}-teste`);
assert.ok(testManifest.key);
assert.match(testAuth, /http:\/\/127\.0\.0\.1:54321\/functions\/v1/);
assert.doesNotMatch(testAuth, /xhusvkylbouwtpcevgri\.supabase\.co/);
assert.match(workflow, /confirm_production == 'PUBLICAR PRODUCAO'/);
assert.doesNotMatch(workflow, /github\.event_name == 'push'\s*\|\|/);

console.log("Test/production release isolation checks passed.");
