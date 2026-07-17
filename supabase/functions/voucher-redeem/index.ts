import { createHash } from "node:crypto";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "voucher-redeem", 8, 3_600);
  const input = await readJson(request);
  const code = typeof input === "object" && input !== null && "code" in input ? String(input.code).trim().toUpperCase() : "";
  if (!/^[A-Z0-9-]{6,64}$/.test(code)) throw new ApiError(400, "invalid_voucher");

  const voucherHash = createHash("sha256").update(code).digest("hex");
  const { data, error } = await adminClient().rpc("redeem_voucher", {
    target_user_id: user.id,
    voucher_hash: voucherHash,
  });
  if (error || !data?.[0]) throw new ApiError(409, "voucher_unavailable");
  return jsonResponse(request, {
    redeemed: true,
    label: data[0].label,
    expiresAt: data[0].access_expires_at,
  });
});
