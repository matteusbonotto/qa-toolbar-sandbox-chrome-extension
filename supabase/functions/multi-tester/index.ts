import { resolveAccess } from "../_shared/access.ts";
import { adminClient, authenticatedUser, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";

// Multi Testador room lifecycle (docs/adr/0003-multi-testador-sessao-colaborativa.md). Every rule the
// founder set is enforced HERE, never only in the extension: Release Manager plan only (re-checked
// during the session), at most 4 active testers (atomic, mt_set_member_status), only the host
// approves/rejects/removes, a code alone never grants entry (it only creates a pending request), the
// room ends by host, duration or inactivity, and an ended room's code is replaced so it can never be
// reused. The private Realtime channel is gated by RLS on these rows (public.mt_can_use_channel) and
// its topic carries an epoch rotated on every removal/end, so a removed socket is cut off at once.
// Chat is published from here with the sender stamped server-side (clients cannot send `chat`).

const MAX_ACTIVE_MEMBERS = 4;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FEATURE_KEY = "multiTester.enabled";
// How often an active member's plan is re-validated while the session runs.
const PLAN_RECHECK_MS = 5 * 60_000;

type Admin = ReturnType<typeof adminClient>;
interface RoomRow {
  id: string; host_id: string; code: string; channel_epoch: string; status: "open" | "ended";
  duration_minutes: number; idle_timeout_minutes: number;
  created_at: string; expires_at: string; last_activity_at: string; ended_at: string | null; end_reason: string | null;
}
interface MemberRow { room_id: string; user_id: string; nickname: string; color: string; role: "host" | "guest"; status: string; requested_at: string; plan_checked_at: string; }

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function randomEpoch(): string {
  return crypto.randomUUID().replaceAll("-", "");
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

function channelTopic(room: RoomRow): string {
  return `mt:${room.id}:${room.channel_epoch}`;
}

async function hasMultiTester(admin: Admin, userId: string): Promise<boolean> {
  const { features } = await resolveAccess(admin, userId);
  return features[FEATURE_KEY] === true;
}

async function requireMultiTester(admin: Admin, userId: string): Promise<void> {
  if (!await hasMultiTester(admin, userId)) throw new ApiError(403, "plan_required");
}

async function endRoom(admin: Admin, room: RoomRow, reason: "host" | "expired" | "idle" | "plan"): Promise<RoomRow> {
  // A fresh random code replaces the old one, so a shared code dies with its session, and a new epoch
  // drops every socket still on the room's topic.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await admin.from("mt_rooms")
      .update({ status: "ended", ended_at: new Date().toISOString(), end_reason: reason, code: randomCode(), channel_epoch: randomEpoch() })
      .eq("id", room.id).eq("status", "open").select().maybeSingle();
    if (!error) return (data as RoomRow | null) ?? { ...room, status: "ended", end_reason: reason };
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
  const active = me.status === "active" && room.status === "open";
  const base = {
    room: { id: room.id, status: room.status, endReason: room.end_reason, code: null as string | null, channel: null as string | null, expiresAt: room.expires_at, idleTimeoutMinutes: room.idle_timeout_minutes, durationMinutes: room.duration_minutes },
    me: { userId, role: me.role, status: me.status },
    members: [] as Array<{ userId: string; nickname: string; color: string; role: string; status: string }>,
    maxMembers: MAX_ACTIVE_MEMBERS,
  };
  // Someone pending, removed, rejected or gone learns only their own status: no member list, no
  // channel, no code.
  if (!active) return base;
  base.room.channel = channelTopic(room);
  // Only the host ever sees the code (only the host invites).
  if (isHost) base.room.code = room.code;
  base.members = members
    .filter((member) => isHost ? ["active", "pending"].includes(member.status) : member.status === "active")
    .map((member) => ({ userId: member.user_id, nickname: member.nickname, color: member.color, role: member.role, status: member.status }));
  return base;
}

async function requireHostRoom(admin: Admin, roomId: string, userId: string): Promise<RoomRow> {
  const room = await loadRoom(admin, roomId);
  if (room.host_id !== userId) throw new ApiError(403, "host_only");
  if (room.status !== "open") throw new ApiError(409, "room_ended");
  return room;
}

async function setMemberStatus(admin: Admin, roomId: string, userId: string, fromStatuses: string[], toStatus: string): Promise<void> {
  const { error } = await admin.rpc("mt_set_member_status", {
    target_room: roomId, target_user: userId, from_statuses: fromStatuses, to_status: toStatus, max_active: MAX_ACTIVE_MEMBERS,
  });
  if (!error) return;
  for (const code of ["room_full", "room_ended", "status_changed"]) {
    if (error.message?.includes(code)) throw new ApiError(409, code);
  }
  throw new Error("Could not update member");
}

// Plans can lapse mid-session: re-validated every PLAN_RECHECK_MS for the caller. A lapsed host
// ends the room; a lapsed guest is removed (which also rotates the channel epoch).
async function recheckPlan(admin: Admin, room: RoomRow, member: MemberRow): Promise<RoomRow> {
  if (room.status !== "open" || member.status !== "active" || Date.now() - Date.parse(member.plan_checked_at) < PLAN_RECHECK_MS) return room;
  if (await hasMultiTester(admin, member.user_id)) {
    await admin.from("mt_members").update({ plan_checked_at: new Date().toISOString() }).eq("room_id", room.id).eq("user_id", member.user_id);
    return room;
  }
  if (member.role === "host") return endRoom(admin, room, "plan");
  await setMemberStatus(admin, room.id, member.user_id, ["active"], "removed").catch(() => {});
  return loadRoom(admin, room.id);
}

async function broadcastChat(room: RoomRow, payload: Record<string, unknown>): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !key) throw new Error("Realtime is not configured");
  const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: channelTopic(room), event: "chat", payload, private: true }] }),
  });
  if (!response.ok) throw new Error("Could not publish chat");
}

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  const input = await readJson(request);
  const action = String(field(input, "action") ?? "");
  const admin = adminClient();
  // Separate budgets: touch/state are polled while a session runs, chat is conversational, the rest
  // are human decisions.
  const budget = ["touch", "state"].includes(action) ? ["multi-tester-poll", 2_000] : action === "chat" ? ["multi-tester-chat", 600] : ["multi-tester-action", 120];
  await enforceRateLimit(user.id, budget[0] as string, budget[1] as number, 3_600);

  if (action === "create") {
    await requireMultiTester(admin, user.id);
    const durationMinutes = boundedInteger(field(input, "durationMinutes"), 5, 480, 60);
    const idleTimeoutMinutes = boundedInteger(field(input, "idleTimeoutMinutes"), 2, 120, 10);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: existing } = await admin.from("mt_rooms").select("*").eq("host_id", user.id).eq("status", "open").maybeSingle();
      if (existing) {
        const current = await freshRoom(admin, existing as RoomRow);
        if (current.status === "open") return jsonResponse(request, await roomState(admin, current, user.id));
      }
      const { data: room, error } = await admin.from("mt_rooms").insert({
        host_id: user.id,
        code: randomCode(),
        duration_minutes: durationMinutes,
        idle_timeout_minutes: idleTimeoutMinutes,
        expires_at: new Date(Date.now() + durationMinutes * 60_000).toISOString(),
      }).select().single();
      // 23505 is either a code collision or a concurrent create by the same host (one open room per
      // host): loop, and the next pass returns the room the other request just opened.
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
        role: "guest", status: "pending", requested_at: new Date().toISOString(), decided_at: null, plan_checked_at: new Date().toISOString(),
      });
      if (error) throw new Error("Could not request entry");
    }
    return jsonResponse(request, await roomState(admin, room, user.id));
  }

  const roomId = uuid(field(input, "roomId"));

  if (action === "state" || action === "touch") {
    let room = await loadRoom(admin, roomId);
    const { data: member } = await admin.from("mt_members").select("*").eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
    if (!member) throw new ApiError(404, "room_not_found");
    room = await recheckPlan(admin, room, member as MemberRow);
    if (action === "touch" && room.status === "open" && member.status === "active") {
      await admin.from("mt_rooms").update({ last_activity_at: new Date().toISOString() }).eq("id", roomId).eq("status", "open");
    }
    return jsonResponse(request, await roomState(admin, room, user.id));
  }

  if (action === "chat") {
    const room = await loadRoom(admin, roomId);
    const { data: member } = await admin.from("mt_members").select("status").eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
    if (room.status !== "open" || member?.status !== "active") throw new ApiError(403, "not_allowed");
    const text = String(field(input, "text") ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 500);
    if (!text) throw new ApiError(400, "invalid_message");
    // The sender comes from the verified JWT, never from the request body.
    await broadcastChat(room, { from: user.id, text, at: new Date().toISOString() });
    await admin.from("mt_rooms").update({ last_activity_at: new Date().toISOString() }).eq("id", roomId).eq("status", "open");
    return jsonResponse(request, { sent: true });
  }

  if (action === "approve" || action === "reject" || action === "remove") {
    const room = await requireHostRoom(admin, roomId, user.id);
    const targetId = uuid(field(input, "userId"));
    if (targetId === user.id) throw new ApiError(400, "invalid_target");
    if (action === "approve") {
      // Plans can lapse between the request and the approval.
      if (!await hasMultiTester(admin, targetId)) throw new ApiError(409, "guest_plan_required");
      await setMemberStatus(admin, roomId, targetId, ["pending"], "active");
    } else if (action === "reject") {
      await setMemberStatus(admin, roomId, targetId, ["pending"], "rejected");
    } else {
      await setMemberStatus(admin, roomId, targetId, ["pending", "active"], "removed");
    }
    return jsonResponse(request, await roomState(admin, await loadRoom(admin, room.id), user.id));
  }

  if (action === "leave") {
    const room = await loadRoom(admin, roomId);
    if (room.host_id === user.id) return jsonResponse(request, await roomState(admin, room.status === "open" ? await endRoom(admin, room, "host") : room, user.id));
    const { data: leftRows } = await admin.from("mt_members").update({ status: "left", decided_at: new Date().toISOString() })
      .eq("room_id", roomId).eq("user_id", user.id).in("status", ["pending", "active"]).select("user_id");
    // Leaving also moves the others to a new topic, so the departed socket hears nothing more.
    if (leftRows?.length && room.status === "open") await admin.from("mt_rooms").update({ channel_epoch: randomEpoch() }).eq("id", roomId).eq("status", "open");
    return jsonResponse(request, await roomState(admin, room, user.id));
  }

  if (action === "end") {
    const room = await requireHostRoom(admin, roomId, user.id);
    return jsonResponse(request, await roomState(admin, await endRoom(admin, room, "host"), user.id));
  }

  throw new ApiError(400, "invalid_action");
});
