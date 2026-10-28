import { describe, expect, it } from "vitest";
import { emailDomainAllowed, formatAllowedDomains, normalizeAllowedDomains } from "./voucherDomains";

describe("voucher domain restriction", () => {
  it("normalizes the backend list", () => {
    expect(normalizeAllowedDomains(["@MBLabs.com.br", " mblabs.com.br ", "", 42, "exemplo.com"])).toEqual(["mblabs.com.br", "exemplo.com"]);
    expect(normalizeAllowedDomains(null)).toBeNull();
    expect(normalizeAllowedDomains(undefined)).toBeNull();
    expect(normalizeAllowedDomains([])).toBeNull();
    expect(normalizeAllowedDomains(["not a domain"])).toBeNull();
  });

  it("matches the e-mail domain exactly and case-insensitively", () => {
    const domains = ["mblabs.com.br"];
    expect(emailDomainAllowed("Fulano@MBLabs.com.br", domains)).toBe(true);
    expect(emailDomainAllowed("fulano@gmail.com", domains)).toBe(false);
    expect(emailDomainAllowed("fulano@sub.mblabs.com.br", domains)).toBe(false);
    expect(emailDomainAllowed("fulano@mblabs.com.br.evil.com", domains)).toBe(false);
    expect(emailDomainAllowed(null, domains)).toBe(false);
  });

  it("allows any e-mail when the voucher has no restriction", () => {
    expect(emailDomainAllowed("fulano@gmail.com", null)).toBe(true);
    expect(emailDomainAllowed(null, [])).toBe(true);
  });

  it("formats every domain for display", () => {
    expect(formatAllowedDomains(["mblabs.com.br", "exemplo.com"])).toBe("@mblabs.com.br, @exemplo.com");
  });
});
