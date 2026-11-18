// Usage profiles must only reference real tools and never pin a tool the menu hides.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const dom = new JSDOM("", { runScripts: "outside-only" });
dom.window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } }, runtime: { getManifest: () => ({ version: "0" }) } };
dom.window.eval(await readFile(new URL("../apps/extension/src/lib/storage-content.js", import.meta.url), "utf8"));
const storage = dom.window.QTS_STORAGE;
const known = new Set(storage.DEFAULT_ENABLED_TOOLS);
for (const id of ["automation", "manual", "explorer"]) {
  const profile = storage.usageProfilePreferences(id);
  assert.ok(profile.enabledTools.length > 0, `${id} enables tools`);
  assert.ok(profile.enabledTools.every((key) => known.has(key)), `${id} only enables real tools`);
  assert.ok(profile.pinnedTools.every((key) => profile.enabledTools.includes(key)), `${id} pins only enabled tools`);
  const raw = storage.USAGE_PROFILES[id];
  assert.equal(profile.enabledTools.length, raw.enabled.length, `${id} lists no unknown tool key`);
}
assert.equal(storage.usageProfilePreferences("explorer").enabledTools.length, known.size, "explorer shows everything");
assert.equal(storage.usageProfilePreferences("nope"), null);
console.log("usage profiles ok");