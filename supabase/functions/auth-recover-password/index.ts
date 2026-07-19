import { z } from "npm:zod@4.4.3";
import { enforceRateLimit, publicClient } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

// Lets the extension's own login screen offer "Esqueci minha senha" without bundling
// supabase-js or the anon key into the extension — the reset link always lands on the LP's
// own reset-password page (the extension has no in-browser page to complete the flow on).
const RESET_REDIRECT_URL = "https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/redefinir-senha";

const schema = z.object({ email: z.string().trim().email().max(254) }).strict();

serve(async (request) => {
  requirePost(request);
  const parsed = schema.safeParse(await readJson(request, 2_048));
  if (!parsed.success) throw new ApiError(400, "invalid_request");
  const email = parsed.data.email.toLowerCase();
  await enforceRateLimit(email, "auth-recover-password", 5, 900);
  // Supabase's own resetPasswordForEmail() never reveals whether the address has an
  // account — same "sent if it exists" response either way, nothing to branch on here.
  await publicClient().auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT_URL });
  return jsonResponse(request, { sent: true });
});
