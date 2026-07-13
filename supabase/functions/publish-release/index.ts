import { createHash, timingSafeEqual } from "node:crypto";
import { adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { requiredEnv } from "../_shared/config.ts";
import { jsonResponse } from "../_shared/http.ts";

const maximumBytes = 10 * 1024 * 1024;
const bucket = "extension-releases";
const objectPath = "qa-toolbar-sandbox-chrome.zip";

function matchesSecret(received: string, expected: string): boolean {
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);
  if (!matchesSecret(request.headers.get("x-release-upload-secret") ?? "", requiredEnv("RELEASE_UPLOAD_SECRET"))) {
    return jsonResponse(request, { error: "unauthorized" }, 401);
  }
  if ((request.headers.get("content-type") ?? "").toLowerCase() !== "application/zip") {
    return jsonResponse(request, { error: "content_type_required" }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maximumBytes) return jsonResponse(request, { error: "payload_too_large" }, 413);
  await enforceRateLimit("release-publisher", "publish-release", 12, 3600);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength < 1024 || bytes.byteLength > maximumBytes || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return jsonResponse(request, { error: "invalid_zip" }, 400);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { error } = await adminClient().storage.from(bucket).upload(objectPath, bytes, {
    contentType: "application/zip",
    upsert: true,
    cacheControl: "no-store",
  });
  if (error) return jsonResponse(request, { error: "upload_failed" }, 503);
  return jsonResponse(request, { ok: true, sha256, bytes: bytes.byteLength });
});
