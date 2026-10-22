import { getSession } from "./auth.js";

// Multi Testador live channel (docs/adr/0003-multi-testador-sessao-colaborativa.md, decision D3).
// The ONE place the extension talks to Supabase directly instead of through an Edge Function: a
// Supabase Realtime private channel `mt:<room id>`, authorized by RLS (public.mt_can_use_channel)
// with the user's own JWT, so only active members of an open room can send or receive.
//
// Why here and not in the page: a WebSocket opened by a content script is subject to the TESTED
// site's CSP (connect-src), which many sites lock down. The service worker is extension-origin, so
// it always can. Tabs talk to it over a long-lived chrome.runtime Port ("qts-mt"); an open Port
// plus the 25s heartbeat keeps the worker alive while a session runs (Chrome 116+ keeps a worker
// with an active WebSocket alive as long as it exchanges messages within 30s).
//
// Protocol: Phoenix channels v1.0.0 JSON, which is what supabase-js speaks under the hood; written
// natively here because the extension has no bundler and MV3 forbids remote code (rule 3: no new
// dependency for ~150 lines of protocol).

const REALTIME_URL = "wss://xhusvkylbouwtpcevgri.supabase.co/realtime/v1/websocket";
// Public "anon" key of the project: designed to ship in clients, it carries no privilege by itself
// (every table the extension could reach revokes anon; the channel is gated by RLS on the user JWT).
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhodXN2a3lsYm91d3RwY2V2Z3JpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDg4MTQsImV4cCI6MjA5OTgyNDgxNH0.nVE2G8JSgsFwkQb6bYXArFayzKfU1ccJfW6YqVS66UA";
// 25s: under the 30s window in which Chrome must see WebSocket traffic to keep the worker alive,
// and under Phoenix's own 60s server timeout.
const HEARTBEAT_MS = 25_000;
// Reconnect backoff caps at 30s so a dropped network does not hammer Realtime.
const RECONNECT_MAX_MS = 30_000;
// Events a tab may SEND over the channel. Chat and the consensus votes (vote-request, vote,
// vote-result) are deliberately absent: they go through the multi-tester Edge Function, which stamps
// the sender server-side (RLS rejects them from clients). A guest's `proposal` and the host's
// `proposal-done` only inform (the host still acts himself), so they ride the channel like cursors.
const SENDABLE_EVENTS = new Set(["cursor", "click", "proposal", "proposal-done"]);
// Events relayed to the tabs when received.
const RECEIVABLE_EVENTS = new Set(["cursor", "click", "chat", "proposal", "proposal-done", "vote-request", "vote", "vote-result"]);
const MAX_PAYLOAD_CHARS = 4_000;

const live = {
  socket: null,
  channel: null, // "mt:<room id>"
  me: null, // { userId, nickname, color }
  ref: 0,
  joinRef: null,
  joined: false,
  heartbeat: null,
  reconnectTimer: null,
  reconnectDelay: 1_000,
  // presence key -> metas. A Map, not a plain object: keys come off the network, and a key like
  // "__proto__" must never reach an object prototype.
  presence: new Map(),
  ports: new Set(),
  tokenRefresh: null,
};

// The smoke test runs a local fake Realtime server: Playwright can route a page's WebSocket but not
// one opened by the service worker. The override is honored ONLY for an unpacked install (Web Store
// installs always carry update_url) and ONLY for a loopback ws:// URL, so a published build can
// never be pointed anywhere else.
const REALTIME_TEST_OVERRIDE_KEY = "qtsMtRealtimeUrlForTests";
async function realtimeUrl() {
  if (chrome.runtime.getManifest().update_url) return REALTIME_URL;
  const override = (await chrome.storage.local.get(REALTIME_TEST_OVERRIDE_KEY))[REALTIME_TEST_OVERRIDE_KEY];
  return typeof override === "string" && /^ws:\/\/127\.0\.0\.1:\d{2,5}\/realtime\/v1\/websocket$/.test(override) ? override : REALTIME_URL;
}

function nextRef() {
  live.ref += 1;
  return String(live.ref);
}

function postToPorts(message) {
  for (const port of live.ports) {
    try { port.postMessage(message); } catch {}
  }
}

function send(event, payload, topic = `realtime:${live.channel}`) {
  if (live.socket?.readyState !== WebSocket.OPEN) return false;
  live.socket.send(JSON.stringify({ topic, event, payload, ref: nextRef(), join_ref: topic === "phoenix" ? null : live.joinRef }));
  return true;
}

function presenceMembers() {
  return [...live.presence.entries()].map(([userId, metas]) => ({ userId, nickname: String(metas?.[0]?.nickname || ""), color: String(metas?.[0]?.color || ""), url: String(metas?.[0]?.url || "") }));
}

function applyPresenceDiff(diff) {
  for (const [key, value] of Object.entries(diff?.leaves || {})) {
    const leaving = new Set((value?.metas || []).map((meta) => meta.phx_ref));
    const remaining = (live.presence.get(key) || []).filter((meta) => !leaving.has(meta.phx_ref));
    if (remaining.length) live.presence.set(key, remaining); else live.presence.delete(key);
  }
  for (const [key, value] of Object.entries(diff?.joins || {})) {
    live.presence.set(key, [...(live.presence.get(key) || []), ...(value?.metas || [])]);
  }
}

function stopTimers() {
  clearInterval(live.heartbeat);
  clearTimeout(live.reconnectTimer);
  clearInterval(live.tokenRefresh);
  live.heartbeat = null;
  live.reconnectTimer = null;
  live.tokenRefresh = null;
}

function closeSocket() {
  stopTimers();
  const socket = live.socket;
  live.socket = null;
  live.joined = false;
  live.presence = new Map();
  if (socket) {
    socket.onclose = null;
    try { socket.close(1000); } catch {}
  }
}

function scheduleReconnect() {
  if (!live.channel || !live.ports.size || live.reconnectTimer) return;
  live.reconnectTimer = setTimeout(() => {
    live.reconnectTimer = null;
    void connect();
  }, live.reconnectDelay);
  live.reconnectDelay = Math.min(RECONNECT_MAX_MS, live.reconnectDelay * 2);
}

async function connect() {
  closeSocket();
  if (!live.channel || !live.ports.size) return;
  const session = await getSession();
  if (!session) {
    postToPorts({ type: "status", state: "error", reason: "authentication_required" });
    return;
  }
  // Identity always from the authenticated session, never from what a tab claimed.
  live.me = { ...live.me, userId: session.user.id };
  postToPorts({ type: "status", state: "connecting" });
  const socket = new WebSocket(`${await realtimeUrl()}?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`);
  live.socket = socket;
  socket.onopen = () => {
    live.joinRef = nextRef();
    socket.send(JSON.stringify({
      topic: `realtime:${live.channel}`,
      event: "phx_join",
      payload: {
        config: { broadcast: { self: false, ack: false }, presence: { key: live.me.userId }, private: true },
        access_token: session.accessToken,
      },
      ref: live.joinRef,
      join_ref: live.joinRef,
    }));
    live.heartbeat = setInterval(() => send("heartbeat", {}, "phoenix"), HEARTBEAT_MS);
    // The JWT expires (auth.js refreshes it a minute early); hand Realtime the fresh one so the
    // channel is not kicked mid-session. Checked every 4 minutes, well inside the shortest TTL.
    live.tokenRefresh = setInterval(async () => {
      const fresh = await getSession();
      if (fresh) send("access_token", { access_token: fresh.accessToken });
    }, 240_000);
  };
  socket.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.topic !== `realtime:${live.channel}`) return;
    if (message.event === "phx_reply" && message.ref === live.joinRef) {
      if (message.payload?.status === "ok") {
        live.joined = true;
        live.reconnectDelay = 1_000;
        send("presence", { type: "presence", event: "track", payload: { nickname: live.me.nickname, color: live.me.color, url: live.me.url || "" } });
        postToPorts({ type: "status", state: "joined" });
      } else {
        // Rejected by RLS: removed from the room, room ended or plan lapsed. Never retry blindly.
        postToPorts({ type: "status", state: "denied", reason: String(message.payload?.response?.reason || "unauthorized").slice(0, 200) });
        live.channel = null;
        closeSocket();
      }
      return;
    }
    if (message.event === "presence_state") {
      live.presence = new Map(Object.entries(message.payload || {}).map(([key, value]) => [key, value?.metas || []]));
      postToPorts({ type: "presence", members: presenceMembers() });
      return;
    }
    if (message.event === "presence_diff") {
      applyPresenceDiff(message.payload);
      postToPorts({ type: "presence", members: presenceMembers() });
      return;
    }
    if (message.event === "broadcast" && RECEIVABLE_EVENTS.has(message.payload?.event)) {
      postToPorts({ type: "broadcast", event: message.payload.event, payload: message.payload.payload });
      return;
    }
    if (message.event === "phx_error" || message.event === "phx_close" || message.event === "system" && message.payload?.status === "error") {
      postToPorts({ type: "status", state: "reconnecting" });
      closeSocket();
      scheduleReconnect();
    }
  };
  socket.onerror = () => {};
  socket.onclose = () => {
    live.joined = false;
    postToPorts({ type: "status", state: "reconnecting" });
    stopTimers();
    live.socket = null;
    scheduleReconnect();
  };
}

function leave() {
  if (live.joined) send("phx_leave", {});
  live.channel = null;
  live.me = null;
  closeSocket();
}

function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

// Tabs connect with chrome.runtime.connect({ name: "qts-mt" }). Only the extension's own content
// script can open this Port (externally_connectable does not cover runtime.connect from pages), and
// `authorize` applies the same active-access + authorized-page gate as the runtime messages.
export function handleMultiTesterPort(port, authorize) {
  if (port.name !== "qts-mt" || port.sender?.id !== chrome.runtime.id || !port.sender?.tab?.id) return false;
  const authorized = Promise.resolve(authorize(port.sender)).catch(() => false);
  live.ports.add(port);
  port.onDisconnect.addListener(() => {
    live.ports.delete(port);
    // Last tab gone: drop the socket so the worker can sleep. A reloaded tab reconnects and rejoins.
    if (!live.ports.size) closeSocket();
  });
  port.onMessage.addListener(async (message) => {
    if (!message || typeof message !== "object") return;
    if (!await authorized) {
      try { port.postMessage({ type: "status", state: "denied", reason: "authentication_required" }); } catch {}
      return;
    }
    if (message.type === "join") {
      const channel = String(message.channel || "");
      if (!/^mt:[0-9a-f-]{36}:[0-9a-f]{32}$/i.test(channel)) return;
      const me = { userId: cleanText(message.me?.userId, 64), nickname: cleanText(message.me?.nickname, 40), color: /^#[0-9a-f]{6}$/i.test(message.me?.color) ? message.me.color : "#5b35e8", url: cleanText(message.me?.url, 300) };
      if (live.channel === channel && live.socket) {
        live.me = me;
        if (live.joined) {
          send("presence", { type: "presence", event: "track", payload: { nickname: me.nickname, color: me.color, url: me.url } });
          port.postMessage({ type: "status", state: "joined" });
          port.postMessage({ type: "presence", members: presenceMembers() });
        }
        return;
      }
      live.channel = channel;
      live.me = me;
      live.reconnectDelay = 1_000;
      void connect();
      return;
    }
    if (message.type === "broadcast" && live.joined && SENDABLE_EVENTS.has(message.event)) {
      const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
      if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) return;
      // The sender id is stamped here, from the joined identity, never taken from the tab.
      send("broadcast", { type: "broadcast", event: message.event, payload: { ...payload, from: live.me.userId } });
      return;
    }
    if (message.type === "leave") leave();
  });
  return true;
}
