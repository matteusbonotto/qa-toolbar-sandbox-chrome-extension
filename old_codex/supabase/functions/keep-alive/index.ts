import { createHash, timingSafeEqual } from "node:crypto";
import { adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { requiredEnv } from "../_shared/config.ts";
import { jsonResponse } from "../_shared/http.ts";

function matchesSecret(received: string, expected: string): boolean {
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);
  const received = request.headers.get("x-keep-alive-secret") ?? "";
  if (!matchesSecret(received, requiredEnv("KEEP_ALIVE_SECRET"))) {
    return jsonResponse(request, { error: "unauthorized" }, 401);
  }
  await enforceRateLimit("scheduler", "keep-alive", 4, 86_400);
  const { error } = await adminClient().from("app_versions").select("id", { head: true, count: "exact" }).limit(1);
  if (error) return jsonResponse(request, { ok: false }, 503);
  return jsonResponse(request, { ok: true, checkedAt: new Date().toISOString() });
});
