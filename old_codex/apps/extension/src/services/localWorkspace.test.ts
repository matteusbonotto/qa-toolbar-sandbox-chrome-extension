import { describe, expect, it } from "vitest";
import { applyImport, emptyWorkspace, exportWorkspace, previewImport, replaceWorkspaceEntity, resetWorkspace } from "./localWorkspace";

describe("versioned local workspace", () => {
  it("exports safely with a verifiable checksum", async () => {
    const workspace = emptyWorkspace();
    workspace.accounts.push({ id: crypto.randomUUID(), name: "QA", shortName: "QA", description: "", image: "", images: [], color: "#64748b", tags: [], active: true, order: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), typeId: null, email: "qa@example.test", username: "", password: "secret", inboxUrl: "", environmentIds: [], attributes: {}, sensitive: true });
    const exported = await exportWorkspace(workspace);
    expect(JSON.stringify(exported.data)).not.toContain("secret");
    await expect(previewImport(exported)).resolves.toMatchObject({ checksumValid: true });
  });

  it("edits every entity field through the collection schema and preserves the immutable id", () => {
    const workspace = emptyWorkspace();
    const id = crypto.randomUUID();
    workspace.apis.push({ id, name: "API", shortName: "API", description: "", image: "", images: [], color: "#64748b", tags: [], active: true, order: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), baseUrl: "https://api.example.test", environmentIds: [], endpoint: "/", method: "GET", headers: {}, contentType: "application/json", timeoutMs: 15000, schema: {}, redactionKeys: [] });
    const edited = replaceWorkspaceEntity(workspace, "apis", id, { ...workspace.apis[0], id: crypto.randomUUID(), baseUrl: "https://sandbox.example.test", headers: { "x-client": "qa" } });
    expect(edited.apis[0]).toMatchObject({ id, baseUrl: "https://sandbox.example.test", headers: { "x-client": "qa" } });
    expect(() => replaceWorkspaceEntity(workspace, "apis", id, { ...workspace.apis[0], baseUrl: "javascript:alert(1)" })).toThrow();
  });

  it("merges by id, supports rollback and scoped reset", () => {
    const current = emptyWorkspace();
    const incoming = emptyWorkspace();
    const result = applyImport(current, incoming, "merge");
    expect(result.rollback).toEqual(current);
    expect(resetWorkspace({ ...current, activeProjectId: crypto.randomUUID() }, "project").activeProjectId).toBeNull();
    expect(resetWorkspace(current, "all")).toEqual(emptyWorkspace());
  });
});
