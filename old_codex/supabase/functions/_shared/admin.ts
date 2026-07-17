import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2.109.0";
import { adminClient, authenticatedUser, requireAal2 } from "./auth.ts";
import { ApiError } from "./http.ts";

export interface AdminActor {
  actor: User;
  admin: SupabaseClient;
  isFounder: boolean;
}

/**
 * Every admin-panel Edge Function must call this first. It re-verifies the
 * session (never trusts a client-supplied role), requires a recent AAL2
 * step-up, and confirms the caller holds `founder` or `admin` in
 * `user_roles` — hiding the admin UI is never the security boundary.
 */
export async function requireAdminActor(request: Request): Promise<AdminActor> {
  const actor = await authenticatedUser(request);
  requireAal2(request);
  const admin = adminClient();
  const { data } = await admin.from("user_roles").select("roles(key)").eq("user_id", actor.id);
  const roleKeys = new Set((data ?? []).map((entry) => (entry.roles as unknown as { key?: string } | null)?.key));
  if (!roleKeys.has("founder") && !roleKeys.has("admin")) throw new ApiError(403, "administrator_required");
  return { actor, admin, isFounder: roleKeys.has("founder") };
}

export function requireFounder(context: AdminActor): void {
  if (!context.isFounder) throw new ApiError(403, "founder_required");
}

export async function writeAuditLog(
  admin: SupabaseClient,
  entry: { actorId: string; action: string; targetType: string; targetId?: string; reason: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const { error } = await admin.from("audit_logs").insert({
    actor_id: entry.actorId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    reason: entry.reason,
    metadata: entry.metadata ?? {},
  });
  if (error) throw new Error("Could not write audit log entry");
}
