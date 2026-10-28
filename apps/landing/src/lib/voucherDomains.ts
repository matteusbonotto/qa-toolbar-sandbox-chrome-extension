// Domain-restricted vouchers (e.g. a campaign only for @mblabs.com.br). The backend is the source
// of truth and rejects a mismatched redemption with `voucher_domain_not_allowed`; this module only
// lets the page warn BEFORE the visitor clicks, so they can switch accounts first.

/** Normalizes the backend list: lowercase, no leading "@", no blanks or duplicates. Null means "any domain". */
export function normalizeAllowedDomains(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const domains = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase().replace(/^@+/, ""))
    .filter((item) => /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(item));
  const unique = [...new Set(domains)];
  return unique.length ? unique : null;
}

/** Exact, case-insensitive match on the part after "@". Subdomains are NOT treated as matching. */
export function emailDomainAllowed(email: string | null | undefined, allowedDomains: string[] | null | undefined): boolean {
  if (!allowedDomains?.length) return true;
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return allowedDomains.includes(domain);
}

/** "@a.com" / "@a.com, @b.com" for display. */
export function formatAllowedDomains(allowedDomains: string[]): string {
  return allowedDomains.map((domain) => `@${domain}`).join(", ");
}
