import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "./localWorkspace";
import { resolveToolbarContext } from "./toolbarContext";

describe("toolbar workspace context", () => {
  it("resolves client, project, product and environment from the current URL without company hardcodes", () => {
    const workspace = emptyWorkspace();
    const now = new Date().toISOString();
    const clientId = crypto.randomUUID(), projectId = crypto.randomUUID(), productId = crypto.randomUUID(), environmentId = crypto.randomUUID();
    const base = { description: "", image: "", images: [], color: "#64748b", tags: [], active: true, order: 0, createdAt: now, updatedAt: now };
    workspace.activeProjectId = projectId;
    workspace.clients.push({ ...base, id: clientId, name: "Cliente Exemplo", shortName: "Cliente", notes: "" });
    workspace.projects.push({ ...base, id: projectId, clientId, name: "Portal", shortName: "WEB", productIds: [productId] });
    workspace.products.push({ ...base, id: productId, clientId, name: "Argentina", shortName: "AR", projectIds: [projectId], code: "AR", kind: "country" });
    workspace.environments.push({ ...base, id: environmentId, projectId, name: "Qualidade", shortName: "QA", color: "#facc15", riskLevel: "medium", urlPatterns: ["https://qa.example.test/*"] });
    expect(resolveToolbarContext(workspace, "https://qa.example.test/checkout")).toMatchObject({ clientName: "Cliente", projectName: "WEB", productName: "AR", environmentName: "QA", environmentColor: "#facc15" });
    expect(resolveToolbarContext(workspace, "https://prod.example.test/")).toBeNull();
  });
});
