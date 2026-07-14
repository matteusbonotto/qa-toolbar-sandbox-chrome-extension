import { describe, expect, it } from "vitest";
import { applyImport, emptyWorkspace, exportWorkspace, previewImport, resetWorkspace } from "./localWorkspace";

describe("versioned local workspace", () => {
  it("exports safely with a verifiable checksum", async () => {
    const workspace = emptyWorkspace();
    workspace.accounts.push({ id: crypto.randomUUID(), name: "QA", shortName: "QA", description: "", image: "", images: [], color: "#64748b", tags: [], active: true, order: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), typeId: null, email: "qa@example.test", username: "", password: "secret", inboxUrl: "", environmentIds: [], attributes: {}, sensitive: true });
    const exported = await exportWorkspace(workspace);
    expect(JSON.stringify(exported.data)).not.toContain("secret");
    await expect(previewImport(exported)).resolves.toMatchObject({ checksumValid: true });
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
