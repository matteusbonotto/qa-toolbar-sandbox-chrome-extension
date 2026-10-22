import { resolveAccess } from "../_shared/access.ts";
import { adminClient, authenticatedUser, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

// Multi Testador room lifecycle (docs/adr/0003-multi-testador-sessao-colaborativa.md). Every rule the
// founder set is enforced HERE, never only in the extension: Release Manager plan only, at most 4
// active testers, only the host approves/rejects/removes, a code alone never grants entry (it only
// creates a pending request), the room ends by host, duration or inactivity, and an ended room's
// code is replaced so it can never be reused. The private Realtime channel is then gated by RLS on
// the member rows this function writes (public.mt_can_use_channel).

const MAX_ACTIVE_MEMBERS = 4;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FEATURE_KEY = "multiTester.enabled";

type Admin = ReturnType<typeof adminClient>;
interface RoomRow {
  id: string; host_id: string; code: string; status: "open" | "ended";
  duration_minutes: number; idle_timeout_minutes: number;
  created_at: string; expires_at: string; last_activity_at: string; ended_at: string | null; end_reason: string | null;
}
interface MemberRow { room_id: string; user_id: string; nickname: string; color: string; role: "host" | "guest"; status: string; requested_at: string; }

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function field(input: unknown, key: string): unknown {
  return typeof input === "object" && input !== null && key in input ? (input as Record<string, unknown>)[key] : undefined;
}

function cleanNickname(value: unknown): string {
  // Control characters and angle brackets out (rendered by other testers), collapsed whitespace.
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return text || "Testador";
}

function cleanColor(value: unknown): string {
  const text = String(value ?? "");
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : "#5b35e8";
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function uuid(value: unknown): string {
  const text = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) throw new ApiError(400, "invalid_id");
  return text;
}

async function requireMultiTester(admin: Admin, userId: string): Promise<void> {
  const { features } = await resolveAccess(admin, userId);
  if (features[FEATURE_KEY] !== true) throw new ApiError(403, "plan_required");
}

async function endRoom(admin: Admin, room: RoomRow, reason: "host" | "expired" | "idle"): Promise<RoomRow> {
  // A fresh random code replaces the old one, so a shared code dies with its session.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await admin.from("mt_rooms")
      .update({ status: "ended", ended_at: new Date().toISOString(), end_reason: reason, code: randomCode() })
      .eq("id", room.id).eq("status", "open").select().maybeSingle();
    if (!error) return (data as RoomRow | null) ?? { ...room, status: "ended" };
    if (error.code !== "23505") throw new Error("Could not end room");
  }
  throw new Error("Could not rotate room code");
}

// Lazily applies the duration and inactivity limits whenever a room is touched by any action.
async function freshRoom(admin: Admin, room: RoomRow): Promise<RoomRow> {
  if (room.status !== "open") return room;
  const now = Date.now();
  if (Date.parse(room.expires_at) <= now) return endRoom(admin, room, "expired");
  if (Date.parse(room.last_activity_at) + room.idle_timeout_minutes * 60_000 <= now) return endRoom(admin, room, "idle");
  return room;
}

async function loadRoom(admin: Admin, roomId: string): Promise<RoomRow> {
  const { data, error } = await admin.from("mt_rooms").select("*").eq("id", roomId).maybeSingle();
  if (error) throw new Error("Could not load room");
  if (!data) throw new ApiError(404, "room_not_found");
  return freshRoom(admin, data as RoomRow);
}

async function loadMembers(admin: Admin, roomId: string): Promise<MemberRow[]> {
  const { data, error } = await admin.from("mt_members").select("*").eq("room_id", roomId).order("requested_at");
  if (error) throw new Error("Could not load members");
  return (data ?? []) as MemberRow[];
}

async function roomState(admin: Admin, room: RoomRow, userId: string) {
  const members = await loadMembers(admin, room.id);
  const me = members.find((member) => member.user_id === userId);
  if (!me) throw new ApiError(404, "room_not_found");
  const isHost = room.host_id === userId;
  return {
    room: {
      id: room.id,
      status: room.status,
      // Only the host ever sees the code (only the host invites).
      code: isHost && room.status === "open" ? room.code : null,
      channel: `mt:${room.id}`,
      expiresAt: room.expires_at,
      idleTimeoutMinutes: room.idle_timeout_minutes,
      durationMinutes: room.duration_minutes,
      endReason: room.end_reason,
    },
    me: { userId, role: me.role, status: me.status },
    // Pending requests are only shown to the host; guests see who is actually in the room.
    members: members
      .filter((member) => isHost ? ["active", "pending"].includes(member.status) : member.status === "active")
      .map((member) => ({ userId: member.user_id, nickname: member.nickname, color: member.color, role: member.role, status: member.status })),
    maxMembers: MAX_ACTIVE_MEMBERS,
  };
}

async function requireHostRoom(admin: Admin, roomId: string, userId: string): Promise<RoomRow> {
  const room = await loadRoom(admin, roomId);
  if (room.host_id !== userId) throw new ApiError(403, "host_only");
  if (room.status !== "open") throw new ApiError(409, "room_ended");
  return room;
}

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  const input = await readJson(request);
  const action = String(field(input, "action") ?? "");
  const admin = adminClient();
  // Separate budgets: touch/state are polled while a session runs, the rest are human actions.
  await enforceRateLimit(user.id, ["touch", "state"].includes(action) ? "multi-tester-poll" : "multi-tester-action", ["touch", "state"].includes(action) ? 2_000 : 120, 3_600);

  if (action === "create") {
    await requireMultiTester(admin, user.id);
    const { data: existing } = await admin.from("mt_rooms").select("*").eq("host_id", user.id).eq("status", "open").maybeSingle();
    if (existing) {
      const current = await freshRoom(admin, existing as RoomRow);
      if (current.status === "open") return jsonResponse(request, await roomState(admin, current, user.id));
    }
    const durationMinutes = boundedInteger(field(input, "durationMinutes"), 5, 480, 60);
    const idleTimeoutMinutes = boundedInteger(field(input, "idleTimeoutMinutes"), 2, 120, 10);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: room, error } = await admin.from("mt_rooms").insert({
        host_id: user.id,
        code: randomCode(),
        duration_minutes: durationMinutes,
        idle_timeout_minutes: idleTimeoutMinutes,
        expires_at: new Date(Date.now() + durationMinutes * 60_000).toISOString(),
      }).select().single();
      if (error?.code === "23505") continue;
      if (error || !room) throw new Error("Could not create room");
      const { error: memberError } = await admin.from("mt_members").insert({
        room_id: room.id, user_id: user.id, nickname: cleanNickname(field(input, "nickname")),
        color: cleanColor(field(input, "color")), role: "host", status: "active", decided_at: new Date().toISOString(),
      });
      if (memberError) throw new Error("Could not create room");
      return jsonResponse(request, await roomState(admin, room as RoomRow, user.id));
    }
    throw new Error("Could not allocate room code");
  }

  if (action === "request") {
    await requireMultiTester(admin, user.id);
    const code = String(field(input, "code") ?? "").trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new ApiError(400, "invalid_code");
    const { data: found } = await admin.from("mt_rooms").select("*").eq("code", code).eq("status", "open").maybeSingle();
    // Same answer for "no such code" and "ended": the code space must not be probeable.
    if (!found) throw new ApiError(404, "room_not_found");
    const room = await freshRoom(admin, found as RoomRow);
    if (room.status !== "open") throw new ApiError(404, "room_not_found");
    if (room.host_id === user.id) return jsonResponse(request, await roomState(admin, room, user.id));
    const { data: member } = await admin.from("mt_members").select("status").eq("room_id", room.id).eq("user_id", user.id).maybeSingle();
    if (member && ["removed", "rejected"].includes(member.status)) throw new ApiError(403, "not_allowed");
    if (!member || member.status === "left") {
      const { error } = await admin.from("mt_members").upsert({
        room_id: room.id, user_id: user.id, nickname: cleanNickname(field(input, "nickname")), color: cleanColor(field(input, "color")),
        role: "guest", status: "pending", requested_at: new Date().toISOString(), decided_at: null,
      });
      if (error) throw new Error("Could not request entry");
    }
    return jsonResponse(request, await roomState(admin, room, user.id));
  }

  const roomId = uuid(field(input, "roomId"));

  if (action === "state") {
    return jsonResponse(request, await roomState(admin, await loadRoom(admin, roomId), user.id));
  }

  if (action === "touch") {
    const room = await loadRoom(admin, roomId);
    const { data: member } = await admin.from("mt_members").select("status").eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
    if (room.status === "open" && member?.status === "active") {
      await admin.from("mt_rooms").update({ last_activity_at: new Date().toISOString() }).eq("id", roomId).eq("status", "open");
    }
    return jsonResponse(request, await roomState(admin, room, user.id));
  }

  if (action === "approve" || action === "reject" || action === "remove") {
    const room = await requireHostRoom(admin, roomId, user.id);
    const targetId = uuid(field(input, "userId"));
    if (targetId === user.id) throw new ApiError(400, "invalid_target");
    const members = await loadMembers(admin, roomId);
    const target = members.find((member) => member.user_id === targetId);
    if (!target) throw new ApiError(404, "member_not_found");
    let status = "";
    if (action === "approve") {
      if (target.status !== "pending") throw new ApiError(409, "not_pending");
      if (members.filter((member) => member.status === "active").length >= MAX_ACTIVE_MEMBERS) throw new ApiError(409, "room_full");
      // Plans can lapse between the request and the approval.
      await requireMultiTester(admin, targetId).catch(() => { throw new ApiError(409, "guest_plan_required"); });
      status = "active";
    } else if (action === "reject") {
      if (target.status !== "pending") throw new ApiError(409, "not_pending");
      status = "rejected";
    } else {
      if (!["pending", "active"].includes(target.status)) throw new ApiError(409, "not_member");
      status = "removed";
    }
    const { error } = await admin.from("mt_members").update({ status, decided_at: new Date().toISOString() }).eq("room_id", roomId).eq("user_id", targetId);
    if (error) throw new Error("Could not update member");
    return jsonResponse(request, await roomState(admin, room, user.id));
  }

  if (action === "leave") {
    const room = await loadRoom(admin, roomId);
    if (room.host_id === user.id) return jsonResponse(request, await roomState(admin, room.status === "open" ? await endRoom(admin, room, "host") : room, user.id));
    await admin.from("mt_members").update({ status: "left", decided_at: new Date().toISOString() })
      .eq("room_id", roomId).eq("user_id", user.id).in("status", ["pending", "active"]);
    return jsonResponse(request, await roomState(admin, room, user.id));
  }

  if (action === "end") {
    const room = await requireHostRoom(admin, roomId, user.id);
    return jsonResponse(request, await roomState(admin, await endRoom(admin, room, "host"), user.id));
  }

  throw new ApiError(400, "invalid_action");
});
