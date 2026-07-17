/** SHA-256 hex digest via Web Crypto — vouchers/campaigns store only the hash (code_hash),
 * never the plaintext code, matching schema.sql's `^[a-f0-9]{64}$` constraint. */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
