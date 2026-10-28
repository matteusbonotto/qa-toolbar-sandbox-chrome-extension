// "Domínios de e-mail permitidos" of a voucher or campaign (allowed_email_domains). NULL in the
// database means any e-mail may redeem; a list means only a CONFIRMED e-mail whose domain is
// exactly one of them (no implicit subdomains). The rule is enforced by redeem_voucher /
// reserve_voucher_discount in Postgres (migration 20261028120000); this file only turns the Admin
// text field into the shape the column's CHECK constraint accepts, so the founder gets a readable
// error instead of a raw constraint violation.

// Same pattern as public.is_valid_email_domain_list(): lowercase labels of [a-z0-9-] (no leading or
// trailing "-"), at least one dot.
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const MAX_EMAIL_DOMAINS = 20;

export interface ParsedEmailDomains {
  domains: string[] | null;
  invalid: string[];
}

// Accepts "mblabs.com.br, @Bankeiro.com.br" (comma, semicolon, space or line break separated, an
// optional leading "@", any case) and returns ["mblabs.com.br", "bankeiro.com.br"]. Empty input
// returns null (no restriction).
export function parseEmailDomains(raw: string): ParsedEmailDomains {
  const items = raw
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const item of items) {
    if (item.length > 253 || !DOMAIN_PATTERN.test(item)) invalid.push(item);
    else if (!domains.includes(item)) domains.push(item);
  }
  return { domains: domains.length ? domains : null, invalid };
}

export function emailDomainsError(parsed: ParsedEmailDomains): string | null {
  if (parsed.invalid.length) {
    return `Domínio de e-mail inválido: ${parsed.invalid.join(", ")}. Use só o domínio, sem "@" (ex.: mblabs.com.br).`;
  }
  if ((parsed.domains?.length ?? 0) > MAX_EMAIL_DOMAINS) return `Use no máximo ${MAX_EMAIL_DOMAINS} domínios de e-mail.`;
  return null;
}

export function formatEmailDomains(domains: string[] | null | undefined): string {
  return domains?.length ? domains.join(", ") : "";
}

export function emailDomainsColumn(domains: string[] | null | undefined): string {
  return domains?.length ? domains.map((domain) => `@${domain}`).join(", ") : "Qualquer e-mail";
}
