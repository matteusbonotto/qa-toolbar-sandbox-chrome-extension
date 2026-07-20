import assert from "node:assert/strict";
import { normalizeUrlPatterns, normalizeWorkspace } from "../apps/extension/src/lib/storage.js";

assert.deepEqual(normalizeUrlPatterns("https://example.com"), ["https://example.com/*"]);
assert.deepEqual(normalizeUrlPatterns("example.com\nhttps://example.com/app"), ["*://example.com/*", "https://example.com/app*"]);

const workspace = normalizeWorkspace({
  clients: [{ id: "client-a", name: "Cliente" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Projeto" }],
  products: [{ id: "product-a", projectId: "project-a", name: "Produto" }],
  environments: [{ id: "env-a", productId: "product-a", name: "QA", url: "https://qa.example.com" }],
  preferences: { compactMode: true },
});

assert.equal(workspace.schemaVersion, 7);
assert.equal(workspace.environments[0].name, "QA");
assert.equal(workspace.environments[0].productId, undefined);
assert.equal(workspace.urlBindings.length, 1);
assert.equal(workspace.urlBindings[0].productId, "product-a");
assert.deepEqual(workspace.urlBindings[0].environmentIds, ["env-a"]);
assert.equal(workspace.urlBindings[0].pattern, "https://qa.example.com/*");
assert.equal(workspace.preferences.compactMode, true);
assert.deepEqual(workspace.preferences.compactEntities, { client: false, project: true, product: true });
assert.equal(workspace.preferences.enabledTools.includes("paymentMethods"), true);
assert.equal(workspace.preferences.enabledTools.includes("macroStudio"), true);
assert.equal(workspace.preferences.enabledTools.includes("keyView"), true);
assert.equal(workspace.preferences.enabledTools.includes("elementCapture"), true);
assert.deepEqual(workspace.preferences.keyView, { enabled: false, typingMode: false, theme: "dark", position: "bottom-center", mouseEffects: true, keySize: "medium", mouseSize: "medium" });

const macroWorkspace = normalizeWorkspace({
  macros: [{
    id: "checkout",
    name: "Checkout feliz",
    steps: [
      { action: "click", selector: "#buy" },
      { action: "fill", selector: "#name", value: "Pessoa QA" },
      { action: "multiClick", selector: "#plus", count: 999, interval: 99999 },
      { action: "fill", selector: "#password", value: "must-not-survive" },
      { action: "javascript", value: "alert(1)" },
    ],
  }],
  preferences: { pinnedMacroIds: ["checkout"] },
});
assert.equal(macroWorkspace.macros.length, 1);
assert.equal(macroWorkspace.macros[0].steps.length, 3);
assert.equal(macroWorkspace.macros[0].steps[2].count, 100);
assert.equal(macroWorkspace.macros[0].steps[2].interval, 5_000);
assert.deepEqual(macroWorkspace.preferences.pinnedMacroIds, ["checkout"]);
assert.equal(JSON.stringify(macroWorkspace).includes("must-not-survive"), false);

const filteredTools = normalizeWorkspace({ schemaVersion: 7, preferences: { enabledTools: ["inspectors", "unknown-tool"] } });
assert.deepEqual(filteredTools.preferences.enabledTools, ["inspectors"]);

const upgradedTools = normalizeWorkspace({ schemaVersion: 2, preferences: { enabledTools: ["inspectors"] } });
assert.deepEqual(upgradedTools.preferences.enabledTools, ["inspectors", "characterCounter", "macroStudio", "multiClick", "inputLab", "fakerFill", "keyView", "errorMonitor", "elementCapture"]);

const schemaThreeUpgrade = normalizeWorkspace({ schemaVersion: 3, preferences: { enabledTools: ["inspectors"], keyView: { enabled: true, typingMode: true, theme: "light", position: "middle-right", mouseEffects: false } } });
assert.deepEqual(schemaThreeUpgrade.preferences.enabledTools, ["inspectors", "keyView", "errorMonitor", "elementCapture"]);
assert.deepEqual(schemaThreeUpgrade.preferences.keyView, { enabled: true, typingMode: true, theme: "light", position: "middle-right", mouseEffects: false, keySize: "medium", mouseSize: "medium" });
assert.equal(normalizeWorkspace({ schemaVersion: 4, preferences: { keyView: { position: "outside", theme: "pink" } } }).preferences.keyView.position, "bottom-center");
assert.deepEqual(normalizeWorkspace({ preferences: { keyView: { keySize: "large", mouseSize: "small" } } }).preferences.keyView, { enabled: false, typingMode: false, theme: "dark", position: "bottom-center", mouseEffects: true, keySize: "large", mouseSize: "small" });
assert.deepEqual(normalizeWorkspace({ preferences: { keyView: { keySize: "huge", mouseSize: "tiny" } } }).preferences.keyView, { enabled: false, typingMode: false, theme: "dark", position: "bottom-center", mouseEffects: true, keySize: "medium", mouseSize: "medium" });
assert.deepEqual(normalizeWorkspace({ preferences: { compactMode: true, compactEntities: { client: true, project: false, product: true } } }).preferences.compactEntities, { client: true, project: false, product: true });

// Environments no longer depend on a product at all (see normalizeUrlBindings in storage.js —
// the fix for "DEV AR"/"DEV BO" duplication moves the product association onto the binding), so
// an environment with no product/URL relationship yet still survives; only a binding referencing
// a missing product gets dropped.
const orphaned = normalizeWorkspace({ clients: [], projects: [], products: [], environments: [{ id: "bad", name: "Bad" }], urlBindings: [{ pattern: "https://bad.example.com", productId: "missing", environmentIds: ["bad"] }] });
assert.equal(orphaned.environments.length, 1);
assert.equal(orphaned.urlBindings.length, 0);

// The reported bug: importing 4 tiers × 2 countries used to require 8 separate environments
// (one per product) because Environment.productId was single. Confirm the new shape lets ONE
// environment relate to N products via N bindings, with each URL resolving to the right product.
const multiCountry = normalizeWorkspace({
  clients: [{ id: "client-a", name: "Cinemark" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Cinemas" }],
  products: [
    { id: "product-ar", projectId: "project-a", name: "AR" },
    { id: "product-bo", projectId: "project-a", name: "BO" },
  ],
  environments: [{ id: "env-dev", name: "DEV" }],
  urlBindings: [
    { pattern: "https://ar-dev.cinemark.com.ar", productId: "product-ar", environmentIds: ["env-dev"] },
    { pattern: "https://bo-dev.cinemark.com.bo", productId: "product-bo", environmentIds: ["env-dev"] },
  ],
});
assert.equal(multiCountry.environments.length, 1, "one reusable DEV environment, not one per country");
assert.equal(multiCountry.urlBindings.length, 2);
assert.deepEqual(multiCountry.urlBindings.map((binding) => binding.productId).sort(), ["product-ar", "product-bo"]);
assert.ok(multiCountry.urlBindings.every((binding) => binding.environmentIds.includes("env-dev")));

// Legacy schemaVersion 6 data (environment owned productId + urlPatterns directly) migrates into
// the new shape without merging genuinely-separate legacy environments (e.g. a workspace that had
// already split "DEV AR" and "DEV BO" into two distinct environment records before this fix keeps
// them distinct — this migration only changes storage shape, it doesn't guess which differently
// named/id'd environments were "meant" to be the same tier).
const legacyMigration = normalizeWorkspace({
  schemaVersion: 6,
  clients: [{ id: "client-a", name: "Cinemark" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Cinemas" }],
  products: [
    { id: "product-ar", projectId: "project-a", name: "AR" },
    { id: "product-bo", projectId: "project-a", name: "BO" },
  ],
  environments: [
    { id: "env-dev-ar", productId: "product-ar", name: "DEV AR", urlPatterns: ["https://ar-dev.cinemark.com.ar/*"], primaryUrl: "https://ar-dev.cinemark.com.ar" },
    { id: "env-dev-bo", productId: "product-bo", name: "DEV BO", urlPatterns: ["https://bo-dev.cinemark.com.bo/*"] },
  ],
});
assert.equal(legacyMigration.environments.length, 2, "migration preserves whatever the legacy workspace already had, doesn't merge by name");
assert.equal(legacyMigration.urlBindings.length, 2);
const arBinding = legacyMigration.urlBindings.find((binding) => binding.productId === "product-ar");
assert.equal(arBinding.environmentIds[0], "env-dev-ar");
assert.equal(arBinding.primaryUrl, "https://ar-dev.cinemark.com.ar", "single-pattern environment's primaryUrl carries over");
const boBinding = legacyMigration.urlBindings.find((binding) => binding.productId === "product-bo");
assert.equal(boBinding.primaryUrl, "", "no primaryUrl was set on the legacy BO environment");

// Re-normalizing an already-migrated (schemaVersion 7) workspace must be idempotent — no
// duplicate bindings from re-running the legacy migration pass.
const reNormalized = normalizeWorkspace(legacyMigration);
assert.equal(reNormalized.urlBindings.length, 2);

console.log("Extension workspace normalization tests passed.");
