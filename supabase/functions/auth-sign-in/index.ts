import { z } from "npm:zod@4.4.3";
import { enforceRateLimit, publicClient } from "../_shared/auth.ts";
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
  await enforceRateLimit(email, "auth-sign-in", 10, 900);
  const { data, error } = await publicClient().auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.session || !data.user) throw new ApiError(401, "authentication_failed");
  return jsonResponse(request, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: { id: data.user.id, email: data.user.email },
  });
});
