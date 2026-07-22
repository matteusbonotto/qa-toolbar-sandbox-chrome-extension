import assert from "node:assert/strict";
import { DEFAULT_ENABLED_TOOLS, normalizeUrlPatterns, normalizeWorkspace } from "../apps/extension/src/lib/storage.js";

assert.deepEqual(normalizeUrlPatterns("https://example.com"), ["https://example.com/*"]);
assert.deepEqual(normalizeUrlPatterns("example.com\nhttps://example.com/app"), ["*://example.com/*", "https://example.com/app*"]);

const workspace = normalizeWorkspace({
  clients: [{ id: "client-a", name: "Cliente" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Projeto" }],
  products: [{ id: "product-a", projectId: "project-a", name: "Produto" }],
  environments: [{ id: "env-a", productId: "product-a", name: "QA", url: "https://qa.example.com" }],
  preferences: { compactMode: true },
});

assert.equal(workspace.schemaVersion, 10);
assert.equal(workspace.environments[0].name, "QA");
assert.equal(workspace.environments[0].productId, undefined);
assert.equal(workspace.urlBindings.length, 1);
assert.equal(workspace.urlBindings[0].productId, "product-a");
assert.deepEqual(workspace.urlBindings[0].environmentIds, ["env-a"]);
assert.deepEqual(workspace.urlBindings[0].patterns, ["https://qa.example.com/*"]);
assert.equal(workspace.preferences.compactMode, true);
assert.deepEqual(workspace.preferences.compactEntities, { client: false, project: true, product: true });
assert.equal(workspace.preferences.enabledTools.includes("paymentMethods"), true);
assert.equal(workspace.preferences.enabledTools.includes("macroStudio"), true);
assert.equal(workspace.preferences.enabledTools.includes("keyView"), true);
assert.equal(workspace.preferences.enabledTools.includes("elementCapture"), true);
assert.equal(workspace.preferences.enabledTools.includes("blurElements"), true);
assert.equal(workspace.preferences.enabledTools.includes("holofote"), true);
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

const filteredTools = normalizeWorkspace({ schemaVersion: 10, preferences: { enabledTools: ["inspectors", "unknown-tool"] } });
assert.deepEqual(filteredTools.preferences.enabledTools, ["inspectors"]);

const upgradedTools = normalizeWorkspace({ schemaVersion: 2, preferences: { enabledTools: ["inspectors"] } });
assert.deepEqual(upgradedTools.preferences.enabledTools, ["inspectors", "characterCounter", "macroStudio", "multiClick", "inputLab", "fakerFill", "keyView", "errorMonitor", "elementCapture", "blurElements", "holofote"]);

const schemaThreeUpgrade = normalizeWorkspace({ schemaVersion: 3, preferences: { enabledTools: ["inspectors"], keyView: { enabled: true, typingMode: true, theme: "light", position: "middle-right", mouseEffects: false } } });
assert.deepEqual(schemaThreeUpgrade.preferences.enabledTools, ["inspectors", "keyView", "errorMonitor", "elementCapture", "blurElements", "holofote"]);
assert.deepEqual(schemaThreeUpgrade.preferences.keyView, { enabled: true, typingMode: true, theme: "light", position: "middle-right", mouseEffects: false, keySize: "medium", mouseSize: "medium" });
assert.equal(normalizeWorkspace({ schemaVersion: 4, preferences: { keyView: { position: "outside", theme: "pink" } } }).preferences.keyView.position, "bottom-center");
assert.deepEqual(normalizeWorkspace({ preferences: { keyView: { keySize: "large", mouseSize: "small" } } }).preferences.keyView, { enabled: false, typingMode: false, theme: "dark", position: "bottom-center", mouseEffects: true, keySize: "large", mouseSize: "small" });
assert.deepEqual(normalizeWorkspace({ preferences: { keyView: { keySize: "huge", mouseSize: "tiny" } } }).preferences.keyView, { enabled: false, typingMode: false, theme: "dark", position: "bottom-center", mouseEffects: true, keySize: "medium", mouseSize: "medium" });
assert.deepEqual(normalizeWorkspace({ preferences: { compactMode: true, compactEntities: { client: true, project: false, product: true } } }).preferences.compactEntities, { client: true, project: false, product: true });

// breadcrumbOrder: default is client-first; a custom order is preserved verbatim; malformed/
// partial/duplicate input still yields all 3 keys exactly once (never drops a breadcrumb segment).
assert.deepEqual(normalizeWorkspace({}).preferences.breadcrumbOrder, ["client", "project", "product"]);
assert.deepEqual(normalizeWorkspace({ preferences: { breadcrumbOrder: ["product", "client", "project"] } }).preferences.breadcrumbOrder, ["product", "client", "project"]);
assert.deepEqual(normalizeWorkspace({ preferences: { breadcrumbOrder: ["product", "product", "bogus"] } }).preferences.breadcrumbOrder, ["product", "client", "project"]);
assert.deepEqual(normalizeWorkspace({ preferences: { breadcrumbOrder: "not-an-array" } }).preferences.breadcrumbOrder, ["client", "project", "product"]);

// toolsMenuOrder: same idea, but against the full DEFAULT_ENABLED_TOOLS list — a custom order
// with one tool moved to the front is preserved verbatim, and unknown/missing entries never drop
// or duplicate a real tool.
assert.deepEqual(normalizeWorkspace({}).preferences.toolsMenuOrder, DEFAULT_ENABLED_TOOLS);
const reordered = ["elementCapture", ...DEFAULT_ENABLED_TOOLS.filter((tool) => tool !== "elementCapture")];
assert.deepEqual(normalizeWorkspace({ preferences: { toolsMenuOrder: reordered } }).preferences.toolsMenuOrder, reordered);
assert.deepEqual(normalizeWorkspace({ preferences: { toolsMenuOrder: ["bogus-tool", "keyView", "keyView"] } }).preferences.toolsMenuOrder[0], "keyView");
assert.equal(normalizeWorkspace({ preferences: { toolsMenuOrder: ["bogus-tool", "keyView", "keyView"] } }).preferences.toolsMenuOrder.length, DEFAULT_ENABLED_TOOLS.length);

// Environments no longer depend on a product at all (see normalizeUrlBindings in storage.js —
// the fix for "DEV AR"/"DEV BO" duplication moves the product association onto the binding), so
// an environment with no product/URL relationship yet still survives; only a binding referencing
// a missing product gets dropped.
const orphaned = normalizeWorkspace({ clients: [], projects: [], products: [], environments: [{ id: "bad", name: "Bad" }], urlBindings: [{ patterns: ["https://bad.example.com"], productId: "missing", environmentIds: ["bad"] }] });
assert.equal(orphaned.environments.length, 1);
assert.equal(orphaned.urlBindings.length, 0);

// The reported bug: importing 4 tiers × 2 countries used to require 8 separate environments
// (one per product) because Environment.productId was single. Confirm the new shape lets ONE
// environment relate to N products via N bindings, with each URL resolving to the right product.
const multiCountry = normalizeWorkspace({
  clients: [{ id: "client-a", name: "Cineluna" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Cinemas" }],
  products: [
    { id: "product-ar", projectId: "project-a", name: "AR" },
    { id: "product-bo", projectId: "project-a", name: "BO" },
  ],
  environments: [{ id: "env-dev", name: "DEV" }],
  urlBindings: [
    { patterns: ["https://ar-dev.cineluna.example"], productId: "product-ar", environmentIds: ["env-dev"] },
    { patterns: ["https://bo-dev.cineluna.example.bo"], productId: "product-bo", environmentIds: ["env-dev"] },
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
  clients: [{ id: "client-a", name: "Cineluna" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Cinemas" }],
  products: [
    { id: "product-ar", projectId: "project-a", name: "AR" },
    { id: "product-bo", projectId: "project-a", name: "BO" },
  ],
  environments: [
    { id: "env-dev-ar", productId: "product-ar", name: "DEV AR", urlPatterns: ["https://ar-dev.cineluna.example/*"], primaryUrl: "https://ar-dev.cineluna.example" },
    { id: "env-dev-bo", productId: "product-bo", name: "DEV BO", urlPatterns: ["https://bo-dev.cineluna.example.bo/*"] },
  ],
});
assert.equal(legacyMigration.environments.length, 2, "migration preserves whatever the legacy workspace already had, doesn't merge by name");
assert.equal(legacyMigration.urlBindings.length, 2);
const arBinding = legacyMigration.urlBindings.find((binding) => binding.productId === "product-ar");
assert.equal(arBinding.environmentIds[0], "env-dev-ar");
assert.equal(arBinding.primaryUrl, "https://ar-dev.cineluna.example", "single-pattern environment's primaryUrl carries over");
const boBinding = legacyMigration.urlBindings.find((binding) => binding.productId === "product-bo");
assert.equal(boBinding.primaryUrl, "", "no primaryUrl was set on the legacy BO environment");

// Re-normalizing an already-migrated (schemaVersion 7) workspace must be idempotent — no
// duplicate bindings from re-running the legacy migration pass.
const reNormalized = normalizeWorkspace(legacyMigration);
assert.equal(reNormalized.urlBindings.length, 2);

// Founder feedback: the "Adicionar URL" modal only ever handled one URL pattern per binding, so
// registering several domains for the same product+environments meant repeatedly re-opening the
// modal, and editing one only ever showed the last pattern saved. Bindings now hold a `patterns`
// array — both reading several at once and merging repeat submissions for the same
// product+environments (by key, see normalizeUrlBindings) must accumulate them, not overwrite.
const multiPattern = normalizeWorkspace({
  clients: [{ id: "client-a", name: "Cliente" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Projeto" }],
  products: [{ id: "product-a", projectId: "project-a", name: "WebApp" }],
  environments: [{ id: "env-dev", name: "DEV" }],
  urlBindings: [
    { patterns: ["https://ar-dev.example.com/*", "https://bo-dev.example.com/*"], productId: "product-a", environmentIds: ["env-dev"] },
    { patterns: ["https://cl-dev.example.com/*"], productId: "product-a", environmentIds: ["env-dev"] },
  ],
});
assert.equal(multiPattern.urlBindings.length, 1, "same product+environments merges into one binding, not sibling rows");
assert.deepEqual(multiPattern.urlBindings[0].patterns.sort(), ["https://ar-dev.example.com/*", "https://bo-dev.example.com/*", "https://cl-dev.example.com/*"].sort());

// Legacy migration also merges a multi-pattern environment into one binding with all patterns,
// not one binding row per pattern (the pre-fix shape).
const legacyMultiPattern = normalizeWorkspace({
  schemaVersion: 6,
  clients: [{ id: "client-a", name: "Cineluna" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Cinemas" }],
  products: [{ id: "product-ar", projectId: "project-a", name: "AR" }],
  environments: [{ id: "env-dev-ar", productId: "product-ar", name: "DEV AR", urlPatterns: ["https://ar-dev.cineluna.example/*", "https://ar-dev-alt.cineluna.example/*"] }],
});
assert.equal(legacyMultiPattern.urlBindings.length, 1, "a multi-pattern legacy environment migrates into one binding, not one row per pattern");
assert.deepEqual(legacyMultiPattern.urlBindings[0].patterns.sort(), ["https://ar-dev-alt.cineluna.example/*", "https://ar-dev.cineluna.example/*"].sort());

// Backward-compat: a still-singular legacy `pattern` field (pre-array shape) reads correctly too.
const legacySingularPattern = normalizeWorkspace({
  clients: [{ id: "client-a", name: "Cliente" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Projeto" }],
  products: [{ id: "product-a", projectId: "project-a", name: "Produto" }],
  environments: [{ id: "env-a", name: "QA" }],
  urlBindings: [{ pattern: "https://qa.example.com", productId: "product-a", environmentIds: ["env-a"] }],
});
assert.deepEqual(legacySingularPattern.urlBindings[0].patterns, ["https://qa.example.com/*"]);

// Test accounts/payment methods used to carry exactly one environmentId and one optional
// productId, so a credential valid in more than one environment/product had to be registered
// once per combination. They now hold environmentIds[]/productIds[] instead — a still-singular
// legacy environmentId/productId (any workspace saved before this change) must keep reading
// correctly, forever, the same way urlBindings' pattern/patterns dual-shape reader does above.
const scopeWorkspace = normalizeWorkspace({
  clients: [{ id: "client-a", name: "Cineluna" }],
  projects: [{ id: "project-a", clientId: "client-a", name: "Cinemas" }],
  products: [
    { id: "product-ar", projectId: "project-a", name: "AR" },
    { id: "product-bo", projectId: "project-a", name: "BO" },
  ],
  environments: [
    { id: "env-dev", name: "DEV" },
    { id: "env-qa", name: "QA" },
  ],
  testAccounts: [
    { id: "account-legacy", environmentId: "env-dev", productId: "product-ar", label: "Legado" },
    { id: "account-multi", environmentIds: ["env-dev", "env-qa"], productIds: ["product-ar", "product-bo"], label: "Multi" },
    { id: "account-orphan", environmentId: "missing-env", label: "Sem ambiente válido" },
  ],
  paymentMethods: [
    { id: "payment-legacy", environmentId: "env-dev", productId: "product-ar", label: "Legado" },
    { id: "payment-unscoped", label: "Todos os ambientes/produtos" },
  ],
});
const legacyAccount = scopeWorkspace.testAccounts.find((account) => account.id === "account-legacy");
assert.deepEqual(legacyAccount.environmentIds, ["env-dev"], "legacy singular environmentId reads into environmentIds[]");
assert.deepEqual(legacyAccount.productIds, ["product-ar"], "legacy singular productId reads into productIds[]");
const multiAccount = scopeWorkspace.testAccounts.find((account) => account.id === "account-multi");
assert.deepEqual(multiAccount.environmentIds.sort(), ["env-dev", "env-qa"]);
assert.deepEqual(multiAccount.productIds.sort(), ["product-ar", "product-bo"]);
assert.equal(scopeWorkspace.testAccounts.some((account) => account.id === "account-orphan"), false, "a test account with zero valid environments is dropped, since environmentIds is required");
const legacyPayment = scopeWorkspace.paymentMethods.find((method) => method.id === "payment-legacy");
assert.deepEqual(legacyPayment.environmentIds, ["env-dev"]);
assert.deepEqual(legacyPayment.productIds, ["product-ar"]);
const unscopedPayment = scopeWorkspace.paymentMethods.find((method) => method.id === "payment-unscoped");
assert.deepEqual(unscopedPayment.environmentIds, [], "empty environmentIds means \"all environments\" for payment methods, unlike test accounts");
assert.deepEqual(unscopedPayment.productIds, []);

console.log("Extension workspace normalization tests passed.");
