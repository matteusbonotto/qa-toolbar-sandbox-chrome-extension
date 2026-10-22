// Evidence recorder window (opened by background.js on "qts:recorder-open").
//
// Why a separate extension window instead of the page's content script: the content script, its
// MediaStream and every recorded chunk are destroyed on each reload or navigation of the tab it
// runs in, so a single F5 used to silently end (and lose) the recording. An extension page is not
// tied to the recorded tab, so the capture keeps going across reloads, navigations and even tab
// switches. No new permission is needed: getDisplayMedia + MediaRecorder work in extension pages.
//
// The window owns the whole capture. Every toolbar instance (any tab, any frame, including the
// freshly reloaded one) only mirrors RECORDER_STATE_KEY from chrome.storage.local to draw its
// timer/pause/stop controls, and sends "qts:recorder-command" messages back here.
(() => {
  const RECORDER_STATE_KEY = "qtsRecorderStateV1";
  const GIF_PART_DURATION_MS = 15_000;
  const GIF_FPS = 5;
  const GIF_MAX_WIDTH = 1280;
  const GIF_MAX_HEIGHT = 720;
  // getDisplayMedia rejecting faster than a human can react means no picker was ever shown (the
  // browser refused to open it without a user gesture), as opposed to the user cancelling it.
  const PICKER_REJECTED_WITHOUT_UI_MS = 400;
  // Gives Chrome's download manager time to take the blob URL before this window (and every blob
  // URL it created) is torn down; closing immediately can cancel a large download.
  const CLOSE_AFTER_DOWNLOAD_MS = 4_000;
  // Compact recorder widget, used once capture is running: just the timer and the pause/stop/cancel
  // controls, parked in the top-right corner of the physical screen so it stays visible without
  // covering much of the page being recorded. Width/height in CSS pixels; the layout in recorder.css
  // (main[data-status="recording"|"paused"]) is tuned to these.
  const WIDGET_WIDTH = 230;
  const WIDGET_HEIGHT = 96;
  // Breathing room kept between the widget and the screen edges, in CSS pixels.
  const WIDGET_SCREEN_MARGIN = 16;

  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "gif" ? "gif" : "video";
  const sourceTabId = Number(params.get("tabId")) || null;
  const sourceWindowId = Number(params.get("windowId")) || null;
  const safeSegment = (value, fallback, maxLength = 60) => String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLength) || fallback;
  const fallbackPrefix = safeSegment(params.get("prefix"), "evidencia");
  const fallbackSlug = safeSegment(params.get("slug"), "pagina");

  const COPY = {
    "pt-BR": { title: "Gravação de evidência", titleGif: "Gravação em GIF", choose: "Escolha a aba, janela ou tela para gravar.", chooseButton: "Escolher o que gravar", cancel: "Cancelar", pause: "Pausar", resume: "Retomar", stop: "Parar e salvar", recording: "Gravando", paused: "Pausado", saving: "Salvando arquivo...", saved: "Arquivo salvo nos downloads.", empty: "A gravação terminou antes de capturar um quadro válido.", unavailable: "Este navegador não permite gravar a tela aqui.", hint: "Pode recarregar ou navegar na página: a gravação continua. Não feche esta janela até parar." },
    es: { title: "Grabación de evidencia", titleGif: "Grabación en GIF", choose: "Elige la pestaña, ventana o pantalla para grabar.", chooseButton: "Elegir qué grabar", cancel: "Cancelar", pause: "Pausar", resume: "Reanudar", stop: "Detener y guardar", recording: "Grabando", paused: "En pausa", saving: "Guardando archivo...", saved: "Archivo guardado en descargas.", empty: "La grabación terminó antes de capturar un cuadro válido.", unavailable: "Este navegador no permite grabar la pantalla aquí.", hint: "Puedes recargar o navegar en la página: la grabación continúa. No cierres esta ventana hasta detenerla." },
    en: { title: "Evidence recording", titleGif: "GIF recording", choose: "Pick the tab, window or screen to record.", chooseButton: "Choose what to record", cancel: "Cancel", pause: "Pause", resume: "Resume", stop: "Stop and save", recording: "Recording", paused: "Paused", saving: "Saving file...", saved: "File saved to downloads.", empty: "The recording ended before capturing a valid frame.", unavailable: "This browser cannot record the screen here.", hint: "You can reload or navigate the page: the recording keeps going. Keep this window open until you stop." },
  };
  const language = params.get("lang") || "pt-BR";
  const t = COPY[language] || COPY[language.split("-")[0]] || COPY["pt-BR"];

  const rec = {
    status: "starting", // starting | recording | paused | stopping | idle
    windowId: null,
    stream: null,
    recorder: null,
    chunks: [],
    parts: [],
    mimeType: "",
    elapsedMs: 0,
    segmentStartedAt: 0,
    manualStatusKey: null,
    ticker: null,
    gif: { canvas: null, context: null, hasFrame: false, encoder: null, outputCanvas: null, segmentStartedAt: 0, lastFrameAt: 0, video: null, reader: null },
  };

  const $ = (id) => document.getElementById(id);

  function elapsed() {
    return rec.elapsedMs + (rec.status === "recording" ? Date.now() - rec.segmentStartedAt : 0);
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
  }

  function render(message) {
    $("card").dataset.status = rec.status === "idle" ? "done" : rec.status;
    $("timer").textContent = formatDuration(elapsed());
    $("pauseButton").hidden = !["recording", "paused"].includes(rec.status);
    $("pauseButton").textContent = rec.status === "paused" ? t.resume : t.pause;
    // Compact widget hides label text (CSS), so keep a hover tooltip and the accessible name in sync.
    $("pauseButton").title = rec.status === "paused" ? t.resume : t.pause;
    $("stopButton").hidden = !["recording", "paused"].includes(rec.status);
    // Cancel stays reachable before capture (abort) and during capture (discard without saving).
    $("cancelButton").hidden = !["starting", "recording", "paused"].includes(rec.status);
    if (message !== undefined) $("message").textContent = message;
    else if (rec.status === "recording") $("message").textContent = t.recording;
    else if (rec.status === "paused") $("message").textContent = t.paused;
    document.title = `${rec.status === "recording" ? "● " : ""}${formatDuration(elapsed())} - QA Toolbar Sandbox`;
  }

  async function publish(extra = {}) {
    const snapshot = { status: rec.status, mode, elapsedMs: rec.elapsedMs, segmentStartedAt: rec.segmentStartedAt, manualStatusKey: rec.manualStatusKey, windowId: rec.windowId, tabId: sourceTabId, updatedAt: Date.now(), ...extra };
    await chrome.storage.local.set({ [RECORDER_STATE_KEY]: snapshot });
  }

  function pickRecordingMimeType() {
    const candidates = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return candidates.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) || "";
  }

  async function containerExtension(blob) {
    const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    // ISO BMFF (mp4) has `ftyp` at byte 4; everything else Chromium produces here is WebM. The
    // bytes are checked instead of trusting the requested MIME type, which may be substituted.
    return header.length >= 12 && String.fromCharCode(...header.slice(4, 8)) === "ftyp" ? "mp4" : "webm";
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function compactTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  // ---------------------------------------------------------------- GIF capture
  function createGifEncoder() {
    return new window.QTS_GIF.GifEncoder(rec.gif.outputCanvas.width, rec.gif.outputCanvas.height, Math.round(100 / GIF_FPS));
  }

  function sizeGifCanvases(width, height) {
    const scale = Math.min(1, GIF_MAX_WIDTH / width, GIF_MAX_HEIGHT / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(width * scale / 2) * 2);
    canvas.height = Math.max(2, Math.round(height * scale / 2) * 2);
    rec.gif.outputCanvas = canvas;
    rec.gif.context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    rec.gif.encoder = createGifEncoder();
    rec.gif.segmentStartedAt = Date.now();
    rec.gif.lastFrameAt = 0;
  }

  // MediaStreamTrackProcessor delivers frames as the capture produces them, independently of
  // whether this window is rendering, so a hidden/occluded recorder window still sees every frame.
  // The <video> path is only a fallback for engines without it.
  async function initializeGifCapture(stream) {
    if (!window.QTS_GIF?.GifEncoder) throw new Error("GIF encoder unavailable");
    const track = stream.getVideoTracks()[0];
    if (typeof MediaStreamTrackProcessor === "function") {
      const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      rec.gif.reader = reader;
      const first = await reader.read();
      if (first.done) throw new Error("Capture ended before the first frame");
      sizeGifCanvases(first.value.displayWidth, first.value.displayHeight);
      const draw = (frame) => { rec.gif.context.drawImage(frame, 0, 0, rec.gif.outputCanvas.width, rec.gif.outputCanvas.height); rec.gif.hasFrame = true; frame.close(); };
      draw(first.value);
      (async () => {
        for (;;) {
          const { value, done } = await reader.read().catch(() => ({ done: true }));
          if (done) return;
          draw(value);
        }
      })();
      return;
    }
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    await video.play();
    rec.gif.video = video;
    sizeGifCanvases(video.videoWidth, video.videoHeight);
  }

  function captureGifFrame() {
    if (rec.status !== "recording" || mode !== "gif" || !rec.gif.encoder) return;
    const { context, outputCanvas } = rec.gif;
    if (rec.gif.video) { context.drawImage(rec.gif.video, 0, 0, outputCanvas.width, outputCanvas.height); rec.gif.hasFrame = true; }
    if (!rec.gif.hasFrame) return;
    const now = Date.now();
    const delayCs = rec.gif.lastFrameAt ? Math.round((now - rec.gif.lastFrameAt) / 10) : Math.round(100 / GIF_FPS);
    rec.gif.encoder.addFrame(context.getImageData(0, 0, outputCanvas.width, outputCanvas.height), delayCs);
    rec.gif.lastFrameAt = now;
    if (now - rec.gif.segmentStartedAt >= GIF_PART_DURATION_MS) {
      rec.parts.push(rec.gif.encoder.finish());
      rec.gif.encoder = createGifEncoder();
      rec.gif.segmentStartedAt = now;
      rec.gif.lastFrameAt = 0;
    }
  }

  function onTick() {
    captureGifFrame();
    render();
  }

  // ---------------------------------------------------------------- lifecycle
  // Shrinks this window from the large "choose" layout down to the compact corner widget once
  // capture is running. Driven from here (never from the service worker), because the worker may be
  // asleep by the time capture starts, while this page stays alive for the whole recording.
  async function shrinkToWidget() {
    try {
      // "system.display" is intentionally NOT in the manifest (adding a permission is a separate,
      // higher-risk change), so the physical screen geometry comes from this extension page's own
      // window.screen. availWidth/availLeft/availTop already exclude OS chrome (taskbar, etc.) and,
      // on multi-monitor setups, describe the display this window currently sits on.
      const screen = window.screen || {};
      const availWidth = Number.isFinite(screen.availWidth) ? screen.availWidth : (screen.width || WIDGET_WIDTH);
      const availLeft = Number.isFinite(screen.availLeft) ? screen.availLeft : 0;
      const availTop = Number.isFinite(screen.availTop) ? screen.availTop : 0;
      const left = Math.max(availLeft, availLeft + availWidth - WIDGET_WIDTH - WIDGET_SCREEN_MARGIN);
      const top = availTop + WIDGET_SCREEN_MARGIN;
      const current = await chrome.windows.getCurrent();
      // No focused:true on purpose: focus must stay on the page being tested, not jump to this widget.
      await chrome.windows.update(current.id, { width: WIDGET_WIDTH, height: WIDGET_HEIGHT, left, top });
    } catch {}
  }

  async function begin({ userInitiated }) {
    // Reentrancy guard: a second begin() while capture is already live would reopen the picker and
    // overwrite rec.stream/rec.recorder without stopping the previous stream, orphaning the OS
    // screen-share indicator. The initial call and the "choose" retry both run at status "starting";
    // only an already-capturing state (recording/paused/stopping) must be rejected.
    if (["recording", "paused", "stopping"].includes(rec.status)) return;
    if (!navigator.mediaDevices?.getDisplayMedia || (mode !== "gif" && typeof MediaRecorder === "undefined")) {
      await finishIdle(t.unavailable, { reason: "unavailable" });
      return;
    }
    $("startButton").hidden = true;
    render(t.choose);
    const requestedAt = Date.now();
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 24, max: 30 } }, audio: false, selfBrowserSurface: "exclude", surfaceSwitching: "include" });
    } catch {
      if (!userInitiated && Date.now() - requestedAt < PICKER_REJECTED_WITHOUT_UI_MS) {
        // No picker was shown (needs a click in this window first): offer the button.
        $("startButton").hidden = false;
        $("startButton").focus();
        render(t.choose);
        return;
      }
      await finishIdle("", { reason: "cancelled", close: true, closeDelayMs: 0 });
      return;
    }
    rec.stream = stream;
    rec.mimeType = pickRecordingMimeType();
    try {
      if (mode === "gif") await initializeGifCapture(stream);
      else {
        rec.recorder = new MediaRecorder(stream, { ...(rec.mimeType ? { mimeType: rec.mimeType } : {}), videoBitsPerSecond: 4_000_000 });
        rec.mimeType = rec.recorder.mimeType || rec.mimeType;
        rec.recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) rec.chunks.push(event.data); });
      }
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      await finishIdle(String(error?.message || t.unavailable), { reason: "unavailable" });
      return;
    }
    // The browser's own "Stop sharing" bar ends the track: save what was captured.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => { if (["recording", "paused"].includes(rec.status)) void stop({}); }, { once: true });
    rec.status = "recording";
    rec.segmentStartedAt = Date.now();
    // Not requesting one Blob per second on purpose: Chromium's MP4 recorder emits fragments that
    // do not concatenate into a seekable file. stop() finalizes one complete container instead.
    rec.recorder?.start();
    await publish();
    render();
    // Capture is running: collapse the large "choose" window into the minimal corner widget.
    void shrinkToWidget();
    // Hand focus back to the page being tested; this window keeps recording in the background.
    if (sourceWindowId) chrome.windows.update(sourceWindowId, { focused: true }).catch(() => {});
    if (sourceTabId) chrome.tabs.update(sourceTabId, { active: true }).catch(() => {});
  }

  async function pause() {
    if (rec.status !== "recording") return;
    rec.recorder?.pause();
    rec.elapsedMs += Date.now() - rec.segmentStartedAt;
    rec.status = "paused";
    await publish();
    render();
  }

  async function resume() {
    if (rec.status !== "paused") return;
    rec.recorder?.resume();
    rec.segmentStartedAt = Date.now();
    rec.gif.lastFrameAt = 0;
    rec.status = "recording";
    await publish();
    render();
  }

  async function stop({ fileBaseName }) {
    if (!["recording", "paused"].includes(rec.status)) return;
    if (rec.status === "recording") rec.elapsedMs += Date.now() - rec.segmentStartedAt;
    rec.status = "stopping";
    await publish();
    render(t.saving);
    if (rec.recorder && rec.recorder.state !== "inactive") {
      const stopped = new Promise((resolveStop) => rec.recorder.addEventListener("stop", resolveStop, { once: true }));
      rec.recorder.stop();
      await stopped;
    }
    rec.gif.reader?.cancel().catch(() => {});
    rec.stream?.getTracks().forEach((track) => track.stop());

    const isGif = mode === "gif";
    const finalBlob = isGif
      ? (rec.gif.encoder?.frameCount ? rec.gif.encoder.finish() : null)
      : new Blob(rec.chunks, { type: rec.mimeType || "video/webm" });
    const parts = [...rec.parts, finalBlob].filter((blob) => blob?.size > 50);
    if (!parts.length) {
      await finishIdle(t.empty, { reason: "empty" });
      return;
    }
    const baseName = safeSegment(fileBaseName, "", 160) || [fallbackPrefix, rec.manualStatusKey && safeSegment(rec.manualStatusKey, ""), fallbackSlug, compactTimestamp()].filter(Boolean).join("_");
    const extension = isGif ? "gif" : await containerExtension(finalBlob);
    if (parts.length === 1) triggerDownload(parts[0], `${baseName}.${extension}`);
    else {
      const files = await Promise.all(parts.map(async (blob, index) => ({ name: `${baseName}_part${index + 1}.${extension}`, data: new Uint8Array(await blob.arrayBuffer()) })));
      triggerDownload(window.QTS_ZIP.createZip(files), `${baseName}.zip`);
    }
    await finishIdle(t.saved, { reason: "saved" });
  }

  async function finishIdle(message, { reason, close = true, closeDelayMs = CLOSE_AFTER_DOWNLOAD_MS } = {}) {
    rec.status = "idle";
    rec.ticker?.terminate();
    rec.ticker = null;
    // Release any still-live capture (e.g. Cancel pressed mid-recording) so the OS screen-share
    // indicator and the MediaStream are torn down even if the window lingers before closing.
    rec.stream?.getTracks().forEach((track) => track.stop());
    await publish({ reason });
    render(message);
    $("pauseButton").hidden = true;
    $("stopButton").hidden = true;
    $("startButton").hidden = true;
    $("cancelButton").hidden = true;
    if (close) setTimeout(() => window.close(), closeDelayMs);
  }

  // Stop from this window still goes through the page's toolbar first, so the "lembrar de
  // atribuir status" preference (forced status modal, captured in the video) is honoured exactly
  // as when Stop is clicked on the toolbar. Falls back to a direct stop if that tab is gone.
  async function requestStopFromPage() {
    if (sourceTabId) {
      const result = await chrome.tabs.sendMessage(sourceTabId, { type: "qts:recorder-stop-request" }, { frameId: 0 }).catch(() => null);
      if (result?.handled) return;
    }
    await stop({});
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "qts:recorder-command" || sender.id !== chrome.runtime.id) return undefined;
    const run = async () => {
      switch (message.command) {
        case "ping": return { ok: true, status: rec.status };
        case "pause": await pause(); return { ok: true };
        case "resume": await resume(); return { ok: true };
        case "mark-status":
          if (["recording", "paused"].includes(rec.status)) { rec.manualStatusKey = safeSegment(message.statusKey, "") || null; await publish(); }
          return { ok: true };
        case "stop": await stop({ fileBaseName: message.fileBaseName }); return { ok: true };
        case "focus": if (rec.windowId) await chrome.windows.update(rec.windowId, { focused: true }); return { ok: true };
        default: return { ok: false, error: "unknown_command" };
      }
    };
    run().then(sendResponse, (error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  window.addEventListener("beforeunload", (event) => {
    if (!["recording", "paused", "stopping"].includes(rec.status)) return;
    event.preventDefault();
    event.returnValue = "";
  });

  $("title").textContent = mode === "gif" ? t.titleGif : t.title;
  $("hint").textContent = t.hint;
  $("startButton").textContent = t.chooseButton;
  $("startButton").title = t.chooseButton;
  $("cancelButton").textContent = t.cancel;
  // Compact widget renders these as icons only (CSS), so a tooltip keeps the label discoverable.
  $("cancelButton").title = t.cancel;
  $("stopButton").textContent = t.stop;
  $("stopButton").title = t.stop;
  $("cancelButton").hidden = false;
  $("startButton").addEventListener("click", () => { void begin({ userInitiated: true }); });
  $("cancelButton").addEventListener("click", () => { void finishIdle("", { reason: "cancelled", closeDelayMs: 0 }); });
  $("pauseButton").addEventListener("click", () => { void (rec.status === "paused" ? resume() : pause()); });
  $("stopButton").addEventListener("click", () => { void requestStopFromPage(); });

  rec.ticker = new Worker("recorder-ticker.js");
  rec.ticker.addEventListener("message", onTick);
  chrome.windows.getCurrent().then(async (current) => {
    rec.windowId = current.id;
    await publish();
    render();
    void begin({ userInitiated: false });
  });
})();
