import { describe, expect, it } from "vitest";
import { matchEnvironment, redactValue, type Environment } from ".";

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
