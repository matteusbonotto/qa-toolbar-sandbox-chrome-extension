// Local mock of the Supabase Edge Functions (supabase/functions/*/index.ts), used ONLY so the
// security and load suites can be verified on a machine without Docker / without a test project.
// It is an emulation of the documented contracts (validation order, status codes, error codes,
// CORS/security headers, rate limits, Multi Testador room rules), not the real Deno code: a green
// run against this mock proves the SUITE works, never that production behaves the same. Run the
// same suites against a separate Supabase test project for that (docs/testing-strategy.md).
//
// CLI: node scripts/backend-security/mock-edge-server.mjs [--port=0] [--extra-rm-users=N]
//        [--faults=a,b] [--latency-ms=N]
// Prints one JSON line on stdout: { "url": ..., "identities": {...}, "allowedOrigin": ... }.
//
// --faults injects deliberate vulnerabilities so run-security.mjs can prove the suite FAILS when
// the target is unsafe (mutation self-check). Never used in the normal green run.

import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ADMIN_EMAIL, ANY_UUID, BODY_LIMITS, CHALLENGE_ID, COLOR, MFA_TOKEN, OTP, PLAN_KEY, RATE_LIMITS,
  REFERRAL_CODE, REQUEST_ID, ROOM_CODE, VOUCHER_CODE, ZOD_EMAIL,
} from "./contracts.mjs";

export const MOCK_ALLOWED_ORIGIN = "https://allowed-origin.qts.test";
export const MOCK_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
export const KNOWN_FAULTS = ["host-check", "stack-leak", "cors-reflect", "null-body-500", "removed-sees-channel", "no-size-limit", "sqli-500"];

const SECURITY_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ACTIVE_MEMBERS = 4;

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// rateLimitScale multiplies every quota. The security suite runs with a large scale so its ~1000
// hostile requests exercise validation instead of collapsing into 429 after the 5th request; the
// load suite runs at scale 1 so it observes the real quotas (auth-sign-in 429 after 10 attempts).
export function createMockBackend({ extraReleaseManagerUsers = 0, faults = [], latencyMs = 0, rateLimitScale = 1, disableRateLimit = false } = {}) {
  const fault = new Set(faults);
  const jwtSecret = randomBytes(32);
  const webhookSecret = randomBytes(24).toString("hex");
  const keepAliveSecret = randomBytes(24).toString("hex");
  const users = new Map(); // id -> user
  const refreshTokens = new Map(); // refresh token -> user id
  const rateBuckets = new Map();
  const rooms = new Map(); // id -> room
  const members = new Map(); // room id -> Map(user id -> member)
  const challenges = new Map();

  function addUser(label, { plan = null, founder = false, email } = {}) {
    const id = randomUUID();
    const user = {
      id, label, email: email ?? `${label}.${id.slice(0, 8)}@mock.qts.test`,
      password: `pw-${randomBytes(12).toString("hex")}`, plan, founder, deleted: false,
      grantRevoked: false,
    };
    users.set(id, user);
    return user;
  }

  function issueSession(user, { expiresInSeconds = 3_600 } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64url(JSON.stringify({
      sub: user.id, email: user.email, role: "authenticated", exp: now + expiresInSeconds,
      amr: [{ method: "password", timestamp: now }],
    }));
    const signature = b64url(createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest());
    const refreshToken = randomBytes(24).toString("base64url");
    refreshTokens.set(refreshToken, user.id);
    return { accessToken: `${header}.${payload}.${signature}`, refreshToken, expiresAt: now + expiresInSeconds, user: { id: user.id, email: user.email } };
  }

  function verifyToken(token) {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let header;
    let payload;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (header?.alg !== "HS256") return null;
    const expected = createHmac("sha256", jwtSecret).update(`${parts[0]}.${parts[1]}`).digest();
    const received = Buffer.from(parts[2], "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    if (typeof payload?.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    const user = users.get(payload.sub);
    if (!user || user.deleted) return null;
    return { user, claims: payload };
  }

  // Same shape as _shared/auth.ts authenticatedContext().
  function authenticated(headers) {
    const token = String(headers.authorization ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new ApiError(401, "authentication_required");
    const context = verifyToken(token);
    if (!context) throw new ApiError(401, "invalid_session");
    return context;
  }

  // Mirrors _shared/auth.ts clientRateSubject: the first x-forwarded-for hop, else the socket.
  function clientSubject(ctx) {
    return `ip:${String(ctx.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || ctx.remoteAddress || "unknown"}`;
  }

  function enforceRateLimit(subject, action) {
    const [maximum, windowSeconds] = RATE_LIMITS[action];
    const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `${sha256(`${action}:${subject}`)}:${windowStart}`;
    const next = (rateBuckets.get(key) ?? 0) + 1;
    rateBuckets.set(key, next);
    if (!disableRateLimit && next > maximum * rateLimitScale) throw new ApiError(429, "rate_limit_exceeded");
  }

  function features(user) {
    if (user.grantRevoked || !user.plan) return {};
    return user.plan === "release-manager" ? { "multiTester.enabled": true } : { "multiTester.enabled": false };
  }

  function hasMultiTester(userId) {
    const user = users.get(userId);
    return Boolean(user && !user.deleted && features(user)["multiTester.enabled"] === true);
  }

  function strictObject(value, shape) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    for (const key of Object.keys(value)) if (!(key in shape)) return null;
    const output = {};
    for (const [key, check] of Object.entries(shape)) {
      const result = check(value[key]);
      if (result === undefined) return null;
      output[key] = result;
    }
    return output;
  }
  const zodString = (min, max) => (value) => (typeof value === "string" && value.length >= min && value.length <= max ? value : undefined);
  const zodEmail = (value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return ZOD_EMAIL.test(trimmed) && trimmed.length <= 254 ? trimmed : undefined;
  };
  const field = (input, key) => (typeof input === "object" && input !== null && key in input ? input[key] : undefined);

  function maybeSqlFault(...values) {
    if (fault.has("sqli-500") && values.some((value) => typeof value === "string" && value.includes("'"))) {
      throw Object.assign(new Error(`syntax error at or near "${String(values[0]).slice(0, 20)}" SQLSTATE 42601`), { leak: true });
    }
  }

  // ---------------------------------------------------------------- Multi Testador emulation
  function randomCode() {
    for (;;) {
      const code = [...randomBytes(8)].map((byte) => CODE_ALPHABET[byte & 31]).join("");
      if (![...rooms.values()].some((room) => room.code === code)) return code;
    }
  }
  const randomEpoch = () => randomUUID().replaceAll("-", "");
  const cleanNickname = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "Testador";
  const cleanColor = (value) => (COLOR.test(String(value ?? "")) ? String(value) : "#5b35e8");
  const boundedInteger = (value, minimum, maximum, fallback) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  };
  const uuid = (value) => {
    const text = String(value ?? "");
    if (!ANY_UUID.test(text)) throw new ApiError(400, "invalid_id");
    return text;
  };
  function endRoom(room, reason) {
    if (room.status === "open") Object.assign(room, { status: "ended", ended_at: new Date().toISOString(), end_reason: reason, code: randomCode(), channel_epoch: randomEpoch() });
    return room;
  }
  function freshRoom(room) {
    if (room.status !== "open") return room;
    const now = Date.now();
    if (Date.parse(room.expires_at) <= now) return endRoom(room, "expired");
    if (Date.parse(room.last_activity_at) + room.idle_timeout_minutes * 60_000 <= now) return endRoom(room, "idle");
    return room;
  }
  function loadRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) throw new ApiError(404, "room_not_found");
    return freshRoom(room);
  }
  function roomState(room, userId) {
    const list = [...(members.get(room.id)?.values() ?? [])].sort((a, b) => a.requested_at.localeCompare(b.requested_at));
    const me = list.find((member) => member.user_id === userId);
    if (!me) throw new ApiError(404, "room_not_found");
    const isHost = room.host_id === userId;
    const active = (me.status === "active" || (fault.has("removed-sees-channel") && me.status === "removed")) && room.status === "open";
    const base = {
      room: { id: room.id, status: room.status, endReason: room.end_reason, code: null, channel: null, expiresAt: room.expires_at, idleTimeoutMinutes: room.idle_timeout_minutes, durationMinutes: room.duration_minutes },
      me: { userId, role: me.role, status: me.status },
      members: [],
      maxMembers: MAX_ACTIVE_MEMBERS,
    };
    if (!active) return base;
    base.room.channel = `mt:${room.id}:${room.channel_epoch}`;
    if (isHost) base.room.code = room.code;
    base.members = list
      .filter((member) => (isHost ? ["active", "pending"].includes(member.status) : member.status === "active"))
      .map((member) => ({ userId: member.user_id, nickname: member.nickname, color: member.color, role: member.role, status: member.status }));
    return base;
  }
  function requireHostRoom(roomId, userId) {
    const room = loadRoom(roomId);
    if (room.host_id !== userId && !fault.has("host-check")) throw new ApiError(403, "host_only");
    if (room.status !== "open") throw new ApiError(409, "room_ended");
    return room;
  }
  // Mirrors public.mt_set_member_status (schema.sql): room locked, cap enforced, from-status checked.
  function setMemberStatus(roomId, userId, fromStatuses, toStatus) {
    const room = rooms.get(roomId);
    if (!room || room.status !== "open") throw new ApiError(409, "room_ended");
    const roomMembers = members.get(roomId) ?? new Map();
    if (toStatus === "active" && [...roomMembers.values()].filter((member) => member.status === "active").length >= MAX_ACTIVE_MEMBERS) {
      throw new ApiError(409, "room_full");
    }
    const target = roomMembers.get(userId);
    if (!target || !fromStatuses.includes(target.status)) throw new ApiError(409, "status_changed");
    target.status = toStatus;
    target.decided_at = new Date().toISOString();
    if (toStatus === "removed") room.channel_epoch = randomEpoch();
  }

  async function multiTester(ctx) {
    const { user } = authenticated(ctx.headers);
    const input = await ctx.readJson(16_384);
    const action = String(field(input, "action") ?? "");
    const budget = ["touch", "state"].includes(action) ? "multi-tester-poll" : action === "chat" ? "multi-tester-chat" : "multi-tester-action";
    enforceRateLimit(user.id, budget);

    if (action === "create") {
      if (!hasMultiTester(user.id)) throw new ApiError(403, "plan_required");
      const existing = [...rooms.values()].find((room) => room.host_id === user.id && room.status === "open");
      if (existing && freshRoom(existing).status === "open") return roomState(existing, user.id);
      const durationMinutes = boundedInteger(field(input, "durationMinutes"), 5, 480, 60);
      const idleTimeoutMinutes = boundedInteger(field(input, "idleTimeoutMinutes"), 2, 120, 10);
      const now = new Date().toISOString();
      const room = {
        id: randomUUID(), host_id: user.id, code: randomCode(), channel_epoch: randomEpoch(), status: "open",
        duration_minutes: durationMinutes, idle_timeout_minutes: idleTimeoutMinutes, created_at: now,
        expires_at: new Date(Date.now() + durationMinutes * 60_000).toISOString(), last_activity_at: now, ended_at: null, end_reason: null,
      };
      rooms.set(room.id, room);
      members.set(room.id, new Map([[user.id, {
        room_id: room.id, user_id: user.id, nickname: cleanNickname(field(input, "nickname")), color: cleanColor(field(input, "color")),
        role: "host", status: "active", requested_at: now, decided_at: now, plan_checked_at: now,
      }]]));
      return roomState(room, user.id);
    }

    if (action === "request") {
      if (!hasMultiTester(user.id)) throw new ApiError(403, "plan_required");
      const code = String(field(input, "code") ?? "").trim().toUpperCase();
      if (!ROOM_CODE.test(code)) throw new ApiError(400, "invalid_code");
      const found = [...rooms.values()].find((room) => room.code === code && room.status === "open");
      if (!found) throw new ApiError(404, "room_not_found");
      const room = freshRoom(found);
      if (room.status !== "open") throw new ApiError(404, "room_not_found");
      if (room.host_id === user.id) return roomState(room, user.id);
      const roomMembers = members.get(room.id);
      const member = roomMembers.get(user.id);
      if (member && ["removed", "rejected"].includes(member.status)) throw new ApiError(403, "not_allowed");
      if (!member || member.status === "left") {
        const now = new Date().toISOString();
        roomMembers.set(user.id, {
          room_id: room.id, user_id: user.id, nickname: cleanNickname(field(input, "nickname")), color: cleanColor(field(input, "color")),
          role: "guest", status: "pending", requested_at: now, decided_at: null, plan_checked_at: now,
        });
      }
      return roomState(room, user.id);
    }

    const roomId = uuid(field(input, "roomId"));

    if (action === "state" || action === "touch") {
      const room = loadRoom(roomId);
      const member = members.get(roomId)?.get(user.id);
      if (!member) throw new ApiError(404, "room_not_found");
      if (action === "touch" && room.status === "open" && member.status === "active") room.last_activity_at = new Date().toISOString();
      return roomState(room, user.id);
    }

    if (action === "chat") {
      const room = loadRoom(roomId);
      const member = members.get(roomId)?.get(user.id);
      if (room.status !== "open" || member?.status !== "active") throw new ApiError(403, "not_allowed");
      const text = String(field(input, "text") ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 500);
      if (!text) throw new ApiError(400, "invalid_message");
      room.last_activity_at = new Date().toISOString();
      return { sent: true };
    }

    if (["approve", "reject", "remove"].includes(action)) {
      const room = requireHostRoom(roomId, user.id);
      const targetId = uuid(field(input, "userId"));
      if (targetId === user.id) throw new ApiError(400, "invalid_target");
      if (action === "approve") {
        if (!hasMultiTester(targetId)) throw new ApiError(409, "guest_plan_required");
        setMemberStatus(roomId, targetId, ["pending"], "active");
      } else if (action === "reject") {
        setMemberStatus(roomId, targetId, ["pending"], "rejected");
      } else {
        setMemberStatus(roomId, targetId, ["pending", "active"], "removed");
      }
      return roomState(loadRoom(room.id), user.id);
    }

    if (action === "leave") {
      const room = loadRoom(roomId);
      if (room.host_id === user.id) return roomState(room.status === "open" ? endRoom(room, "host") : room, user.id);
      const member = members.get(roomId)?.get(user.id);
      if (member && ["pending", "active"].includes(member.status)) {
        member.status = "left";
        member.decided_at = new Date().toISOString();
        if (room.status === "open") room.channel_epoch = randomEpoch();
      }
      return roomState(room, user.id);
    }

    if (action === "end") {
      const room = requireHostRoom(roomId, user.id);
      return roomState(endRoom(room, "host"), user.id);
    }

    throw new ApiError(400, "invalid_action");
  }

  // ---------------------------------------------------------------- other functions
  const handlers = {
    async "access-status"(ctx) {
      const { user } = authenticated(ctx.headers);
      enforceRateLimit(user.id, "access-status");
      const active = Boolean(user.plan) && !user.grantRevoked;
      return {
        active, plan: active ? { key: user.plan, name: user.plan } : null, source: active ? "manual" : null, expiresAt: null,
        billing: null, features: features(user), token: "mock-signed-entitlement", installUrl: active ? "https://chromewebstore.google.com/detail/mock" : null,
        checkedAt: new Date().toISOString(),
      };
    },
    async "account-delete"(ctx) {
      const { user } = authenticated(ctx.headers);
      enforceRateLimit(user.id, "account-delete");
      const parsed = strictObject(await ctx.readJson(4_096), { password: zodString(8, 200) });
      if (!parsed) throw new ApiError(400, "invalid_request");
      maybeSqlFault(parsed.password);
      if (parsed.password !== user.password) throw new ApiError(401, "invalid_password");
      user.deleted = true;
      return { deleted: true };
    },
    async "auth-recover-password"(ctx) {
      const parsed = strictObject(await ctx.readJson(2_048), { email: zodEmail });
      if (!parsed) throw new ApiError(400, "invalid_request");
      enforceRateLimit(parsed.email.toLowerCase(), "auth-recover-password");
      enforceRateLimit(clientSubject(ctx), "auth-recover-password-client");
      return { sent: true };
    },
    async "auth-refresh"(ctx) {
      const parsed = strictObject(await ctx.readJson(8_192), { refreshToken: zodString(1, 4_096) });
      if (!parsed) throw new ApiError(400, "invalid_request");
      enforceRateLimit(sha256(parsed.refreshToken), "auth-refresh");
      maybeSqlFault(parsed.refreshToken);
      const userId = refreshTokens.get(parsed.refreshToken);
      const user = userId ? users.get(userId) : null;
      if (!user || user.deleted) throw new ApiError(401, "refresh_failed");
      refreshTokens.delete(parsed.refreshToken);
      return issueSession(user);
    },
    async "auth-sign-in"(ctx) {
      const parsed = strictObject(await ctx.readJson(8_192), { email: zodEmail, password: zodString(8, 200) });
      if (!parsed) throw new ApiError(400, "invalid_credentials");
      const email = parsed.email.toLowerCase();
      enforceRateLimit(`${clientSubject(ctx)}:${email}`, "auth-sign-in");
      enforceRateLimit(clientSubject(ctx), "auth-sign-in-client");
      enforceRateLimit(email, "auth-sign-in-account");
      maybeSqlFault(parsed.password, email);
      const user = [...users.values()].find((candidate) => candidate.email.toLowerCase() === email && !candidate.deleted);
      if (!user || user.password !== parsed.password) throw new ApiError(401, "authentication_failed");
      return issueSession(user);
    },
    async "cancel-access"(ctx) {
      const { user } = authenticated(ctx.headers);
      enforceRateLimit(user.id, "cancel-access");
      if (!user.plan || user.grantRevoked) throw new ApiError(409, "nothing_to_cancel");
      user.grantRevoked = true;
      return { canceled: true, mode: "immediate" };
    },
    async "checkout-create-session"(ctx) {
      const { user } = authenticated(ctx.headers);
      enforceRateLimit(user.id, "checkout-create-session");
      const value = await ctx.readJson(16_384);
      if (!value || typeof value !== "object") throw new ApiError(400, "invalid_request");
      const planKey = String(value.planKey ?? "");
      const billingCycle = String(value.billingCycle ?? "");
      const requestId = String(value.requestId ?? "");
      const referralCode = value.referralCode ? String(value.referralCode).trim().toUpperCase() : undefined;
      const voucherCode = value.voucherCode ? String(value.voucherCode).trim().toUpperCase() : undefined;
      maybeSqlFault(planKey, billingCycle, requestId, value.referralCode, value.voucherCode);
      if (!PLAN_KEY.test(planKey) || !["monthly", "yearly"].includes(billingCycle) || !REQUEST_ID.test(requestId)
        || (referralCode && !REFERRAL_CODE.test(referralCode)) || (voucherCode && !VOUCHER_CODE.test(voucherCode))) {
        throw new ApiError(400, "invalid_request");
      }
      if (!["smoke-test", "regression-runner", "root-cause-analyst", "release-manager"].includes(planKey)) throw new ApiError(404, "plan_not_found");
      if (voucherCode) throw new ApiError(409, "voucher_unavailable");
      return { checkoutUrl: `https://checkout.stripe.com/c/pay/mock_${requestId}` };
    },
    async "keep-alive"(ctx) {
      const received = createHash("sha256").update(String(ctx.headers["x-keep-alive-secret"] ?? "")).digest();
      const expected = createHash("sha256").update(keepAliveSecret).digest();
      if (!timingSafeEqual(received, expected)) throw new ApiError(401, "unauthorized");
      enforceRateLimit("scheduler", "keep-alive");
      return { ok: true, checkedAt: new Date().toISOString() };
    },
    async "legal-registration"() {
      return {
        available: true, status: "protocolado", softwareName: "QA Toolbar Sandbox", holderName: "Mock Holder",
        protocolNumber: null, protocolDate: null, registrationNumber: null, grantDate: null, publicQueryUrl: null,
        publicNotice: null, updatedAt: new Date(0).toISOString(),
      };
    },
    async "referral-track"(ctx) {
      const { user } = authenticated(ctx.headers);
      enforceRateLimit(user.id, "referral-track");
      const input = await ctx.readJson(16_384);
      maybeSqlFault(field(input, "referralCode"));
      const code = typeof input === "object" && input !== null && "referralCode" in input ? String(input.referralCode).trim().toUpperCase() : "";
      if (!REFERRAL_CODE.test(code)) throw new ApiError(400, "invalid_referral_code");
      throw new ApiError(409, "referral_unavailable");
    },
    async "rewards-spin"(ctx) {
      const { user } = authenticated(ctx.headers);
      enforceRateLimit(user.id, "rewards-spin");
      const input = await ctx.readJson(16_384);
      maybeSqlFault(field(input, "requestId"));
      const requestId = typeof input === "object" && input !== null && "requestId" in input ? String(input.requestId) : "";
      if (!REQUEST_ID.test(requestId)) throw new ApiError(400, "invalid_request");
      throw new ApiError(409, "insufficient_reward_points");
    },
    async "voucher-preview"(ctx) {
      const input = await ctx.readJson(16_384);
      maybeSqlFault(field(input, "code"));
      const code = typeof input === "object" && input !== null && "code" in input ? String(input.code).trim().toUpperCase() : "";
      if (!VOUCHER_CODE.test(code)) return { valid: false, reason: "voucher_unavailable" };
      enforceRateLimit(sha256(code), "voucher-preview-code");
      enforceRateLimit(clientSubject(ctx), "voucher-preview-client");
      return { valid: false, reason: "voucher_unavailable" };
    },
    async "voucher-redeem"(ctx) {
      const { user } = authenticated(ctx.headers);
      enforceRateLimit(user.id, "voucher-redeem");
      const input = await ctx.readJson(16_384);
      maybeSqlFault(field(input, "code"));
      const code = typeof input === "object" && input !== null && "code" in input ? String(input.code).trim().toUpperCase() : "";
      if (!VOUCHER_CODE.test(code)) throw new ApiError(400, "invalid_voucher");
      throw new ApiError(409, "voucher_unavailable");
    },
    "multi-tester": multiTester,
  };

  // admin-email-otp: own Deno.serve (no origin check on POST), readJson BEFORE authentication, and
  // readJsonObject (null/array/primitive root -> 400 invalid_request).
  async function adminEmailOtp(ctx) {
    const parsed = await ctx.readJson(2_048);
    if (!fault.has("null-body-500") && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) throw new ApiError(400, "invalid_request");
    const body = parsed;
    if (body.action === "request") {
      const { user, claims } = authenticated(ctx.headers);
      if (user.email.toLowerCase() !== ADMIN_EMAIL) throw new ApiError(403, "admin_access_denied");
      const passwordAt = claims.amr?.find((entry) => entry.method === "password")?.timestamp ?? null;
      if (passwordAt === null || Date.now() / 1000 - passwordAt > 300) throw new ApiError(401, "recent_password_required");
      if (!user.founder) throw new ApiError(403, "admin_access_denied");
      enforceRateLimit(user.id, "admin-email-otp");
      const id = randomUUID();
      challenges.set(id, { userId: user.id, otp: String(Math.floor(Math.random() * 1e8)).padStart(8, "0"), expiresAt: Date.now() + 600_000 });
      return { challengeId: id, expiresAt: new Date(Date.now() + 600_000).toISOString() };
    }
    if (body.action === "verify") {
      const { user } = authenticated(ctx.headers);
      if (user.email.toLowerCase() !== ADMIN_EMAIL) throw new ApiError(403, "otp_verification_required");
      if (!user.founder) throw new ApiError(403, "admin_access_denied");
      enforceRateLimit(user.id, "admin-email-otp-verify");
      const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
      if (!CHALLENGE_ID.test(challengeId)) throw new ApiError(400, "invalid_challenge");
      const otp = typeof body.otp === "string" ? body.otp.trim() : "";
      if (!OTP.test(otp)) throw new ApiError(400, "invalid_otp");
      const challenge = challenges.get(challengeId);
      if (!challenge || challenge.userId !== user.id || challenge.otp !== otp || challenge.expiresAt < Date.now()) throw new ApiError(401, "invalid_or_expired_otp");
      challenges.delete(challengeId);
      return { mfaToken: randomBytes(32).toString("base64url"), expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    }
    if (body.action === "revoke") {
      authenticated(ctx.headers);
      const token = typeof body.mfaToken === "string" ? body.mfaToken.trim() : "";
      if (!MFA_TOKEN.test(token)) return { revoked: true };
      return { revoked: true };
    }
    throw new ApiError(400, "invalid_action");
  }

  function verifyStripeSignature(header, rawBody) {
    const parts = Object.fromEntries(String(header).split(",").map((item) => item.split("=")).filter((pair) => pair.length === 2));
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
    const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");
    return parts.v1.length === expected.length && timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  }

  // ---------------------------------------------------------------- HTTP plumbing (_shared/http.ts)
  function allowedOrigin(origin) {
    if (!origin) return null;
    if (fault.has("cors-reflect")) return origin;
    if (origin === MOCK_ALLOWED_ORIGIN) return origin;
    if (origin.startsWith("chrome-extension://")) {
      const id = origin.slice("chrome-extension://".length);
      if (/^[a-p]{32}$/.test(id) && id === MOCK_EXTENSION_ID) return origin;
    }
    return null;
  }
  function corsHeaders(origin) {
    const allowed = allowedOrigin(origin);
    return {
      ...(allowed ? { "access-control-allow-origin": allowed, vary: "Origin" } : {}),
      "access-control-allow-headers": "apikey, authorization, content-type, x-client-info, x-correlation-id, x-admin-mfa-token",
      "access-control-allow-methods": "POST, OPTIONS",
      ...SECURITY_HEADERS,
    };
  }

  async function handle(request, response) {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs)); // injected only via --latency-ms (load self-check)
    const url = new URL(request.url, "http://mock.local");
    const origin = request.headers.origin ?? null;
    const send = (status, body, headers = corsHeaders(origin)) => {
      const payload = body === null ? "" : JSON.stringify(body);
      response.writeHead(status, body === null ? headers : { ...headers, "content-type": "application/json; charset=utf-8" });
      response.end(payload);
    };
    const match = url.pathname.match(/^\/functions\/v1\/([a-z-]+)(?:\/.*)?$/);
    const name = match?.[1];
    if (!name || !(name in BODY_LIMITS)) {
      request.resume();
      return send(404, { error: "function_not_found" }, SECURITY_HEADERS);
    }

    // Body is buffered with a hard cap so a hostile client cannot exhaust the mock's memory.
    const chunks = [];
    let total = 0;
    let truncated = false;
    for await (const chunk of request) {
      total += chunk.length;
      if (total > 2_097_152) {
        truncated = true;
        break;
      }
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const ctx = {
      headers: request.headers,
      remoteAddress: request.socket.remoteAddress,
      async readJson(maximumBytes) {
        if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new ApiError(415, "content_type_required");
        const declared = Number(request.headers["content-length"] ?? "0");
        if (!fault.has("no-size-limit")) {
          if (Number.isFinite(declared) && declared > maximumBytes) throw new ApiError(413, "payload_too_large");
          if (truncated || Buffer.byteLength(rawBody, "utf8") > maximumBytes) throw new ApiError(413, "payload_too_large");
        }
        try {
          return JSON.parse(rawBody || "{}");
        } catch (error) {
          if (fault.has("stack-leak")) throw Object.assign(error, { leak: true });
          throw new ApiError(400, "invalid_json");
        }
      },
    };

    // Preflight (http.ts preflight()).
    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigin(origin)) return send(403, null, SECURITY_HEADERS);
      return send(204, null, corsHeaders(origin));
    }

    try {
      if (name === "stripe-webhook") {
        if (request.method !== "POST") return send(405, { error: "method_not_allowed" });
        const signature = request.headers["stripe-signature"];
        if (!signature) return send(400, { error: "signature_required" });
        if (truncated || Buffer.byteLength(rawBody, "utf8") > 1_048_576) return send(413, { error: "payload_too_large" });
        if (!verifyStripeSignature(signature, rawBody)) return send(400, { error: "invalid_signature" });
        return send(200, { received: true });
      }
      if (name === "admin-email-otp") {
        if (request.method !== "POST") throw new ApiError(405, "method_not_allowed");
        return send(200, await adminEmailOtp(ctx));
      }
      // handler.ts serve(): disallowed Origin on a real request is a 403 before the handler runs.
      if (origin && !allowedOrigin(origin)) return send(403, { error: "origin_not_allowed" });
      if (request.method !== "POST") throw new ApiError(405, "method_not_allowed");
      return send(200, await handlers[name](ctx));
    } catch (error) {
      if (error instanceof ApiError) return send(error.status, { error: error.code });
      if (error?.leak) {
        response.writeHead(500, { "content-type": "text/plain" });
        return response.end(`${error.message}\n${error.stack}`);
      }
      return send(500, { error: "internal_error" });
    }
  }

  // ---------------------------------------------------------------- identities
  const identityUsers = {
    plain: addUser("plain", { plan: "smoke-test" }),
    host: addUser("host", { plan: "release-manager" }),
    guests: [1, 2, 3, 4].map((index) => addUser(`guest${index}`, { plan: "release-manager" })),
    outsider: addUser("outsider", { plan: "release-manager" }),
    noPlan: addUser("noplan"),
    founder: addUser("founder", { founder: true, email: ADMIN_EMAIL }),
    loadUsers: Array.from({ length: extraReleaseManagerUsers }, (_, index) => addUser(`load${index}`, { plan: "release-manager" })),
  };
  function sessionFor(user) {
    return { ...issueSession(user), userId: user.id, email: user.email };
  }
  const identities = {
    plain: sessionFor(identityUsers.plain),
    host: sessionFor(identityUsers.host),
    guests: identityUsers.guests.map(sessionFor),
    outsider: sessionFor(identityUsers.outsider),
    noPlan: sessionFor(identityUsers.noPlan),
    founder: sessionFor(identityUsers.founder),
    loadUsers: identityUsers.loadUsers.map(sessionFor),
    // An expired but correctly signed token, so "expired" is tested against real verification.
    expiredToken: issueSession(identityUsers.plain, { expiresInSeconds: -60 }).accessToken,
  };

  return { handle, identities };
}

export async function startMockEdgeServer({ port = 0, ...options } = {}) {
  const backend = createMockBackend(options);
  const server = createServer((request, response) => {
    backend.handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "internal_error" }));
    });
  });
  server.keepAliveTimeout = 5_000; // short keep-alive so the runner can close the server promptly at the end of a run
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actualPort } = server.address();
  return {
    url: `http://127.0.0.1:${actualPort}`,
    identities: backend.identities,
    allowedOrigin: MOCK_ALLOWED_ORIGIN,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, fallback) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
  const faults = String(arg("faults", "")).split(",").map((item) => item.trim()).filter(Boolean);
  const unknown = faults.filter((item) => !KNOWN_FAULTS.includes(item));
  if (unknown.length) {
    console.error(`Unknown fault(s): ${unknown.join(", ")}. Known: ${KNOWN_FAULTS.join(", ")}`);
    process.exit(2);
  }
  const mock = await startMockEdgeServer({
    port: Number(arg("port", "0")),
    extraReleaseManagerUsers: Number(arg("extra-rm-users", "0")),
    faults,
    latencyMs: Number(arg("latency-ms", "0")),
    rateLimitScale: Math.max(1, Number(arg("rate-limit-scale", "1")) || 1),
    disableRateLimit: process.argv.includes("--disable-rate-limit"), // load self-check only: proves the 429 check can fail
  });
  process.stdout.write(`${JSON.stringify({ url: mock.url, identities: mock.identities, allowedOrigin: mock.allowedOrigin, rateLimitScale: Math.max(1, Number(arg("rate-limit-scale", "1")) || 1) })}\n`);
  const shutdown = () => mock.close().then(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.stdin.on("end", shutdown); // parent closed our stdin: exit instead of lingering as an orphan
  process.stdin.resume();
}
