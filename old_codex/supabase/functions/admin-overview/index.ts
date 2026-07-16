import { z } from "npm:zod@4.4.3";
import { enforceRateLimit } from "../_shared/auth.ts";
import { requireAdminActor } from "../_shared/admin.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dashboard") }).strict(),
  z.object({ action: z.literal("searchUsers"), search: z.string().trim().max(200).optional(), limit: z.number().int().min(1).max(200).optional() }).strict(),
  z.object({ action: z.literal("auditLog"), limit: z.number().int().min(1).max(200).optional(), targetType: z.string().trim().max(80).optional() }).strict(),
]);

serve(async (request) => {
  requirePost(request);
  const { actor, admin } = await requireAdminActor(request);
  await enforceRateLimit(actor.id, "admin-overview", 120, 3600);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");

  if (parsed.data.action === "dashboard") {
    const { data, error } = await admin.rpc("admin_dashboard_overview").single();
    if (error) throw new Error("Could not load dashboard overview");
    return jsonResponse(request, { overview: data });
  }

  if (parsed.data.action === "searchUsers") {
    const { data, error } = await admin.rpc("admin_search_users", {
      search: parsed.data.search ?? null,
      limit_count: parsed.data.limit ?? 50,
    });
    if (error) throw new Error("Could not search users");
    return jsonResponse(request, { users: data ?? [] });
  }

  let query = admin.from("audit_logs").select("id, actor_id, action, target_type, target_id, reason, metadata, created_at")
    .order("created_at", { ascending: false }).limit(parsed.data.limit ?? 50);
  if (parsed.data.targetType) query = query.eq("target_type", parsed.data.targetType);
  const { data, error } = await query;
  if (error) throw new Error("Could not load audit log");
  return jsonResponse(request, { entries: data ?? [] });
});
