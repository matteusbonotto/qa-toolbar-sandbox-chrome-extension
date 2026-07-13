import { describe, expect, it } from "vitest";
import { matchEnvironment, redactValue, workspaceImportSchema, type Environment } from ".";

const qaEnvironment: Environment = {
  id: "d5c9b84c-0564-4fc8-87ad-12409180403b",
  name: "QA",
  color: "#7c5cff",
  riskLevel: "medium",
  urlPatterns: ["qa.example.test"],
};

describe("redactValue", () => {
  it("masks nested secrets without changing ordinary fields", () => {
    expect(redactValue({ email: "qa@example.test", authorization: "Bearer secret", nested: { apiKey: "123" } })).toEqual({
      email: "qa@example.test",
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]" },
    });
  });
});

describe("matchEnvironment", () => {
  it("matches an exact hostname", () => {
    expect(matchEnvironment("https://qa.example.test/checkout", [qaEnvironment]).environment?.name).toBe("QA");
  });

  it("rejects invalid regular expressions", () => {
    expect(matchEnvironment("https://example.test", [{ ...qaEnvironment, urlPatterns: ["regex:(a+)+$"] }]).environment).toBeNull();
  });
});

describe("workspaceImportSchema", () => {
  it("accepts a versioned workspace and rejects an unknown active project", () => {
    const project = { id: "60c2cd97-b1c8-44d2-bef2-37d4109500e1", name: "Demo", accentColor: "#7c5cff", environments: [qaEnvironment] };
    const base = { kind: "qts-workspace", version: 1, activeProjectId: project.id, setup: { projectName: "Demo", domain: "example.test", domains: ["example.test"], environmentName: "QA" }, projects: [project] };
    expect(workspaceImportSchema.safeParse(base).success).toBe(true);
    expect(workspaceImportSchema.safeParse({ ...base, activeProjectId: "fcd2b723-c351-473a-be9f-7abfb6c41432" }).success).toBe(false);
  });
});
