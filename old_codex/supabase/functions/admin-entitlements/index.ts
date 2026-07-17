import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.109.0";
import { z } from "npm:zod@4.4.3";
import { enforceRateLimit } from "../_shared/auth.ts";
import { requireAdminActor, writeAuditLog } from "../_shared/admin.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("grantAccess"),
    userEmail: z.string().trim().email(),
    planId: z.string().uuid(),
    source: z.enum(["manual", "founder"]),
    expiresAt: z.string().datetime().nullable(),
    reason: z.string().trim().min(10).max(500),
  }).strict(),
  z.object({
    action: z.literal("revokeAccess"),
    grantId: z.string().uuid(),
    reason: z.string().trim().min(10).max(500),
  }).strict(),
  z.object({
    action: z.literal("listUserAccess"),
    userEmail: z.string().trim().email(),
  }).strict(),
  z.object({
    action: z.literal("setFeatureOverride"),
    userEmail: z.string().trim().email(),
    featureId: z.string().uuid(),
    value: z.unknown(),
    expiresAt: z.string().datetime().nullable(),
    reason: z.string().trim().min(10).max(500),
  }).strict(),
  z.object({
    action: z.literal("revokeFeatureOverride"),
    overrideId: z.string().uuid(),
    reason: z.string().trim().min(10).max(500),
  }).strict(),
  z.object({
    action: z.literal("createLicenseKey"),
    planId: z.string().uuid(),
    maximumActivations: z.number().int().min(1).max(10_000),
    expiresAt: z.string().datetime().nullable(),
    reason: z.string().trim().min(10).max(500),
  }).strict(),
  z.object({
    action: z.literal("revokeLicenseKey"),
    licenseKeyId: z.string().uuid(),
    reason: z.string().trim().min(10).max(500),
  }).strict(),
]);

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.rpc("admin_search_users", { search: email, limit_count: 5 });
  if (error) throw new Error("Could not search users");
  const match = (data ?? []).find((row: { email: string | null }) => row.email?.toLowerCase() === email.toLowerCase());
  if (!match) throw new ApiError(404, "user_not_found");
  return match.id as string;
}

serve(async (request) => {
  requirePost(request);
  const { actor, admin } = await requireAdminActor(request);
  await enforceRateLimit(actor.id, "admin-entitlements", 60, 3600);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");

  if (parsed.data.action === "grantAccess") {
    const { userEmail, planId, source, expiresAt, reason } = parsed.data;
    const userId = await findUserIdByEmail(admin, userEmail);
    const { data, error } = await admin.from("entitlement_grants")
      .insert({ user_id: userId, plan_id: planId, source, expires_at: expiresAt })
      .select("id").single();
    if (error) throw new ApiError(409, "grant_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "entitlement.granted", targetType: "user", targetId: userId, reason, metadata: { planId, source, expiresAt } });
    return jsonResponse(request, { grantId: data.id });
  }

  if (parsed.data.action === "revokeAccess") {
    const { grantId, reason } = parsed.data;
    const { data, error } = await admin.from("entitlement_grants").update({ revoked_at: new Date().toISOString() }).eq("id", grantId).select("user_id").single();
    if (error) throw new ApiError(409, "revoke_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "entitlement.revoked", targetType: "user", targetId: data.user_id, reason, metadata: { grantId } });
    return jsonResponse(request, { applied: true });
  }

  if (parsed.data.action === "listUserAccess") {
    const userId = await findUserIdByEmail(admin, parsed.data.userEmail);
    const [{ data: grants }, { data: overrides }, { data: subscription }] = await Promise.all([
      admin.from("entitlement_grants").select("id, plan_id, source, starts_at, expires_at, revoked_at, plans(key,name)").eq("user_id", userId).order("created_at", { ascending: false }),
      admin.from("entitlement_overrides").select("id, feature_id, value, starts_at, expires_at, revoked_at, reason, features(key)").eq("user_id", userId).order("created_at", { ascending: false }),
      admin.from("subscriptions").select("status, current_period_end, plans(key,name)").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return jsonResponse(request, { userId, grants: grants ?? [], overrides: overrides ?? [], subscription: subscription ?? null });
  }

  if (parsed.data.action === "setFeatureOverride") {
    const { userEmail, featureId, value, expiresAt, reason } = parsed.data;
    const userId = await findUserIdByEmail(admin, userEmail);
    const { data, error } = await admin.from("entitlement_overrides")
      .insert({ user_id: userId, feature_id: featureId, value, expires_at: expiresAt, granted_by: actor.id, reason })
      .select("id").single();
    if (error) throw new ApiError(409, "override_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "entitlement_override.granted", targetType: "user", targetId: userId, reason, metadata: { featureId, value } });
    return jsonResponse(request, { overrideId: data.id });
  }

  if (parsed.data.action === "revokeFeatureOverride") {
    const { overrideId, reason } = parsed.data;
    const { data, error } = await admin.from("entitlement_overrides").update({ revoked_at: new Date().toISOString() }).eq("id", overrideId).select("user_id").single();
    if (error) throw new ApiError(409, "override_revoke_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "entitlement_override.revoked", targetType: "user", targetId: data.user_id, reason, metadata: { overrideId } });
    return jsonResponse(request, { applied: true });
  }

  if (parsed.data.action === "createLicenseKey") {
    const { planId, maximumActivations, expiresAt, reason } = parsed.data;
    const secret = randomBytes(15).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
    const plainKey = `QTS-${secret}`;
    const keyHash = createHash("sha256").update(plainKey, "utf8").digest("hex");
    const { data, error } = await admin.from("license_keys")
      .insert({ key_prefix: plainKey.slice(0, 12), key_hash: keyHash, plan_id: planId, maximum_activations: maximumActivations, expires_at: expiresAt, created_by: actor.id })
      .select("id").single();
    if (error) throw new ApiError(409, "license_create_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "license_key.created", targetType: "license_key", targetId: data.id, reason, metadata: { planId, maximumActivations } });
    // The plaintext key is returned exactly once and never stored — only its hash persists.
    return jsonResponse(request, { licenseKeyId: data.id, plainKey });
  }

  const { licenseKeyId, reason } = parsed.data;
  const { error } = await admin.from("license_keys").update({ revoked_at: new Date().toISOString() }).eq("id", licenseKeyId);
  if (error) throw new ApiError(409, "license_revoke_failed");
  await writeAuditLog(admin, { actorId: actor.id, action: "license_key.revoked", targetType: "license_key", targetId: licenseKeyId, reason });
  return jsonResponse(request, { applied: true });
});
