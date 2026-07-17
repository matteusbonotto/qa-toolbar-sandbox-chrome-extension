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

assert.equal(workspace.schemaVersion, 3);
assert.equal(workspace.environments[0].projectId, "project-a");
assert.equal(workspace.environments[0].clientId, "client-a");
assert.deepEqual(workspace.environments[0].urlPatterns, ["https://qa.example.com/*"]);
assert.equal(workspace.preferences.compactMode, true);
assert.equal(workspace.preferences.enabledTools.includes("paymentMethods"), true);
assert.equal(workspace.preferences.enabledTools.includes("macroStudio"), true);

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

const filteredTools = normalizeWorkspace({ schemaVersion: 3, preferences: { enabledTools: ["inspectors", "unknown-tool"] } });
assert.deepEqual(filteredTools.preferences.enabledTools, ["inspectors"]);

const upgradedTools = normalizeWorkspace({ schemaVersion: 2, preferences: { enabledTools: ["inspectors"] } });
assert.deepEqual(upgradedTools.preferences.enabledTools, ["inspectors", "characterCounter", "macroStudio", "multiClick", "inputLab", "fakerFill"]);

const orphaned = normalizeWorkspace({ clients: [], projects: [], products: [], environments: [{ id: "bad", productId: "missing", name: "Bad", url: "https://bad.example.com" }] });
assert.equal(orphaned.environments.length, 0);

console.log("Extension workspace normalization tests passed.");
