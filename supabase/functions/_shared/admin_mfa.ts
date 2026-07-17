import { createHash } from "node:crypto";

export const ADMIN_EMAIL = "matteusbonotto+admin@gmail.com";
export const OTP_CHALLENGE_MINUTES = 10;
export const ADMIN_SESSION_MINUTES = 60;
export const RECENT_PASSWORD_SECONDS = 5 * 60;

interface AuthenticationMethodReference {
  method?: unknown;
  timestamp?: unknown;
}

export function authenticationMethodTimestamp(
  claims: Record<string, unknown>,
  method: "password" | "otp",
): number | null {
  if (!Array.isArray(claims.amr)) return null;
  const timestamps = claims.amr
    .filter((entry): entry is AuthenticationMethodReference => Boolean(entry) && typeof entry === "object")
    .filter((entry) => entry.method === method && Number.isFinite(Number(entry.timestamp)))
    .map((entry) => Number(entry.timestamp));
  return timestamps.length ? Math.max(...timestamps) : null;
}

export function isRecentAuthentication(timestampSeconds: number | null, maximumAgeSeconds: number, now = Date.now()): boolean {
  if (timestampSeconds === null) return false;
  const ageSeconds = now / 1000 - timestampSeconds;
  return ageSeconds >= -30 && ageSeconds <= maximumAgeSeconds;
}

export function secureAdminToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
