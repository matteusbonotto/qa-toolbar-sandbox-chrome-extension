import { STORAGE_KEYS } from "../lib/storage.js";

const FUNCTIONS_BASE_URL = "https://xhusvkylbouwtpcevgri.supabase.co/functions/v1";
const ACCESS_CACHE_MS = 30_000;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validSession(value) {
  return isRecord(value)
    && typeof value.accessToken === "string" && value.accessToken.length >= 20 && value.accessToken.length <= 8_192
    && typeof value.refreshToken === "string" && value.refreshToken.length >= 1 && value.refreshToken.length <= 4_096
    && Number.isInteger(value.expiresAt) && value.expiresAt > 0
    && isRecord(value.user) && typeof value.user.id === "string";
}

async function post(functionName, body, accessToken) {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
    redirect: "error",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof payload?.error === "string" ? payload.error : "request_failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function storeSession(session) {
  if (!validSession(session)) throw new Error("invalid_session");
  await chrome.storage.local.set({ [STORAGE_KEYS.authSession]: session });
  return session;
}

export async function signIn(email, password) {
  const session = await post("auth-sign-in", { email: String(email ?? "").trim(), password: String(password ?? "") });
  await chrome.storage.local.remove(STORAGE_KEYS.accessStatus);
  return storeSession(session);
}

export async function acceptSessionHandoff(session) {
  await chrome.storage.local.remove(STORAGE_KEYS.accessStatus);
  return storeSession(session);
}

export async function signOut() {
  await chrome.storage.local.remove([STORAGE_KEYS.authSession, STORAGE_KEYS.accessStatus]);
}

export async function getSession() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.authSession);
  const session = stored[STORAGE_KEYS.authSession];
  if (!validSession(session)) {
    await signOut();
    return null;
  }
  if (session.expiresAt > Math.floor(Date.now() / 1_000) + 60) return session;
  try {
    return await storeSession(await post("auth-refresh", { refreshToken: session.refreshToken }));
  } catch {
    await signOut();
    return null;
  }
}

export async function getAccessState({ force = false } = {}) {
  const session = await getSession();
  if (!session) return { authenticated: false, active: false, reason: "authentication_required" };

  if (!force) {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.accessStatus);
    const cached = stored[STORAGE_KEYS.accessStatus];
    if (isRecord(cached) && Number(cached.cachedAt) > Date.now() - ACCESS_CACHE_MS) {
      return { ...cached, authenticated: true };
    }
  }

  try {
    const status = await post("access-status", {}, session.accessToken);
    const next = {
      authenticated: true,
      active: status?.active === true,
      plan: isRecord(status?.plan) ? { key: String(status.plan.key ?? ""), name: String(status.plan.name ?? "") } : null,
      source: typeof status?.source === "string" ? status.source : null,
      expiresAt: typeof status?.expiresAt === "string" ? status.expiresAt : null,
      user: { id: session.user.id, email: typeof session.user.email === "string" ? session.user.email : "" },
      checkedAt: typeof status?.checkedAt === "string" ? status.checkedAt : new Date().toISOString(),
      cachedAt: Date.now(),
      reason: status?.active === true ? null : "access_required",
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.accessStatus]: next });
    return next;
  } catch (error) {
    if (error?.status === 401) await signOut();
    return { authenticated: error?.status !== 401, active: false, reason: error?.status === 401 ? "invalid_session" : "access_unavailable" };
  }
}
