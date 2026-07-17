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

assert.equal(workspace.schemaVersion, 2);
assert.equal(workspace.environments[0].projectId, "project-a");
assert.equal(workspace.environments[0].clientId, "client-a");
assert.deepEqual(workspace.environments[0].urlPatterns, ["https://qa.example.com/*"]);
assert.equal(workspace.preferences.compactMode, true);
assert.equal(workspace.preferences.enabledTools.includes("paymentMethods"), true);

const filteredTools = normalizeWorkspace({ preferences: { enabledTools: ["inspectors", "unknown-tool"] } });
assert.deepEqual(filteredTools.preferences.enabledTools, ["inspectors"]);

const orphaned = normalizeWorkspace({ clients: [], projects: [], products: [], environments: [{ id: "bad", productId: "missing", name: "Bad", url: "https://bad.example.com" }] });
assert.equal(orphaned.environments.length, 0);

console.log("Extension workspace normalization tests passed.");
