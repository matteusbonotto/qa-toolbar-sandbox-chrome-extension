// Signs a short-lived entitlement claim with an ECDSA P-256 private key held only in this Edge
// Function's environment (ACCESS_TOKEN_PRIVATE_KEY_JWK). The extension verifies the signature
// client-side with the matching PUBLIC key (safe to ship in the bundle — a public key can verify a
// signature but never forge one). Without this, the client cached the plain access-status JSON in
// chrome.storage.local and re-trusted it indefinitely: any script with access to the extension's
// own storage — including the user's own "Inspect service worker" DevTools console — could write
// `{active:true,...}` directly and the extension had no way to tell that apart from a real,
// paid-for response. See apps/extension/src/background/auth.js's verifyAccessToken() for the
// client-side half of this.

const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

let cachedPrivateKey: CryptoKey | null = null;

async function privateKey(): Promise<CryptoKey> {
  if (cachedPrivateKey) return cachedPrivateKey;
  const raw = Deno.env.get("ACCESS_TOKEN_PRIVATE_KEY_JWK")?.trim();
  if (!raw) throw new Error("Missing required server configuration: ACCESS_TOKEN_PRIVATE_KEY_JWK");
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new Error("ACCESS_TOKEN_PRIVATE_KEY_JWK is not valid JSON");
  }
  cachedPrivateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return cachedPrivateKey;
}

// Compact, JWT-like but deliberately not a full JWT (no alg header to spoof, no "none" alg
// confusion surface): base64url(payload JSON) "." base64url(raw P-256 ECDSA signature over those
// exact encoded-payload bytes). `payload` should carry only what the client needs to gate features
// without another round trip — today: active/plan/features.
export async function signAccessToken(payload: Record<string, unknown>): Promise<string> {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS };
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(body)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await privateKey(), new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}
