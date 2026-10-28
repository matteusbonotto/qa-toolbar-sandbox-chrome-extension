import { describe, expect, it } from "vitest";
import { emailDomainsColumn, emailDomainsError, formatEmailDomains, MAX_EMAIL_DOMAINS, parseEmailDomains } from "./emailDomains";

describe("parseEmailDomains", () => {
  it("returns null for an empty field (any e-mail may redeem)", () => {
    expect(parseEmailDomains("")).toEqual({ domains: null, invalid: [] });
    expect(parseEmailDomains("  ,  ")).toEqual({ domains: null, invalid: [] });
  });

  it("normalizes case, a leading @, separators and duplicates", () => {
    expect(parseEmailDomains(" @MBLabs.com.br, bankeiro.com.br;mblabs.com.br\nexample.io ").domains)
      .toEqual(["mblabs.com.br", "bankeiro.com.br", "example.io"]);
  });

  it("flags values the database CHECK constraint would reject", () => {
    for (const bad of ["mblabs", "*.mblabs.com.br", "-mblabs.com.br", "mblabs..com.br", "mblabs.com.br.", "user@mblabs.com.br"]) {
      const parsed = parseEmailDomains(bad);
      expect(parsed.invalid, bad).toHaveLength(1);
      expect(emailDomainsError(parsed), bad).toContain("inválido");
    }
  });

  it("limits the list size like the database", () => {
    const many = Array.from({ length: MAX_EMAIL_DOMAINS + 1 }, (_, i) => `d${i}.com`).join(",");
    expect(emailDomainsError(parseEmailDomains(many))).toContain(String(MAX_EMAIL_DOMAINS));
    expect(emailDomainsError(parseEmailDomains("mblabs.com.br"))).toBeNull();
  });
});

describe("display helpers", () => {
  it("formats for the edit field and for the list column", () => {
    expect(formatEmailDomains(["mblabs.com.br", "bankeiro.com.br"])).toBe("mblabs.com.br, bankeiro.com.br");
    expect(formatEmailDomains(null)).toBe("");
    expect(emailDomainsColumn(["mblabs.com.br"])).toBe("@mblabs.com.br");
    expect(emailDomainsColumn(null)).toBe("Qualquer e-mail");
    expect(emailDomainsColumn([])).toBe("Qualquer e-mail");
  });
});
