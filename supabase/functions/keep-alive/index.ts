import { createHash, timingSafeEqual } from "node:crypto";
import { adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, requirePost } from "../_shared/http.ts";

function requiredSecret(): string {
  const value = Deno.env.get("KEEP_ALIVE_SECRET")?.trim();
  if (!value) throw new Error("Missing required server configuration: KEEP_ALIVE_SECRET");
  return value;
}

function matchesSecret(received: string, expected: string): boolean {
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

serve(async (request) => {
  requirePost(request);
  if (!matchesSecret(request.headers.get("x-keep-alive-secret") ?? "", requiredSecret())) {
    throw new ApiError(401, "unauthorized");
  }
  await enforceRateLimit("scheduler", "keep-alive", 4, 86_400);
  const { error } = await adminClient().from("app_versions").select("id", { head: true, count: "exact" }).limit(1);
  if (error) throw new Error("Database health check failed");
  return jsonResponse(request, { ok: true, checkedAt: new Date().toISOString() });
});
