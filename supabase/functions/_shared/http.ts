const securityHeaders = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function csvEnv(name: string): string[] {
  return (Deno.env.get(name) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (csvEnv("ALLOWED_ORIGINS").includes(origin)) return origin;
  if (origin.startsWith("chrome-extension://")) {
    const extensionId = origin.slice("chrome-extension://".length);
    if (/^[a-p]{32}$/.test(extensionId) && csvEnv("ALLOWED_EXTENSION_IDS").includes(extensionId)) return origin;
  }
  return null;
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = allowedOrigin(request.headers.get("origin"));
  return {
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    "access-control-allow-headers": "apikey, authorization, content-type, x-client-info, x-correlation-id, x-admin-mfa-token",
    "access-control-allow-methods": "POST, OPTIONS",
    ...securityHeaders,
  };
}

export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigin(origin)) return new Response(null, { status: 403, headers: securityHeaders });
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8" },
  });
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

export async function readJson(request: Request, maximumBytes = 16_384): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "content_type_required");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new ApiError(413, "payload_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new ApiError(413, "payload_too_large");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new ApiError(400, "invalid_json");
  }
}

export function requirePost(request: Request): void {
  if (request.method !== "POST") throw new ApiError(405, "method_not_allowed");
}
