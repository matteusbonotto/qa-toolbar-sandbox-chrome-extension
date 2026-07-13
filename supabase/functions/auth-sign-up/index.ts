import { z } from "npm:zod@4.4.3";
import { adminClient, enforceRateLimit, publicClient } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
  acceptedTerms: z.literal(true),
  referralCode: z.string().trim().regex(/^QTS-[A-Z0-9]{8}$/).optional(),
}).strict();

serve(async (request) => {
  requirePost(request);
  const parsed = schema.safeParse(await readJson(request, 8_192));
  if (!parsed.success) throw new ApiError(400, "invalid_signup");
  const email = parsed.data.email.toLowerCase();
  await enforceRateLimit(email, "auth-sign-up", 4, 3600);
  const { data, error } = await publicClient().auth.signUp({
    email,
    password: parsed.data.password,
    options: { data: { terms_version: "2026-07-13", terms_accepted_at: new Date().toISOString() } },
  });
  if (error || !data.user) throw new ApiError(400, "signup_failed");
  const admin = adminClient();
  await admin.rpc("ensure_user_trial", { target_user_id: data.user.id });
  if (parsed.data.referralCode) await admin.rpc("register_referral", { target_user_id: data.user.id, referral_code: parsed.data.referralCode });
  if (!data.session) return jsonResponse(request, { confirmationRequired: true, email });
  return jsonResponse(request, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: { id: data.user.id, email: data.user.email },
  });
});
