function encode(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function signOfflineEntitlement(payload: Record<string, unknown>): Promise<string> {
  const privateJwk = Deno.env.get("OFFLINE_LICENSE_PRIVATE_JWK");
  if (!privateJwk) throw new Error("Missing offline license signing key");
  const key = await crypto.subtle.importKey("jwk", JSON.parse(privateJwk), { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"]);
  const header = encode(JSON.stringify({ alg: "PS256", typ: "QTS-OFFLINE", kid: "qts-2026-01" }));
  const body = encode(JSON.stringify(payload));
  const input = `${header}.${body}`;
  const signature = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, key, new TextEncoder().encode(input));
  return `${input}.${encode(new Uint8Array(signature))}`;
}
