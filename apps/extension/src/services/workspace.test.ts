import { describe, expect, it } from "vitest";
import { hostPermission, hostnameMatches, normalizeHostnames } from "./workspace";

describe("workspace domain normalization", () => {
  it("accepts complete URLs and stores only unique hostnames", () => {
    expect(normalizeHostnames("https://Google.com.br/search, staging.example.test/path;invalid url")).toEqual([
      "google.com.br",
      "staging.example.test",
    ]);
  });

  it("matches subdomains and generates a wildcard host permission", () => {
    expect(hostnameMatches("www.google.com.br", ["google.com.br"])).toBe(true);
    expect(hostPermission("google.com.br")).toBe("*://*.google.com.br/*");
  });
});
