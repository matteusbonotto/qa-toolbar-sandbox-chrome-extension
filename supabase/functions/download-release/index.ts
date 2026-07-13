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
  const now = new Date().toISOString();
  const [{ data: subscription }, { data: grant }] = await Promise.all([
    admin.from("subscriptions").select("id").eq("user_id", user.id)
      .in("status", ["active", "trialing"]).limit(1).maybeSingle(),
    admin.from("entitlement_grants").select("id").eq("user_id", user.id)
      .is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${now}`).limit(1).maybeSingle(),
  ]);
  if (!subscription && !grant) throw new ApiError(403, "release_access_required");

  const { data, error } = await admin.storage.from(bucket).createSignedUrl(objectPath, 60, {
    download: "qa-toolbar-sandbox-chrome.zip",
  });
  if (error || !data?.signedUrl) throw new Error("Release is unavailable");
  return jsonResponse(request, { downloadUrl: data.signedUrl, expiresIn: 60 });
});
