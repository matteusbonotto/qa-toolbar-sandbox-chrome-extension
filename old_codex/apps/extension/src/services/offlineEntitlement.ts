import { z } from "zod";
import type { EntitlementCache } from "./entitlements";

const payloadSchema = z.object({ version: z.literal(1), subject: z.string().uuid(), installationId: z.string().uuid(), plan: z.object({ key: z.string(), name: z.string() }), features: z.record(z.string(), z.unknown()), featureFlags: z.record(z.string(), z.object({ enabled: z.boolean(), config: z.unknown() })), access: z.object({ active: z.boolean(), source: z.string().nullable(), expiresAt: z.string().nullable() }), issuedAt: z.number().int(), expiresAt: z.number().int(), graceUntil: z.number().int() }).strict();

function decode(value: string): Uint8Array { const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="); return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)); }

export async function verifyOfflineEntitlement(token: string, installationId: string, now = Date.now(), publicJwkOverride?: string): Promise<EntitlementCache | null> {
  try {
    const publicJwk = publicJwkOverride ?? import.meta.env.WXT_PUBLIC_OFFLINE_LICENSE_PUBLIC_JWK as string | undefined;
    if (!publicJwk) return null;
    const parts = token.split("."); if (parts.length !== 3) return null;
    const [header, body, signature] = parts as [string, string, string];
    const key = await crypto.subtle.importKey("jwk", JSON.parse(publicJwk), { name: "RSA-PSS", hash: "SHA-256" }, false, ["verify"]);
    const signatureBytes = decode(signature);
    const signatureBuffer = signatureBytes.buffer.slice(signatureBytes.byteOffset, signatureBytes.byteOffset + signatureBytes.byteLength) as ArrayBuffer;
    const valid = await crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, key, signatureBuffer, new TextEncoder().encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = payloadSchema.parse(JSON.parse(new TextDecoder().decode(decode(body))));
    const nowSeconds = Math.floor(now / 1000);
    if (payload.installationId !== installationId || nowSeconds > payload.graceUntil || payload.issuedAt > nowSeconds + 300) return null;
    const effectiveExpiry = payload.access.expiresAt ? new Date(payload.access.expiresAt).getTime() : null;
    const accessActive = payload.access.active && (effectiveExpiry === null || effectiveExpiry > now);
    return { plan: payload.plan, features: accessActive ? payload.features : {}, trial: { active: false, endsAt: null, daysRemaining: 0 }, referral: { code: null, qualified: 0 }, access: { active: accessActive, source: nowSeconds > payload.expiresAt ? "offline-grace" : "offline-signed", expiresAt: payload.access.expiresAt, daysRemaining: effectiveExpiry ? Math.max(0, Math.ceil((effectiveExpiry - now) / 86_400_000)) : null, expiryWarning: nowSeconds > payload.expiresAt, installUrl: "https://chromewebstore.google.com/" }, featureFlags: payload.featureFlags, checkedAt: new Date(payload.issuedAt * 1000).toISOString() };
  } catch { return null; }
}
