import {
  ADMIN_EMAIL,
  authenticationMethodTimestamp,
  isRecentAuthentication,
  OTP_CHALLENGE_MINUTES,
  RECENT_PASSWORD_SECONDS,
  secureAdminToken,
  sha256Hex,
} from "../_shared/admin_mfa.ts";
import { adminClient, authenticatedContext, enforceRateLimit } from "../_shared/auth.ts";
import { ApiError, jsonResponse, preflight, readJson, requirePost } from "../_shared/http.ts";

interface RequestBody {
  action?: unknown;
  challengeId?: unknown;
  mfaToken?: unknown;
  otp?: unknown;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

function publicKey(): string {
  return Deno.env.get("SUPABASE_ANON_KEY")?.trim()
    || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim()
    || Deno.env.get("APP_SUPABASE_PUBLIC_KEY")?.trim()
    || requiredEnv("SUPABASE_PUBLISHABLE_KEY");
}

function asUuid(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new ApiError(400, "invalid_challenge");
  }
  return text;
}

async function requireFounder(userId: string): Promise<void> {
  const { data, error } = await adminClient()
    .from("user_roles")
    .select("roles!inner(key)")
    .eq("user_id", userId)
    .eq("roles.key", "founder")
    .maybeSingle();
  if (error) throw new Error("Founder authorization lookup failed");
  if (!data) throw new ApiError(403, "admin_access_denied");
}

async function requestOtp(request: Request) {
  const { user, claims } = await authenticatedContext(request);
  const email = user.email?.trim().toLowerCase();
  const passwordAt = authenticationMethodTimestamp(claims, "password");
  if (email !== ADMIN_EMAIL || !user.email_confirmed_at) throw new ApiError(403, "admin_access_denied");
  if (!isRecentAuthentication(passwordAt, RECENT_PASSWORD_SECONDS)) {
    throw new ApiError(401, "recent_password_required");
  }
  await requireFounder(user.id);
  await enforceRateLimit(user.id, "admin-email-otp", 3, 15 * 60);

  const admin = adminClient();
  await admin.from("admin_otp_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("consumed_at", null);

  const passwordAuthenticatedAt = new Date(passwordAt! * 1000).toISOString();
  const expiresAt = new Date(Date.now() + OTP_CHALLENGE_MINUTES * 60_000).toISOString();
  const { data: challenge, error: challengeError } = await admin.from("admin_otp_challenges").insert({
    user_id: user.id,
    email,
    password_authenticated_at: passwordAuthenticatedAt,
    expires_at: expiresAt,
  }).select("id").single();
  if (challengeError || !challenge) throw new Error("OTP challenge creation failed");

  const emailResponse = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/reauthenticate`, {
    method: "GET",
    headers: {
      apikey: publicKey(),
      authorization: request.headers.get("authorization") ?? "",
    },
  });
  if (!emailResponse.ok) {
    await admin.from("admin_otp_challenges").delete().eq("id", challenge.id);
    // Surface Supabase's own native-email rate limit distinctly — it's a real, temporary,
    // self-resolving condition (the built-in email sender has a low per-hour cap), not a
    // system failure. Everything else stays a generic delivery failure.
    const emailErrorBody = await emailResponse.json().catch(() => null) as { error_code?: string } | null;
    if (emailResponse.status === 429 || emailErrorBody?.error_code === "over_email_send_rate_limit") {
      throw new ApiError(429, "otp_email_rate_limited");
    }
    throw new ApiError(503, "otp_delivery_failed");
  }

  await admin.from("audit_logs").insert({
    actor_id: user.id,
    action: "admin.otp_requested",
    target_type: "admin_otp_challenges",
    target_id: challenge.id,
    reason: "recent password session requested email OTP",
  });
  return { challengeId: challenge.id, expiresAt };
}

async function verifyOtp(request: Request, body: RequestBody) {
  const { user, claims } = await authenticatedContext(request);
  const email = user.email?.trim().toLowerCase();
  const passwordAt = authenticationMethodTimestamp(claims, "password");
  if (email !== ADMIN_EMAIL || !user.email_confirmed_at || passwordAt === null) {
    throw new ApiError(403, "otp_verification_required");
  }
  await requireFounder(user.id);
  const challengeId = asUuid(body.challengeId);
  const otp = typeof body.otp === "string"
    ? body.otp.trim()
    : "";
  if (!/^\d{8}$/.test(otp)) throw new ApiError(400, "invalid_otp");
  const mfaToken = secureAdminToken();
  const { data: expiresAt, error } = await adminClient().rpc("verify_admin_reauthentication_otp", {
    user_id_input: user.id,
    challenge_id_input: challengeId,
    nonce_input: otp,
    token_hash_input: sha256Hex(mfaToken),
  });
  if (error || typeof expiresAt !== "string") throw new ApiError(401, "invalid_or_expired_otp");
  return { mfaToken, expiresAt };
}

async function revokeMfa(request: Request, body: RequestBody) {
  const { user } = await authenticatedContext(request);
  const mfaToken = typeof body.mfaToken === "string" ? body.mfaToken.trim() : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(mfaToken)) return { revoked: true };
  const now = new Date().toISOString();
  await adminClient().from("admin_mfa_sessions")
    .update({ revoked_at: now })
    .eq("user_id", user.id)
    .eq("token_hash", sha256Hex(mfaToken))
    .is("revoked_at", null);
  return { revoked: true };
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    requirePost(request);
    const body = await readJson(request, 2_048) as RequestBody;
    if (body.action === "request") return jsonResponse(request, await requestOtp(request));
    if (body.action === "verify") return jsonResponse(request, await verifyOtp(request, body));
    if (body.action === "revoke") return jsonResponse(request, await revokeMfa(request, body));
    throw new ApiError(400, "invalid_action");
  } catch (error) {
    if (error instanceof ApiError) return jsonResponse(request, { error: error.code }, error.status);
    console.error("admin-email-otp failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(request, { error: "internal_error" }, 500);
  }
});
