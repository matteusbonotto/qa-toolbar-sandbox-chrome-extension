import { z } from "zod";

const recordSchema = z.object({ kind: z.enum(["fetch", "xhr"]), url: z.string().max(2000), method: z.string().max(20), status: z.number().int().min(0).max(999), durationMs: z.number().nonnegative(), payload: z.unknown() }).strict();
export type PayloadRecord = z.infer<typeof recordSchema> & { id: string; capturedAt: string };
let persistentNonce: string | null = null;

export async function startPayloadBridge(onRecord: (record: PayloadRecord) => void): Promise<() => void> {
  const nonce = persistentNonce ?? crypto.randomUUID();
  persistentNonce = nonce;
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin || !event.data || event.data.source !== "qts-network-bridge" || event.data.nonce !== nonce) return;
    const parsed = recordSchema.safeParse(event.data.record); if (!parsed.success) return;
    onRecord({ ...parsed.data, id: crypto.randomUUID(), capturedAt: new Date().toISOString() });
  };
  window.addEventListener("message", listener);
  const response = await browser.runtime.sendMessage({ type: "qts:install-network-bridge", nonce }) as { installed?: boolean };
  if (!response?.installed) { window.removeEventListener("message", listener); throw new Error("Não foi possível ativar a captura consentida."); }
  return () => window.removeEventListener("message", listener);
}
