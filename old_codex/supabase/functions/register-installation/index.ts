import { z } from "npm:zod@4.4.3";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const requestSchema = z.object({
  installationId: z.string().uuid(),
  label: z.string().trim().min(1).max(100),
}).strict();

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "register-installation", 20, 86400);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");

  const { error } = await adminClient().from("installations").upsert({
    id: parsed.data.installationId,
    user_id: user.id,
    label: parsed.data.label,
    last_seen_at: new Date().toISOString(),
    revoked_at: null,
  }, { onConflict: "user_id,id" });
  if (error) throw new Error("Could not register installation");
  return jsonResponse(request, { registered: true });
});
