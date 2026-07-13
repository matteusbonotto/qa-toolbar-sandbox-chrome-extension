import { z } from "npm:zod@4.4.3";
import { createHash } from "node:crypto";
import { enforceRateLimit, publicClient } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const schema = z.object({ refreshToken: z.string().min(20).max(4096) }).strict();

serve(async (request) => {
  requirePost(request);
  const parsed = schema.safeParse(await readJson(request, 8_192));
  if (!parsed.success) throw new ApiError(400, "invalid_request");
  const tokenHash = createHash("sha256").update(parsed.data.refreshToken).digest("hex");
  await enforceRateLimit(tokenHash, "auth-refresh", 30, 3600);
  const { data, error } = await publicClient().auth.refreshSession({ refresh_token: parsed.data.refreshToken });
  if (error || !data.session || !data.user) throw new ApiError(401, "refresh_failed");
  return jsonResponse(request, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: { id: data.user.id, email: data.user.email },
  });
});
