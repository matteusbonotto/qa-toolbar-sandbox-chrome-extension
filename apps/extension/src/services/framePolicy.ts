export type FramePolicyResult = { state: "allowed" | "blocked" | "unknown"; reason: string };

export function classifyFramePolicy(headers: Pick<Headers, "get">): FramePolicyResult {
  const xFrameOptions = headers.get("x-frame-options")?.trim().toLowerCase() ?? "";
  if (xFrameOptions === "deny") return { state: "blocked", reason: "O site enviou X-Frame-Options: DENY." };
  if (xFrameOptions.startsWith("sameorigin")) return { state: "blocked", reason: "O site permite iframe somente na própria origem." };
  const contentSecurityPolicy = headers.get("content-security-policy") ?? "";
  const frameAncestors = contentSecurityPolicy.match(/(?:^|;)\s*frame-ancestors\s+([^;]+)/i)?.[1]?.trim();
  if (frameAncestors === "'none'") return { state: "blocked", reason: "A política CSP do site proíbe qualquer incorporação." };
  if (frameAncestors && !frameAncestors.split(/\s+/).some((source) => source === "*" || source.startsWith("chrome-extension:"))) return { state: "blocked", reason: "A política CSP frame-ancestors não autoriza a extensão." };
  return { state: "allowed", reason: "Nenhum bloqueio de iframe foi declarado nos headers acessíveis." };
}

export async function probeFramePolicy(url: string, signal?: AbortSignal): Promise<FramePolicyResult> {
  try {
    const response = await fetch(url, { method: "HEAD", credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer", signal });
    return classifyFramePolicy(response.headers);
  } catch {
    return { state: "unknown", reason: "Os headers do site não puderam ser consultados. O preview será tentado sem remover proteções." };
  }
}
