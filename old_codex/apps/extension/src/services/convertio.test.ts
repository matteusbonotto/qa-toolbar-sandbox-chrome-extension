import { afterEach, describe, expect, it, vi } from "vitest";
import { ConvertioClient, maskedConvertioKey, removeConvertioKey, saveConvertioKey } from "./convertio";

describe("Convertio integration contract", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("keeps the personal key local and exposes only a masked representation", async () => {
    const values: Record<string, unknown> = {};
    vi.stubGlobal("browser", { storage: { local: { set: vi.fn(async (items: Record<string, unknown>) => Object.assign(values, items)), get: vi.fn(async () => values), remove: vi.fn(async (key: string) => { delete values[key]; }) } } });
    await saveConvertioKey("abcdefghijklmnopAB12");
    expect(await maskedConvertioKey()).toBe("••••••••••••AB12");
    await removeConvertioKey();
    expect(await maskedConvertioKey()).toBeNull();
  });

  it("uploads, polls, downloads and always deletes the remote conversion", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/convert") && init?.method === "POST") return Response.json({ data: { id: "conversion-1" } });
      if (url.includes("/conversion-1/evidence.webm")) return Response.json({ data: {} });
      if (url.endsWith("/conversion-1/status")) return Response.json({ data: { step: "finish", percent: 100, output: { url: "https://download.convertio.test/result.gif" } } });
      if (url === "https://download.convertio.test/result.gif") return new Response(new Blob(["GIF89a"], { type: "image/gif" }));
      if (url.endsWith("/conversion-1") && init?.method === "DELETE") return Response.json({ data: {} });
      return new Response(null, { status: 500 });
    });
    const progress = vi.fn();
    const pending = new ConvertioClient("abcdefghijklmnop").convertToGif(new Blob(["video"]), "evidence.webm", new AbortController().signal, progress);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/conversion-1$/), expect.objectContaining({ method: "DELETE" }));
    expect(progress).toHaveBeenCalledWith({ stage: "downloading", percent: 100 });
  });
});
