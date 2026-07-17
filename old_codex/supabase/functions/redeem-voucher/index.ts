import { createHash } from "node:crypto";
import { z } from "npm:zod@4.4.3";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const requestSchema = z.object({ code: z.string().trim().min(6).max(64).regex(/^[A-Z0-9-]+$/i) }).strict();

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "redeem-voucher", 8, 3600);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_voucher");
  const hash = createHash("sha256").update(parsed.data.code.toUpperCase()).digest("hex");
  const { data, error } = await adminClient().rpc("redeem_voucher", { target_user_id: user.id, voucher_hash: hash });
  if (error || !data?.[0]) throw new ApiError(409, "voucher_unavailable");
  return jsonResponse(request, { redeemed: true, label: data[0].label, expiresAt: data[0].access_expires_at });
});
