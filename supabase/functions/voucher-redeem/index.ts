import { createHash } from "node:crypto";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";
import { voucherRpcErrorCode } from "../_shared/vouchers.ts";

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "voucher-redeem", 8, 3_600);
  const input = await readJson(request);
  const code = typeof input === "object" && input !== null && "code" in input ? String(input.code).trim().toUpperCase() : "";
  if (!/^[A-Z0-9-]{6,64}$/.test(code)) throw new ApiError(400, "invalid_voucher");

  const voucherHash = createHash("sha256").update(code).digest("hex");
  const admin = adminClient();
  const [{ data: campaignRow }, { data: voucherRow }] = await Promise.all([
    admin.from("voucher_campaigns").select("kind").eq("code_hash", voucherHash).maybeSingle(),
    admin.from("vouchers").select("kind").eq("code_hash", voucherHash).maybeSingle(),
  ]);
  if ((campaignRow?.kind ?? voucherRow?.kind) === "discount") throw new ApiError(409, "voucher_requires_checkout");

  const { data, error } = await admin.rpc("redeem_voucher", {
    target_user_id: user.id,
    voucher_hash: voucherHash,
  });
  // The domain rule (allowed_email_domains) is enforced inside redeem_voucher itself; this only
  // turns its exception into a code the client can explain (409 voucher_domain_not_allowed).
  if (error) throw new ApiError(409, voucherRpcErrorCode(error));
  if (!data?.[0]) throw new ApiError(409, "voucher_unavailable");
  return jsonResponse(request, {
    redeemed: true,
    label: data[0].label,
    expiresAt: data[0].access_expires_at,
  });
});
