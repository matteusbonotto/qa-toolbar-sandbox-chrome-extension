import { z } from "npm:zod@4.4.3";
import { adminClient, clientRateSubject, enforceRateLimit, publicClient } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
}).strict();

serve(async (request) => {
  requirePost(request);
  const parsed = schema.safeParse(await readJson(request, 8_192));
  if (!parsed.success) throw new ApiError(400, "invalid_credentials");
  const email = parsed.data.email.toLowerCase();
  // Per e-mail alone let anyone lock a victim out with 10 wrong passwords, and per IP nothing
  // stopped spraying one password over many e-mails (security audit 2026-10-22). Now: the tight
  // limit is per (e-mail, client), a per-client cap stops spraying, and a looser per-e-mail cap
  // still stops a distributed brute force against one account.
  const client = await clientRateSubject(request);
  await enforceRateLimit(`${client}:${email}`, "auth-sign-in", 10, 900);
  await enforceRateLimit(client, "auth-sign-in-client", 30, 900);
  await enforceRateLimit(email, "auth-sign-in-account", 50, 3_600);
  const { data, error } = await publicClient().auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.session || !data.user) throw new ApiError(401, "authentication_failed");
  const { error: trialError } = await adminClient().rpc("activate_free_trial", { target_user_id: data.user.id });
  if (trialError && !["active_entitlement_exists", "free_trial_unavailable"].some((code) => trialError.message.includes(code))) {
    console.error("auth-sign-in: free trial activation failed", trialError.message);
  }
  return jsonResponse(request, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: { id: data.user.id, email: data.user.email },
  });
});
