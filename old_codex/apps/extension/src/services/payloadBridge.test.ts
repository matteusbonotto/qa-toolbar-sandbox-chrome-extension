import { describe, expect, it, vi } from "vitest";
import { startPayloadBridge } from "./payloadBridge";

describe("payload bridge", () => {
  it("accepts only messages with the generated nonce and strict record schema", async () => {
    let nonce = "";
    vi.stubGlobal("browser", { runtime: { sendMessage: vi.fn(async (message: { nonce: string }) => { nonce = message.nonce; return { installed: true }; }) } });
    const received: unknown[] = [];
    const stop = await startPayloadBridge((record) => received.push(record));
    window.dispatchEvent(new MessageEvent("message", { source: window, origin: window.location.origin, data: { source: "qts-network-bridge", nonce: "wrong", record: {} } }));
    window.dispatchEvent(new MessageEvent("message", { source: window, origin: window.location.origin, data: { source: "qts-network-bridge", nonce, record: { kind: "fetch", url: "https://example.test/api", method: "GET", status: 200, durationMs: 12, payload: { ok: true } } } }));
    expect(received).toHaveLength(1);
    stop();
  });
});
