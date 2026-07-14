import { describe, expect, it } from "vitest";
import { verifyOfflineEntitlement } from "./offlineEntitlement";

const installationId = "c44e3a25-5214-41df-98cc-965da9ce7d31";
const userId = "b6a99e41-dd22-48e5-a332-c14d57eb7759";
const encode = (value: string | ArrayBuffer) => { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value); return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); };

async function token(graceUntil: number) {
  const pair = await crypto.subtle.generateKey({ name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const publicJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey));
  const now = 1_800_000_000;
  const header = encode(JSON.stringify({ alg: "PS256", typ: "QTS-OFFLINE" }));
  const body = encode(JSON.stringify({ version: 1, subject: userId, installationId, plan: { key: "pro", name: "Pro" }, features: { "recording.enabled": true }, featureFlags: {}, access: { active: true, source: "stripe", expiresAt: null }, issuedAt: now, expiresAt: now + 60, graceUntil }));
  const input = `${header}.${body}`;
  const signature = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, pair.privateKey, new TextEncoder().encode(input));
  return { value: `${input}.${encode(signature)}`, publicJwk, now };
}

describe("offline entitlement signature", () => {
  it("accepts a valid installation-bound token", async () => { const signed = await token(1_800_003_600); expect((await verifyOfflineEntitlement(signed.value, installationId, signed.now * 1000, signed.publicJwk))?.features["recording.enabled"]).toBe(true); });
  it("rejects tampering and expired grace", async () => {
    const signed = await token(1_800_000_010);
    const parts = signed.value.split(".");
    const body = parts[1]!;
    parts[1] = `${body[0] === "a" ? "b" : "a"}${body.slice(1)}`;
    expect(await verifyOfflineEntitlement(parts.join("."), installationId, signed.now * 1000, signed.publicJwk)).toBeNull();
    expect(await verifyOfflineEntitlement(signed.value, installationId, (signed.now + 20) * 1000, signed.publicJwk)).toBeNull();
  });
});
