import { createClient, type User } from "npm:@supabase/supabase-js@2.109.0";
import { createHash } from "node:crypto";
import { ApiError } from "./http.ts";
import { serverConfig } from "./config.ts";

export function adminClient() {
  const config = serverConfig();
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function publicClient() {
  const config = serverConfig();
  return createClient(config.supabaseUrl, config.supabasePublicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function authenticatedUser(request: Request): Promise<User> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "authentication_required");
  const config = serverConfig();
  const client = createClient(config.supabaseUrl, config.supabasePublicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "invalid_session");
  return data.user;
}

export function requireAal2(request: Request, maximumTokenAgeSeconds = 900): void {
  const token = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "authentication_required");
  try {
    const encodedPayload = token.split(".")[1];
    if (!encodedPayload) throw new Error("Missing payload");
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as { aal?: string; iat?: number };
    const age = Math.floor(Date.now() / 1000) - Number(payload.iat ?? 0);
    if (payload.aal !== "aal2" || age < 0 || age > maximumTokenAgeSeconds) throw new Error("Step-up required");
  } catch {
    throw new ApiError(403, "recent_mfa_required");
  }
}

export async function enforceRateLimit(subject: string, action: string, maximum: number, windowSeconds: number): Promise<void> {
  const digest = createHash("sha256").update(`${action}:${subject}`).digest("hex");
  const { data, error } = await adminClient().rpc("consume_rate_limit", {
    request_key_hash: digest,
    maximum_requests: maximum,
    window_seconds: windowSeconds,
  });
  if (error) throw new Error("Rate limit service unavailable");
  if (!data) throw new ApiError(429, "rate_limit_exceeded");
}
