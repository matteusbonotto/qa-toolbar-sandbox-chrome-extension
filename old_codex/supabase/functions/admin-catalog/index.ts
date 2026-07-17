import { z } from "npm:zod@4.4.3";
import { enforceRateLimit } from "../_shared/auth.ts";
import { requireAdminActor, requireFounder, writeAuditLog } from "../_shared/admin.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({
    action: z.literal("upsertPlan"),
    planId: z.string().uuid().optional(),
    key: z.string().trim().regex(/^[a-z][a-z0-9._-]+$/),
    name: z.string().trim().min(1).max(80),
    isActive: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("upsertFeatureValue"),
    planId: z.string().uuid(),
    featureId: z.string().uuid(),
    value: z.unknown(),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("upsertPrice"),
    planId: z.string().uuid(),
    billingInterval: z.enum(["monthly", "yearly"]),
    stripePriceId: z.string().trim().regex(/^price_[A-Za-z0-9]+$/),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("upsertFeatureFlag"),
    key: z.string().trim().regex(/^[a-z][a-zA-Z0-9._-]+$/),
    enabled: z.boolean(),
    description: z.string().trim().max(500).default(""),
    config: z.record(z.string(), z.unknown()).default({}),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("upsertNotice"),
    noticeId: z.string().uuid().optional(),
    severity: z.enum(["info", "warning", "critical"]),
    title: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(2000),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    isActive: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("upsertVersion"),
    version: z.string().trim().regex(/^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$/),
    minimumSupportedVersion: z.string().trim().min(1).max(40),
    isBlocked: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
]);

serve(async (request) => {
  requirePost(request);
  const context = await requireAdminActor(request);
  const { actor, admin } = context;
  await enforceRateLimit(actor.id, "admin-catalog", 60, 3600);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");

  if (parsed.data.action === "list") {
    const [{ data: plans }, { data: features }, { data: planFeatures }, { data: prices }, { data: flags }, { data: notices }, { data: versions }] = await Promise.all([
      admin.from("plans").select("id, key, name, is_active, created_at").order("created_at"),
      admin.from("features").select("id, key, value_type, description").order("key"),
      admin.from("plan_features").select("plan_id, feature_id, value"),
      admin.from("plan_prices").select("id, plan_id, billing_interval, stripe_price_id, updated_at"),
      admin.from("feature_flags").select("key, enabled, config, description, updated_at").order("key"),
      admin.from("system_notices").select("id, severity, title, message, starts_at, ends_at, is_active, created_at").order("created_at", { ascending: false }),
      admin.from("app_versions").select("id, version, minimum_supported_version, is_blocked, released_at").order("released_at", { ascending: false }),
    ]);
    return jsonResponse(request, {
      plans: plans ?? [], features: features ?? [], planFeatures: planFeatures ?? [], prices: prices ?? [],
      flags: flags ?? [], notices: notices ?? [], versions: versions ?? [],
    });
  }

  if (parsed.data.action === "upsertPlan") {
    const { planId, key, name, isActive, reason } = parsed.data;
    const payload = { key, name, is_active: isActive };
    const { data, error } = planId
      ? await admin.from("plans").update(payload).eq("id", planId).select("id").single()
      : await admin.from("plans").insert(payload).select("id").single();
    if (error) throw new ApiError(409, "plan_upsert_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: planId ? "plan.updated" : "plan.created", targetType: "plan", targetId: data.id, reason, metadata: { key, name, isActive } });
    return jsonResponse(request, { planId: data.id });
  }

  if (parsed.data.action === "upsertFeatureValue") {
    const { planId, featureId, value, reason } = parsed.data;
    const { error } = await admin.from("plan_features").upsert({ plan_id: planId, feature_id: featureId, value }, { onConflict: "plan_id,feature_id" });
    if (error) throw new ApiError(409, "feature_value_upsert_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "plan_feature.updated", targetType: "plan_feature", targetId: `${planId}:${featureId}`, reason, metadata: { value } });
    return jsonResponse(request, { applied: true });
  }

  if (parsed.data.action === "upsertPrice") {
    // Prices decide what customers are actually charged: require founder, not just support-admin.
    requireFounder(context);
    const { planId, billingInterval, stripePriceId, reason } = parsed.data;
    const { error } = await admin.from("plan_prices").upsert(
      { plan_id: planId, billing_interval: billingInterval, stripe_price_id: stripePriceId, updated_by: actor.id },
      { onConflict: "plan_id,billing_interval" },
    );
    if (error) throw new ApiError(409, "price_upsert_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "plan_price.updated", targetType: "plan_price", targetId: `${planId}:${billingInterval}`, reason, metadata: { stripePriceId } });
    return jsonResponse(request, { applied: true });
  }

  if (parsed.data.action === "upsertFeatureFlag") {
    const { key, enabled, description, config, reason } = parsed.data;
    const { error } = await admin.from("feature_flags").upsert({ key, enabled, description, config }, { onConflict: "key" });
    if (error) throw new ApiError(409, "feature_flag_upsert_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "feature_flag.updated", targetType: "feature_flag", targetId: key, reason, metadata: { enabled } });
    return jsonResponse(request, { applied: true });
  }

  if (parsed.data.action === "upsertNotice") {
    const { noticeId, severity, title, message, startsAt, endsAt, isActive, reason } = parsed.data;
    const payload = { severity, title, message, is_active: isActive, ...(startsAt ? { starts_at: startsAt } : {}), ends_at: endsAt ?? null };
    const { data, error } = noticeId
      ? await admin.from("system_notices").update(payload).eq("id", noticeId).select("id").single()
      : await admin.from("system_notices").insert({ ...payload, created_by: actor.id }).select("id").single();
    if (error) throw new ApiError(409, "notice_upsert_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: noticeId ? "notice.updated" : "notice.created", targetType: "system_notice", targetId: data.id, reason, metadata: { severity, title, isActive } });
    return jsonResponse(request, { noticeId: data.id });
  }

  const { version, minimumSupportedVersion, isBlocked, reason } = parsed.data;
  const { data, error } = await admin.from("app_versions")
    .upsert({ version, minimum_supported_version: minimumSupportedVersion, is_blocked: isBlocked }, { onConflict: "version" })
    .select("id").single();
  if (error) throw new ApiError(409, "version_upsert_failed");
  await writeAuditLog(admin, { actorId: actor.id, action: "app_version.updated", targetType: "app_version", targetId: version, reason, metadata: { minimumSupportedVersion, isBlocked } });
  return jsonResponse(request, { versionId: data.id });
});
