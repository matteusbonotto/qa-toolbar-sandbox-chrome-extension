import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "referral-track", 5, 3_600);
  const input = await readJson(request);
  const referralCode = typeof input === "object" && input !== null && "referralCode" in input
    ? String(input.referralCode).trim().toUpperCase()
    : "";
  if (!/^QTS-[A-F0-9]{8}$/.test(referralCode)) throw new ApiError(400, "invalid_referral_code");
  const { data, error } = await adminClient().rpc("register_referral", {
    target_user_id: user.id,
    referral_code_input: referralCode,
  });
  if (error) throw new Error("Referral registration failed");
  if (!data) throw new ApiError(409, "referral_unavailable");
  return jsonResponse(request, { registered: true });
});
