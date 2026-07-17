export type RecordingFormat = { mimeType: string; extension: "mp4" | "webm"; label: string };
export type RecordingPhase = "idle" | "requestingPermission" | "recording" | "paused" | "stopping" | "ready" | "failed" | "canceled";

const candidates: RecordingFormat[] = [
  { mimeType: "video/mp4;codecs=avc1,mp4a.40.2", extension: "mp4", label: "MP4 (H.264/AAC)" },
  { mimeType: "video/mp4", extension: "mp4", label: "MP4" },
  { mimeType: "video/webm;codecs=vp9,opus", extension: "webm", label: "WebM (VP9/Opus)" },
  { mimeType: "video/webm;codecs=vp8,opus", extension: "webm", label: "WebM (VP8/Opus)" },
  { mimeType: "video/webm", extension: "webm", label: "WebM" },
];

export function supportedRecordingFormats(mediaRecorder = MediaRecorder): RecordingFormat[] {
  return candidates.filter((candidate) => mediaRecorder.isTypeSupported(candidate.mimeType));
}

export class EvidenceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private phase: RecordingPhase = "idle";
  format: RecordingFormat | null = null;

  async start(preferred: "mp4" | "webm" = "mp4"): Promise<RecordingFormat> {
    if (this.recorder?.state && this.recorder.state !== "inactive") throw new Error("Já existe uma gravação ativa.");
    const formats = supportedRecordingFormats();
    this.format = formats.find((item) => item.extension === preferred) ?? formats[0] ?? null;
    if (!this.format) throw new Error("Este navegador não oferece um formato de gravação compatível.");
    this.phase = "requestingPermission";
    try { this.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: false }); }
    catch (error) { this.phase = error instanceof DOMException && error.name === "NotAllowedError" ? "canceled" : "failed"; throw error; }
    this.chunks = [];
    try { this.recorder = new MediaRecorder(this.stream, { mimeType: this.format.mimeType, videoBitsPerSecond: 5_000_000 }); }
    catch (error) { this.stream.getTracks().forEach((track) => track.stop()); this.stream = null; this.phase = "failed"; throw error; }
    this.recorder.ondataavailable = (event) => { if (event.data.size) this.chunks.push(event.data); };
    this.stream.getTracks().forEach((track) => track.addEventListener("ended", () => { if (this.recorder?.state !== "inactive") this.recorder?.stop(); }, { once: true }));
    this.recorder.start(1000);
    this.phase = "recording";
    return this.format;
  }

  pause(): void { if (this.recorder?.state === "recording") { this.recorder.pause(); this.phase = "paused"; } }
  resume(): void { if (this.recorder?.state === "paused") { this.recorder.resume(); this.phase = "recording"; } }
  state(): RecordingState | "idle" { return this.recorder?.state ?? "idle"; }
  currentPhase(): RecordingPhase { return this.phase; }

  async stop(): Promise<{ blob: Blob; format: RecordingFormat }> {
    if (!this.recorder || !this.format || this.recorder.state === "inactive") throw new Error("Nenhuma gravação ativa.");
    this.phase = "stopping";
    const recorder = this.recorder;
    await new Promise<void>((resolve) => { recorder.addEventListener("stop", () => resolve(), { once: true }); recorder.stop(); });
    this.stream?.getTracks().forEach((track) => track.stop());
    const result = { blob: new Blob(this.chunks, { type: this.format.mimeType }), format: this.format };
    this.recorder = null; this.stream = null; this.chunks = []; this.phase = "ready";
    return result;
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.recorder = null; this.stream = null; this.chunks = []; this.format = null; this.phase = "canceled";
  }
}

export function buildEvidenceFilename(context: { client?: string; project?: string; product?: string; environment?: string }, extension: string, now = new Date()): string {
  const safe = (value?: string) => (value || "qa").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "qa";
  return `qa-evidence_${safe(context.client)}_${safe(context.project)}_${safe(context.product)}_${safe(context.environment)}_${now.toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

export function downloadRecording(blob: Blob, extension: string, context: { client?: string; project?: string; product?: string; environment?: string } = {}): void {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = buildEvidenceFilename(context, extension); link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
