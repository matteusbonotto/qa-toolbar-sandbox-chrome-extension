import { describe, expect, it } from "vitest";
import { normalizeUrlPattern, normalizeUrlPatterns, permissionOrigins, urlMatchesAny, urlMatchesPattern } from "./workspace";

describe("workspace URL patterns", () => {
  it("accepts full URLs, bare hosts, paths and the all-sites shortcut", () => {
    expect(normalizeUrlPattern("https://Google.com/search/*")?.value).toBe("https://google.com/search/*");
    expect(normalizeUrlPattern("google.com")?.value).toBe("*://*.google.com/*");
    expect(normalizeUrlPattern("*")).toEqual({ value: "*", broad: true });
  });

  it("matches Tampermonkey-style wildcards", () => {
    expect(urlMatchesPattern("https://www.google.com.br/search?q=qa", "*://*.com.br/*")).toBe(true);
    expect(urlMatchesPattern("https://google.com.br/", "google.*")).toBe(true);
    expect(urlMatchesPattern("https://google.com/", "google.*")).toBe(true);
    expect(urlMatchesPattern("https://www.google.com/", "google.com")).toBe(true);
    expect(urlMatchesPattern("https://www.google.com/search?q=qa", "https://google.com/*")).toBe(true);
    expect(urlMatchesAny("https://example.net/path", ["google.*", "*"])).toBe(true);
  });

  it("requests a narrow permission when possible and all URLs for broad wildcards", () => {
    expect(permissionOrigins(normalizeUrlPatterns(["https://google.com/*"]))).toEqual(["https://*.google.com/*"]);
    expect(permissionOrigins(normalizeUrlPatterns(["google.*"]))).toEqual(["http://*/*", "https://*/*"]);
  });
});
