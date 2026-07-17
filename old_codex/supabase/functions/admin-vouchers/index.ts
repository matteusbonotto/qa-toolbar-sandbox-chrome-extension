import { createHash } from "node:crypto";
import { z } from "npm:zod@4.4.3";
import { enforceRateLimit } from "../_shared/auth.ts";
import { requireAdminActor, writeAuditLog } from "../_shared/admin.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

// Matches encode(digest(convert_to(upper(code),'UTF8'),'sha256'),'hex') used
// by provision_voucher/redeem_voucher in the database, so codes created here
// redeem correctly and existing rows keep working.
function hashVoucherCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest("hex");
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({
    action: z.literal("createVoucher"),
    code: z.string().trim().min(4).max(64),
    label: z.string().trim().min(3).max(100),
    planId: z.string().uuid(),
    grantDays: z.number().int().min(1).max(3650).nullable(),
    expiresAt: z.string().datetime().nullable().optional(),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("setVoucherStatus"),
    voucherId: z.string().uuid(),
    status: z.enum(["available", "disabled"]),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("createCampaign"),
    code: z.string().trim().min(4).max(64),
    label: z.string().trim().min(3).max(100),
    planId: z.string().uuid(),
    grantDays: z.number().int().min(1).max(3650),
    maximumRedemptions: z.number().int().positive().nullable(),
    expiresAt: z.string().datetime().nullable().optional(),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("setCampaignEnabled"),
    campaignId: z.string().uuid(),
    enabled: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
]);

serve(async (request) => {
  requirePost(request);
  const { actor, admin } = await requireAdminActor(request);
  await enforceRateLimit(actor.id, "admin-vouchers", 60, 3600);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");

  if (parsed.data.action === "list") {
    const [{ data: vouchers }, { data: campaigns }] = await Promise.all([
      admin.from("vouchers").select("id, label, plan_id, grant_days, status, expires_at, redeemed_by, redeemed_at, created_at").order("created_at", { ascending: false }),
      admin.from("voucher_campaigns").select("id, label, plan_id, grant_days, maximum_redemptions, redemption_count, enabled, expires_at, created_at").order("created_at", { ascending: false }),
    ]);
    return jsonResponse(request, { vouchers: vouchers ?? [], campaigns: campaigns ?? [] });
  }

  if (parsed.data.action === "createVoucher") {
    const { code, label, planId, grantDays, expiresAt, reason } = parsed.data;
    const codeHash = hashVoucherCode(code);
    const { data, error } = await admin.from("vouchers")
      .insert({ code_hash: codeHash, label, plan_id: planId, grant_days: grantDays, expires_at: expiresAt ?? null })
      .select("id").single();
    if (error) throw new ApiError(409, "voucher_create_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "voucher.created", targetType: "voucher", targetId: data.id, reason, metadata: { label, planId, grantDays } });
    return jsonResponse(request, { voucherId: data.id });
  }

  if (parsed.data.action === "setVoucherStatus") {
    const { voucherId, status, reason } = parsed.data;
    const { error } = await admin.from("vouchers").update({ status }).eq("id", voucherId);
    if (error) throw new ApiError(409, "voucher_update_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "voucher.status_changed", targetType: "voucher", targetId: voucherId, reason, metadata: { status } });
    return jsonResponse(request, { applied: true });
  }

  if (parsed.data.action === "createCampaign") {
    const { code, label, planId, grantDays, maximumRedemptions, expiresAt, reason } = parsed.data;
    const codeHash = hashVoucherCode(code);
    const { data, error } = await admin.from("voucher_campaigns")
      .insert({ code_hash: codeHash, label, plan_id: planId, grant_days: grantDays, maximum_redemptions: maximumRedemptions, expires_at: expiresAt ?? null })
      .select("id").single();
    if (error) throw new ApiError(409, "campaign_create_failed");
    await writeAuditLog(admin, { actorId: actor.id, action: "voucher_campaign.created", targetType: "voucher_campaign", targetId: data.id, reason, metadata: { label, planId, grantDays, maximumRedemptions } });
    return jsonResponse(request, { campaignId: data.id });
  }

  const { campaignId, enabled, reason } = parsed.data;
  const { error } = await admin.from("voucher_campaigns").update({ enabled }).eq("id", campaignId);
  if (error) throw new ApiError(409, "campaign_update_failed");
  await writeAuditLog(admin, { actorId: actor.id, action: "voucher_campaign.status_changed", targetType: "voucher_campaign", targetId: campaignId, reason, metadata: { enabled } });
  return jsonResponse(request, { applied: true });
});
