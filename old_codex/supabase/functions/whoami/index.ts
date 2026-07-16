import { adminClient, authenticatedUser, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { jsonResponse, requirePost } from "../_shared/http.ts";

// Any authenticated caller may ask "who am I" — this only ever reflects the
// caller's own roles (never another user's), so it needs no admin gate.
// user_roles/roles have no self-select RLS policy, so this is the only way
// the admin panel frontend can tell whether the signed-in Google account is
// authorized before rendering privileged screens.
serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "whoami", 120, 3600);
  const admin = adminClient();
  const { data } = await admin.from("user_roles").select("roles(key)").eq("user_id", user.id);
  const roleKeys = (data ?? []).map((entry) => (entry.roles as unknown as { key?: string } | null)?.key).filter((key): key is string => Boolean(key));
  return jsonResponse(request, {
    userId: user.id,
    email: user.email ?? null,
    roles: roleKeys,
    isAdmin: roleKeys.includes("admin") || roleKeys.includes("founder"),
    isFounder: roleKeys.includes("founder"),
  });
});
