export type UrlPattern = { value: string; broad: boolean };

const protocolPattern = /^(https?|\*):\/\//i;

export function normalizeUrlPattern(value: string): UrlPattern | null {
  let input = value.trim().toLowerCase();
  if (!input) return null;
  if (input === "*" || input === "<all_urls>") return { value: "*", broad: true };
  if (!protocolPattern.test(input)) {
    const slash = input.indexOf("/");
    const host = slash >= 0 ? input.slice(0, slash) : input;
    const path = slash >= 0 ? input.slice(slash) : "/*";
    const subdomainFriendlyHost = host.startsWith("*.") || host === "localhost" || host === "127.0.0.1" ? host : `*.${host}`;
    input = `*://${subdomainFriendlyHost}${path}`;
  }
  const separator = input.indexOf("://") + 3;
  let protocol = input.slice(0, separator - 3);
  let remainder = input.slice(separator);
  if (!remainder.includes("/")) remainder += "/*";
  const slash = remainder.indexOf("/");
  let host = remainder.slice(0, slash).replace(/\.$/, "");
  let path = remainder.slice(slash) || "/*";
  if (!host || /\s/.test(host) || !/^(localhost|127\.0\.0\.1|[a-z0-9*.-]+)$/i.test(host)) return null;
  if (!/^(https?|\*)$/.test(protocol)) return null;
  if (!path.startsWith("/")) path = `/${path}`;
  if (path === "/") path = "/*";
  const hostWithoutSubdomainWildcard = host.startsWith("*.") ? host.slice(2) : host;
  const broad = host === "*" || hostWithoutSubdomainWildcard.includes("*") || /^\*\.(com|net|org|com\.br|co\.)/i.test(host);
  return { value: `${protocol}://${host}${path}`, broad };
}

export function normalizeUrlPatterns(values: readonly string[]): UrlPattern[] {
  const normalized = values.map(normalizeUrlPattern).filter((item): item is UrlPattern => Boolean(item));
  return [...new Map(normalized.map((item) => [item.value, item])).values()];
}

export function urlMatchesPattern(url: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "<all_urls>") return /^https?:/i.test(url);
  const normalized = normalizeUrlPattern(pattern)?.value;
  if (!normalized) return false;
  const match = normalized.match(/^(https?|\*):\/\/([^/]+)(\/.*)$/i);
  if (!match) return false;
  try {
    const candidate = new URL(url);
    const [, protocol, hostPattern, pathPattern] = match;
    if (protocol !== "*" && candidate.protocol !== `${protocol}:`) return false;
    const hostGlob = (value: string) => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const baseHost = hostPattern!.startsWith("*.") ? hostPattern!.slice(2) : hostPattern!;
    const hostExpression = hostGlob(baseHost);
    const hostMatches = hostPattern!.startsWith("*.")
      ? new RegExp(`^(?:.*\\.)?${hostExpression}$`, "i").test(candidate.hostname)
      : hostPattern!.includes("*")
        ? new RegExp(`^${hostExpression}$`, "i").test(candidate.hostname)
        : new RegExp(`^(?:.*\\.)?${hostExpression}$`, "i").test(candidate.hostname);
    if (!hostMatches) return false;
    const pathExpression = pathPattern!.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pathExpression}$`, "i").test(`${candidate.pathname}${candidate.search}`);
  } catch { return false; }
}

export function urlMatchesAny(url: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => urlMatchesPattern(url, pattern));
}

export function permissionOrigins(patterns: readonly UrlPattern[]): string[] {
  if (patterns.some((item) => item.broad || item.value === "*")) return ["http://*/*", "https://*/*"];
  return [...new Set(patterns.map(({ value }) => {
    const match = value.match(/^(https?|\*):\/\/([^/]+)/i);
    if (!match) return null;
    const [, protocol, rawHost] = match;
    const host = rawHost!.startsWith("*.") ? rawHost! : `*.${rawHost}`;
    return `${protocol}://${host}/*`;
  }).filter((origin): origin is string => Boolean(origin)))];
}
