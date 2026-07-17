import { createClient, type User } from "npm:@supabase/supabase-js@2.110.3";
import { createHash } from "node:crypto";
import { ApiError } from "./http.ts";

export interface AuthenticatedContext {
  user: User;
  token: string;
  claims: Record<string, unknown>;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

function supabaseUrl(): string {
  return requiredEnv("SUPABASE_URL");
}

function publicKey(): string {
  return Deno.env.get("SUPABASE_ANON_KEY")?.trim()
    || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim()
    || Deno.env.get("APP_SUPABASE_PUBLIC_KEY")?.trim()
    || requiredEnv("SUPABASE_PUBLISHABLE_KEY");
}

export function adminClient() {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    || Deno.env.get("SUPABASE_SECRET_KEY")?.trim()
    || Deno.env.get("APP_SUPABASE_SECRET_KEY")?.trim()
    || requiredEnv("SUPABASE_SECRET_KEY");
  return createClient(supabaseUrl(), secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function publicClient() {
  return createClient(supabaseUrl(), publicKey(), { auth: { autoRefreshToken: false, persistSession: false } });
}

function parseJwtClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new ApiError(401, "invalid_session");
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new Error("invalid claims");
    return claims as Record<string, unknown>;
  } catch {
    throw new ApiError(401, "invalid_session");
  }
}

export async function authenticatedContext(request: Request): Promise<AuthenticatedContext> {
  const token = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "authentication_required");
  const client = createClient(supabaseUrl(), publicKey(), { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "invalid_session");
  return { user: data.user, token, claims: parseJwtClaims(token) };
}

export async function authenticatedUser(request: Request): Promise<User> {
  return (await authenticatedContext(request)).user;
}

export async function enforceRateLimit(subject: string, action: string, maximum: number, windowSeconds: number): Promise<void> {
  const keyHash = createHash("sha256").update(`${action}:${subject}`).digest("hex");
  const { data, error } = await adminClient().rpc("consume_rate_limit", {
    request_key_hash: keyHash,
    maximum_requests: maximum,
    window_seconds: windowSeconds,
  });
  if (error) throw new Error("Rate limit service unavailable");
  if (!data) throw new ApiError(429, "rate_limit_exceeded");
}
