import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "npm:zod@4.4.3";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { requiredEnv } from "../_shared/config.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const schema = z.object({ confirmation: z.literal("BOOTSTRAP_FOUNDER") }).strict();

function matchesSecret(received: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(received).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "bootstrap-founder", 3, 86_400);
  const providedSecret = request.headers.get("x-founder-bootstrap-secret") ?? "";
  if (!matchesSecret(providedSecret, requiredEnv("FOUNDER_BOOTSTRAP_SECRET"))) {
    throw new ApiError(403, "bootstrap_denied");
  }
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_confirmation");
  const { error } = await adminClient().rpc("bootstrap_founder", { target_user_id: user.id });
  if (error) throw new ApiError(409, "bootstrap_unavailable");
  return jsonResponse(request, { bootstrapped: true });
});
