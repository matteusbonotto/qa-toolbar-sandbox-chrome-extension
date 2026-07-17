const apiOrigin = "https://api.convertio.co";
const keyStorage = "qtsConvertioKey";
export type ConversionProgress = { stage: "preparing" | "uploading" | "converting" | "downloading"; percent: number };

export async function saveConvertioKey(key: string): Promise<void> {
  const normalized = key.trim(); if (!/^[A-Za-z0-9_-]{16,200}$/.test(normalized)) throw new Error("Formato de chave Convertio inválido.");
  await browser.storage.local.set({ [keyStorage]: normalized });
}
export async function removeConvertioKey(): Promise<void> { await browser.storage.local.remove(keyStorage); }
export async function maskedConvertioKey(): Promise<string | null> { const stored = await browser.storage.local.get(keyStorage); const key = stored[keyStorage]; return typeof key === "string" ? `${"•".repeat(12)}${key.slice(-4)}` : null; }
export async function loadConvertioKey(): Promise<string | null> { const stored = await browser.storage.local.get(keyStorage); return typeof stored[keyStorage] === "string" ? stored[keyStorage] as string : null; }

export class ConvertioClient {
  constructor(private readonly apiKey: string) { if (!apiKey) throw new Error("Configure sua chave Convertio."); }

  async convertToGif(file: Blob, filename: string, signal: AbortSignal, onProgress: (progress: ConversionProgress) => void): Promise<Blob> {
    onProgress({ stage: "preparing", percent: 0 });
    const started = await this.request<{ data: { id: string } }>("/convert", { method: "POST", body: JSON.stringify({ apikey: this.apiKey, input: "upload", outputformat: "gif", filename: filename.slice(0, 180) }) }, signal);
    const id = started.data.id;
    try {
      onProgress({ stage: "uploading", percent: 15 });
      await this.request(`/convert/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`, { method: "PUT", body: file, headers: { "content-type": "application/octet-stream" } }, signal);
      let delay = 1200;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await wait(delay, signal); delay = Math.min(5000, Math.round(delay * 1.18));
        const status = await this.request<{ data: { step: string; percent?: number; output?: { url?: string } } }>(`/convert/${encodeURIComponent(id)}/status`, { method: "GET" }, signal);
        const percent = Math.max(20, Math.min(95, status.data.percent ?? 20 + attempt));
        onProgress({ stage: "converting", percent });
        if (status.data.step === "error") throw new Error("A Convertio não conseguiu concluir esta conversão.");
        const downloadUrl = status.data.output?.url;
        if (status.data.step === "finish" && downloadUrl) {
          const url = new URL(downloadUrl); if (url.protocol !== "https:") throw new Error("URL de download insegura.");
          onProgress({ stage: "downloading", percent: 98 });
          const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
          if (!response.ok) throw new Error("Falha ao baixar o GIF convertido.");
          const result = await response.blob(); onProgress({ stage: "downloading", percent: 100 }); return result;
        }
      }
      throw new Error("A conversão excedeu o tempo máximo de espera.");
    } finally { await this.request(`/convert/${encodeURIComponent(id)}`, { method: "DELETE" }, AbortSignal.timeout(8000)).catch(() => undefined); }
  }

  private async request<T = unknown>(path: string, init: RequestInit, signal: AbortSignal): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${apiOrigin}${path}`, { ...init, signal, credentials: "omit", referrerPolicy: "no-referrer", headers: { ...(init.body instanceof Blob ? {} : { "content-type": "application/json" }), ...init.headers } });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) throw new Error("A Convertio não reconheceu esta chave.");
        if (response.status === 402) throw new Error("Sua chave foi reconhecida, mas não possui minutos disponíveis.");
        if (!response.ok) throw new Error(`Convertio indisponível (${response.status}).`);
        return payload as T;
      } catch (error) { lastError = error; if (signal.aborted || attempt === 2 || (error instanceof Error && /chave|minutos/.test(error.message))) throw error; await wait(500 * (attempt + 1), signal); }
    }
    throw lastError;
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, milliseconds); signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Cancelado", "AbortError")); }, { once: true }); }); }
