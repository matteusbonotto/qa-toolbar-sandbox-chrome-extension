import { z } from "npm:zod@4.4.3";
import { authenticatedUser, adminClient, enforceRateLimit, requireAal2 } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

const schema = z.object({
  action: z.enum(["grant", "revoke"]),
  targetUserId: z.string().uuid(),
  roleKey: z.enum(["support", "admin"]),
  reason: z.string().trim().min(10).max(500),
}).strict();

serve(async (request) => {
  requirePost(request);
  const actor = await authenticatedUser(request);
  requireAal2(request);
  await enforceRateLimit(actor.id, "admin-role-action", 30, 3600);
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");
  if (parsed.data.targetUserId === actor.id) throw new ApiError(403, "self_role_change_forbidden");

  const admin = adminClient();
  const { data: actorRoles } = await admin.from("user_roles").select("roles(key)").eq("user_id", actor.id);
  const roleKeys = new Set((actorRoles ?? []).map((entry) => {
    const role = entry.roles as unknown as { key?: string } | null;
    return role?.key;
  }));
  const isFounder = roleKeys.has("founder");
  if (!isFounder && !roleKeys.has("admin")) throw new ApiError(403, "administrator_required");
  if (parsed.data.roleKey === "admin" && !isFounder) throw new ApiError(403, "founder_required");

  const [{ data: role }, { data: targetUser }] = await Promise.all([
    admin.from("roles").select("id").eq("key", parsed.data.roleKey).single(),
    admin.auth.admin.getUserById(parsed.data.targetUserId),
  ]);
  if (!role || !targetUser.user) throw new ApiError(404, "target_not_found");

  if (parsed.data.action === "grant") {
    const { error } = await admin.from("user_roles").upsert({
      user_id: parsed.data.targetUserId,
      role_id: role.id,
      granted_by: actor.id,
      reason: parsed.data.reason,
    }, { onConflict: "user_id,role_id" });
    if (error) throw new Error("Role grant failed");
  } else {
    const { error } = await admin.from("user_roles").delete()
      .eq("user_id", parsed.data.targetUserId).eq("role_id", role.id);
    if (error) throw new Error("Role revoke failed");
  }

  await admin.from("audit_logs").insert({
    actor_id: actor.id,
    action: `role.${parsed.data.action}`,
    target_type: "user",
    target_id: parsed.data.targetUserId,
    reason: parsed.data.reason,
    metadata: { role_key: parsed.data.roleKey },
  });
  return jsonResponse(request, { applied: true });
});
