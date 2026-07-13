export function normalizeHostname(value: string): string | null {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    const hostname = url.hostname.replace(/\.$/, "");
    return /^(localhost|127\.0\.0\.1|(?:[a-z0-9-]+\.)*[a-z0-9-]+)$/i.test(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

export function normalizeHostnames(value: string): string[] {
  return [...new Set(value.split(/[,;\n]+/).map(normalizeHostname).filter((hostname): hostname is string => Boolean(hostname)))];
}

export function hostnameMatches(hostname: string, configured: readonly string[]): boolean {
  return configured.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function hostPermission(domain: string): string {
  return `*://*.${domain}/*`;
}
