import { STORAGE_KEYS } from "../lib/storage.js";

const FUNCTIONS_BASE_URL = "https://xhusvkylbouwtpcevgri.supabase.co/functions/v1";
const ACCESS_CACHE_MS = 30_000;
const IS_TEST_BUILD = chrome.runtime.getManifest().name.includes("[TESTE]");
const TEST_DEMO_USER_ID = "00000000-0000-4000-8000-000000000014";

function testDemoSession(email) {
  return {
    accessToken: `test-demo-access-${"x".repeat(48)}`,
    refreshToken: `test-demo-refresh-${"x".repeat(24)}`,
    expiresAt: Math.floor(Date.now() / 1_000) + 24 * 60 * 60,
    user: { id: TEST_DEMO_USER_ID, email: String(email || "teste@qa-toolbar.local") },
  };
}

function testDemoAccess(session) {
  return {
    authenticated: true, active: true,
    plan: { key: "release-manager", name: "Release Manager - DEMO TESTE" },
    source: "test-demo", expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(), billing: null,
    features: { "characterCounter.enabled": true, "multiClick.enabled": true, "inputLab.enabled": true, "fakerFill.enabled": true, "macroStudio.enabled": true, "keyView.enabled": true, "elementCapture.enabled": true, "stepsRecorder.enabled": true, "clearSiteData.enabled": true, "jsonStudio.enabled": true, "breakpointViewer.enabled": true, "recording.mp4": true, "recording.gif": true },
    user: { id: session.user.id, email: session.user.email }, checkedAt: new Date().toISOString(), cachedAt: Date.now(), reason: null,
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Public half of the ECDSA P-256 keypair whose private half lives only in the access-status Edge
// Function's environment (ACCESS_TOKEN_PRIVATE_KEY_JWK, see supabase/functions/_shared/
// access_token.ts). Shipping the public key here is safe by construction - it can verify a
// signature but never produce one - which is exactly what closes the vulnerability this replaces:
// before this existed, access-status's plain JSON response was cached as-is in
// chrome.storage.local and re-trusted on every subsequent check, so anything with access to the
// extension's own storage (including the user's own "Inspect service worker" console) could just
// write {active:true,...} directly and every paid feature unlocked, permanently, with no further
// server contact ever required.
const ACCESS_TOKEN_PUBLIC_JWK = { kty: "EC", crv: "P-256", x: "YOXHg6Zb6-40OwuDj7AWAxY4_diLlDCqaq8TtDg949U", y: "R1ZwLOjhOcU0JzpTx8MSR5LykvTMleuMcpJUFQv3ukc" };

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

let cachedAccessTokenPublicKey = null;
async function accessTokenPublicKey() {
  if (!cachedAccessTokenPublicKey) {
    cachedAccessTokenPublicKey = crypto.subtle.importKey("jwk", ACCESS_TOKEN_PUBLIC_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
  return cachedAccessTokenPublicKey;
}

// Verifies a token minted by access_token.ts's signAccessToken(). Returns the signed payload only
// when the ECDSA signature genuinely checks out AND its own `exp` claim hasn't passed - the
// payload's claims (active/plan/features) are never trusted otherwise. This is the one thing that
// actually stands between "the server confirmed you're a paying customer" and "a tampered value
// sitting in local storage" - every code path in this file that can end in `active: true` must
// route through this first.
async function verifyAccessToken(token) {
  if (typeof token !== "string") return null;
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
  } catch {
    return null;
  }
  if (!isRecord(payload) || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1_000)) return null;
  try {
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await accessTokenPublicKey(),
      base64UrlDecode(encodedSignature),
      new TextEncoder().encode(encodedPayload),
    );
    return valid ? payload : null;
  } catch {
    return null;
  }
}

// The only place allowed to turn a chrome.storage.local blob into an access decision - every
// field that actually gates a feature (active/plan/features) is read from the verified token
// payload, never from the outer cached object's own same-named fields (an attacker could otherwise
// keep a still-valid old token but edit the sibling `active` field next to it). Non-security
// fields (billing text, checkedAt display) are cosmetic and can ride along from the cache as-is.
async function readVerifiedCachedAccess() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.accessStatus);
  const cached = stored[STORAGE_KEYS.accessStatus];
  if (!isRecord(cached)) return null;
  const verified = await verifyAccessToken(cached.token);
  if (!verified) return null;
  return {
    authenticated: true,
    active: verified.active === true,
    plan: isRecord(verified.plan) ? { key: String(verified.plan.key ?? ""), name: String(verified.plan.name ?? "") } : null,
    source: typeof cached.source === "string" ? cached.source : null,
    expiresAt: typeof cached.expiresAt === "string" ? cached.expiresAt : null,
    billing: sanitizeBilling(cached.billing),
    features: sanitizeFeatures(verified.features),
    user: isRecord(cached.user) ? cached.user : null,
    checkedAt: typeof cached.checkedAt === "string" ? cached.checkedAt : null,
    cachedAt: Number(cached.cachedAt) || null,
    token: cached.token,
    reason: verified.active === true ? null : "access_required",
  };
}

// Failed-payment notification: the only signal available without a chosen email provider (see
// docs/PENDENCIAS_USUARIO.md) is this icon badge, kept in sync with every access-status check.
function updateBadge(access) {
  const pastDue = access?.billing?.status === "past_due" || access?.billing?.status === "unpaid";
  chrome.action.setBadgeText({ text: pastDue ? "!" : "" });
  if (pastDue) chrome.action.setBadgeBackgroundColor({ color: "#c70e0e" });
  chrome.action.setTitle({ title: pastDue ? "QA Toolbar Sandbox - pagamento pendente, acesso pago bloqueado" : "QA Toolbar Sandbox - abrir configurações" });
}

function sanitizeBilling(value) {
  if (!isRecord(value) || typeof value.status !== "string" || value.status.length > 40) return null;
  return { status: value.status, cancelAtPeriodEnd: value.cancelAtPeriodEnd === true, paymentConfirmed: value.paymentConfirmed === true };
}

function sanitizeFeatures(value) {
  const result = {};
  if (!isRecord(value)) return result;
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== "string" || key.length > 80 || !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(key)) continue;
    if (typeof raw === "boolean" || typeof raw === "number" || (typeof raw === "string" && raw.length <= 200)) {
      result[key] = raw;
    }
  }
  return result;
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
  // Test packages must remain usable even when Docker/Supabase local is stopped. This branch is
  // impossible in the production manifest and never calls or impersonates the production backend.
  if (IS_TEST_BUILD && /^(?:https?:\/\/)?(?:127\.0\.0\.1|localhost)(?::|\/)/i.test(FUNCTIONS_BASE_URL)) {
    await chrome.storage.local.remove(STORAGE_KEYS.accessStatus);
    return storeSession(testDemoSession(String(email ?? "").trim()));
  }
  const session = await post("auth-sign-in", { email: String(email ?? "").trim(), password: String(password ?? "") });
  await chrome.storage.local.remove(STORAGE_KEYS.accessStatus);
  return storeSession(session);
}

export async function requestPasswordReset(email) {
  await post("auth-recover-password", { email: String(email ?? "").trim() });
}

export async function redeemVoucher(code) {
  const session = await getSession();
  if (!session) throw new Error("authentication_required");
  const result = await post("voucher-redeem", { code: String(code ?? "").trim() }, session.accessToken);
  await chrome.storage.local.remove(STORAGE_KEYS.accessStatus);
  return result;
}

export async function acceptSessionHandoff(session) {
  await chrome.storage.local.remove(STORAGE_KEYS.accessStatus);
  return storeSession(session);
}

export async function signOut() {
  await chrome.storage.local.remove([STORAGE_KEYS.authSession, STORAGE_KEYS.accessStatus]);
  updateBadge(null);
}

// LGPD self-service deletion: the edge function (supabase/functions/account-delete) re-verifies
// the password server-side, cancels any active Stripe subscription, and hard-deletes personal
// data - this just makes that call and clears the local session on success.
export async function deleteAccount(password) {
  const session = await getSession();
  if (!session) throw new Error("authentication_required");
  await post("account-delete", { password: String(password ?? "") }, session.accessToken);
  await signOut();
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
  if (IS_TEST_BUILD && session.user.id === TEST_DEMO_USER_ID) {
    const demo = testDemoAccess(session);
    await chrome.storage.local.set({ [STORAGE_KEYS.accessStatus]: demo });
    updateBadge(demo);
    return demo;
  }

  if (!force) {
    const verifiedCached = await readVerifiedCachedAccess();
    if (verifiedCached && Number(verifiedCached.cachedAt) > Date.now() - ACCESS_CACHE_MS) {
      updateBadge(verifiedCached);
      return verifiedCached;
    }
  }

  try {
    const status = await post("access-status", {}, session.accessToken);
    const verified = await verifyAccessToken(status?.token);
    // The server signed this response itself, over HTTPS, moments ago - a missing/invalid
    // signature here means something is badly wrong (a stale deploy, a key mismatch), not a normal
    // failure mode. Treat it the same as "couldn't reach the server" rather than trusting the
    // unsigned fields underneath it.
    if (!verified) throw new Error("access_token_signature_invalid");
    const next = {
      authenticated: true,
      active: verified.active === true,
      plan: isRecord(verified.plan) ? { key: String(verified.plan.key ?? ""), name: String(verified.plan.name ?? "") } : null,
      source: typeof status?.source === "string" ? status.source : null,
      expiresAt: typeof status?.expiresAt === "string" ? status.expiresAt : null,
      billing: sanitizeBilling(status?.billing),
      features: sanitizeFeatures(verified.features),
      user: { id: session.user.id, email: typeof session.user.email === "string" ? session.user.email : "" },
      checkedAt: typeof status?.checkedAt === "string" ? status.checkedAt : new Date().toISOString(),
      cachedAt: Date.now(),
      token: status.token,
      reason: verified.active === true ? null : "access_required",
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.accessStatus]: next });
    updateBadge(next);
    return next;
  } catch (error) {
    if (error?.status === 401) await signOut();
    // Network/server hiccup (not an explicit 401): fall back to a still-genuinely-valid cached
    // token rather than either trusting raw local JSON (the old bug) or hard-failing every
    // legitimate user for up to ACCESS_TOKEN_TTL_SECONDS just because one request blipped.
    const verifiedCached = error?.status !== 401 ? await readVerifiedCachedAccess() : null;
    if (verifiedCached) {
      updateBadge(verifiedCached);
      return verifiedCached;
    }
    return { authenticated: error?.status !== 401, active: false, reason: error?.status === 401 ? "invalid_session" : "access_unavailable" };
  }
}
