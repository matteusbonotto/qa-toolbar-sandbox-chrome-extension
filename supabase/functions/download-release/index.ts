import { z } from "npm:zod@4.4.3";
import { adminClient, authenticatedUser, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const requestSchema = z.object({}).strict();
const bucket = "extension-releases";
const objectPath = "qa-toolbar-sandbox-chrome.zip";

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "download-release", 30, 3600);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");

  const admin = adminClient();
  const { data: subscription } = await admin.from("subscriptions").select("provider_subscription_id")
    .eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
  if (!subscription) throw new ApiError(403, "paid_subscription_required");
  const { data: confirmedPayment } = await admin.from("payment_events").select("id")
    .eq("user_id", user.id)
    .eq("provider_subscription_id", subscription.provider_subscription_id)
    .in("event_type", ["checkout.session.completed", "invoice.paid"])
    .gt("amount_minor", 0)
    .limit(1)
    .maybeSingle();
  if (!confirmedPayment) throw new ApiError(403, "confirmed_payment_required");

  const { data, error } = await admin.storage.from(bucket).createSignedUrl(objectPath, 60, {
    download: "qa-toolbar-sandbox-chrome.zip",
  });
  if (error || !data?.signedUrl) throw new Error("Release is unavailable");
  return jsonResponse(request, { downloadUrl: data.signedUrl, expiresIn: 60 });
});
