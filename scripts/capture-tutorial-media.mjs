// Local/manual media capture for the extension's Tutorial panel (Part B revision). Modeled on the
// already-validated pattern in scripts/smoke-extension.mjs (launchPersistentContext + route mocks
// for the Edge Functions + extensionId extraction via serviceWorkers(), and the exact tool
// interaction selectors already proven there) -- the novelty here is aiming the bar at a real
// external site instead of the local fixture server -- our own demo site (apps/landing/public/
// sandbox), recording a short video per tool
// (Playwright's native recordVideo, one fresh page per tool so each clip stays short and focused),
// and saving everything into a VERSIONED directory (apps/extension/src/options/tutorial-assets/)
// since artifacts/ is gitignored and can't be the final destination for assets the Tutorial panel
// loads at runtime.
//
// Not part of CI -- run manually with `npm run tutorial:capture` and review the media before
// committing. Each tool capture is wrapped so one failure doesn't abort the whole batch; failures
// are reported at the end so they're easy to re-run individually later.
import { cp, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import { webcrypto } from "node:crypto";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);

// Playwright's own recordVideo writes raw, barely-compressed VP8 (screen-recording content with
// mostly flat colors/text compresses far better than its default settings assume) - a real capture
// once came out at 8.7MB for ~2 minutes; re-encoding the exact same pixels through the CRF-based
// path below brought that to 2.3MB with no visible quality loss (spot-checked frame by frame).
// ffmpeg itself isn't a project dependency; Playwright already downloads one for its own video
// pipeline, so this reuses that copy instead of adding a new one. If it can't be found (e.g. a
// Playwright version without the local ffmpeg build), compression is skipped with a warning
// rather than failing the whole capture run over an optimization.
async function locateFfmpeg() {
  if (process.env.QTS_FFMPEG_PATH) return process.env.QTS_FFMPEG_PATH;
  const cacheRoot = platform() === "win32" ? resolve(homedir(), "AppData/Local/ms-playwright")
    : platform() === "darwin" ? resolve(homedir(), "Library/Caches/ms-playwright")
      : resolve(homedir(), ".cache/ms-playwright");
  let entries = [];
  try { entries = await readdir(cacheRoot); } catch { return null; }
  const ffmpegDir = entries.find((entry) => entry.startsWith("ffmpeg-"));
  if (!ffmpegDir) return null;
  const binary = platform() === "win32" ? "ffmpeg-win64.exe" : platform() === "darwin" ? "ffmpeg-mac" : "ffmpeg-linux";
  const fullPath = join(cacheRoot, ffmpegDir, binary);
  try { await stat(fullPath); return fullPath; } catch { return null; }
}

async function compressVideo(ffmpegPath, videoPath) {
  if (!ffmpegPath) return;
  const tempPath = `${videoPath}.compressing.webm`;
  try {
    await execFileAsync(ffmpegPath, [
      "-y", "-i", videoPath,
      "-c:v", "libvpx", "-crf", "30", "-b:v", "0", "-qmin", "10", "-qmax", "42",
      "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", "-an",
      tempPath,
    ]);
    const [originalSize, compressedSize] = await Promise.all([stat(videoPath), stat(tempPath)]).then((sizes) => sizes.map((s) => s.size));
    if (compressedSize > 0 && compressedSize < originalSize) {
      await rename(tempPath, videoPath);
      trace(`compressed ${videoPath.split(/[\\/]/).pop()}: ${(originalSize / 1024).toFixed(0)}KB -> ${(compressedSize / 1024).toFixed(0)}KB`);
    } else {
      await rm(tempPath, { force: true });
    }
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    trace(`video compression skipped for ${videoPath.split(/[\\/]/).pop()}: ${error.message}`);
  }
}

const root = resolve(import.meta.dirname, "..");
async function readEnvValue(path, key) {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${key}=`)) return trimmed.slice(key.length + 1);
    }
  } catch {}
  return undefined;
}
const accessTokenPrivateKeyJwk = await readEnvValue(resolve(root, ".env"), "ACCESS_TOKEN_PRIVATE_KEY_JWK");
if (!accessTokenPrivateKeyJwk) throw new Error("Missing ACCESS_TOKEN_PRIVATE_KEY_JWK in .env.");
const accessTokenSigningKey = await webcrypto.subtle.importKey("jwk", JSON.parse(accessTokenPrivateKeyJwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
async function signMockAccessToken(payload) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1_000) + 600 };
  const encodedPayload = Buffer.from(new TextEncoder().encode(JSON.stringify(body))).toString("base64url");
  const signature = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, accessTokenSigningKey, new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${Buffer.from(signature).toString("base64url")}`;
}
const extensionPath = resolve(root, "apps/extension");
const captureOnly = String(process.env.QTS_TUTORIAL_CAPTURE_ONLY || "").trim();
const captureSuffix = captureOnly ? `-${captureOnly.replace(/[^a-z0-9_-]/gi, "-")}` : "";
const profilePath = resolve(root, `artifacts/chrome-tutorial-capture-profile${captureSuffix}`);
const videoTmpPath = resolve(root, `artifacts/tutorial-video-tmp${captureSuffix}`);
const finalAssetsPath = resolve(root, "apps/extension/src/options/tutorial-assets");
const assetsPath = resolve(root, "artifacts/tutorial-assets-current");
const sandboxRoot = resolve(root, "apps/landing/public");
const capturePort = captureOnly ? 43119 + [...captureOnly].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 1000 : 43118;
const DEMO_URL = `http://127.0.0.1:${capturePort}/sandbox/index.html`;
const trace = (label) => console.log(`[tutorial-capture] ${label}`);
await rm(profilePath, { recursive: true, force: true });
await rm(videoTmpPath, { recursive: true, force: true });
if (!captureOnly) await rm(assetsPath, { recursive: true, force: true });
await mkdir(assetsPath, { recursive: true });
await mkdir(videoTmpPath, { recursive: true });
const ffmpegPath = await locateFfmpeg();
trace(ffmpegPath ? `found ffmpeg for video compression: ${ffmpegPath}` : "ffmpeg not found - captured videos will keep Playwright's raw (larger) encoding");

const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const sandboxServer = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", DEMO_URL).pathname);
    const filePath = resolve(sandboxRoot, `.${pathname}`);
    if (!filePath.startsWith(sandboxRoot)) throw new Error("invalid_path");
    const resolvedFile = pathname.endsWith("/") ? resolve(filePath, "index.html") : filePath;
    const handle = await open(resolvedFile, "r");
    try {
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile()) throw new Error("invalid_file");
      response.writeHead(200, { "content-type": mimeTypes[extname(resolvedFile)] || "application/octet-stream", "cache-control": "no-store, max-age=0" });
      response.end(await handle.readFile());
    } finally {
      await handle.close();
    }
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Not found");
  }
});
await new Promise((resolveReady) => sandboxServer.listen(capturePort, "127.0.0.1", resolveReady));

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  // Business rule: tutorial recordings must remain readable without rushing through the UI.
  // Playwright's slowMo applies this pause to every click, fill, select, key and mouse action,
  // including future capture steps added to this file.
  slowMo: 3_000,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--window-position=20,20", "--window-size=1440,960", "--no-first-run"],
  viewport: { width: 1440, height: 960 },
  recordVideo: { dir: videoTmpPath, size: { width: 1440, height: 960 } },
});
context.setDefaultTimeout(15_000);

const fakeSession = {
  accessToken: "test-access-token-with-more-than-twenty-characters",
  refreshToken: "test-refresh-token",
  expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
  user: { id: "00000000-0000-4000-8000-000000000001", email: "tutorial-capture@example.com" },
};
await context.route("https://xhusvkylbouwtpcevgri.supabase.co/functions/v1/**", async (route) => {
  const name = new URL(route.request().url()).pathname.split("/").pop();
  if (name === "auth-sign-in" || name === "auth-refresh") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeSession) });
  // All plan-gated features enabled -- this run is about capturing what each tool looks like in
  // action, not about exercising the lock/upgrade UI (that's covered by the real smoke test).
  if (name === "access-status") {
    const plan = { key: "release-manager", name: "Release Manager" };
    const features = { "characterCounter.enabled": true, "multiClick.enabled": true, "inputLab.enabled": true, "fakerFill.enabled": true, "macroStudio.enabled": true, "keyView.enabled": true, "elementCapture.enabled": true, "stepsRecorder.enabled": true };
    const token = await signMockAccessToken({ active: true, plan, features });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ active: true, plan, source: "manual", expiresAt: null, features, token, checkedAt: new Date().toISOString() }) });
  }
  if (name === "legal-registration") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, status: "payment_pending", softwareName: "QA Toolbar Sandbox", holderName: "Matheus Alves Bonotto Santos", protocolNumber: null, protocolDate: null, registrationNumber: null, grantDate: null, publicQueryUrl: null, publicNotice: null, updatedAt: new Date().toISOString() }) });
  return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
});

const failures = [];

// Every fresh page starts unauthenticated in a persistent context UNLESS storage state carries
// over -- chrome.storage.local (extension-scoped) already persists automatically per profile, so
// the session/workspace seeded once via the options page below is visible to every later page.
async function waitForToolbar(page) {
  await page.goto(DEMO_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator("#qts-toolbar-host").waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function openToolByMenu(page, menuItemId) {
  await page.locator("#toolsButton").click();
  await page.locator(`#${menuItemId}`).click();
}

// The sandbox site (apps/landing/public/sandbox) shows one category "page" at a time behind a
// left sidebar nav -- only Text Box is visible by default, so any capture that touches the
// Practice Form fields (contactName/contactEmail/contactDepartment/contactSubmit) needs this
// first or those locators are hidden and every action below times out.
async function showSandboxPage(page, pageId) {
  const link = page.locator(`[data-page-link="${pageId}"]`);
  if (!(await link.isVisible())) {
    const category = page.locator(".nav-category").filter({ has: link });
    await category.locator(".nav-category-btn").click();
  }
  await link.click();
}

async function closeDrawer(page) {
  await page.locator("#drawerClose").click().catch(() => {});
}

// One fresh page per tool keeps each recorded .webm short and focused on that single tool, instead
// of one long video covering the whole session -- Playwright's recordVideo is context-scoped, so a
// page's own clip is finalized (and renameable via page.video().saveAs) once that page closes.
async function captureTool(key, action) {
  if (captureOnly && captureOnly !== key) return;
  const page = await context.newPage();
  try {
    await waitForToolbar(page);
    const captureResult = await action(page);
    await page.waitForTimeout(1_200);
    if (captureResult?.skipFinalScreenshot !== true) {
      await page.screenshot({ path: resolve(assetsPath, `${key}.png`), fullPage: false });
    }
    const video = page.video();
    await page.close();
    if (video) {
      const videoPath = resolve(assetsPath, `${key}.webm`);
      await video.saveAs(videoPath);
      await compressVideo(ffmpegPath, videoPath);
    }
    trace(`captured ${key}.png + ${key}.webm`);
  } catch (error) {
    failures.push(key);
    trace(`FAILED ${key}: ${error.message}`);
    await page.close().catch(() => {});
  }
}

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await options.locator("#loginEmail").fill("tutorial-capture@example.com");
  await options.locator("#loginPassword").fill("safe-test-password");
  await options.locator("#loginForm button[type=submit]").click();
  // Authentication can take longer while several isolated tutorial captures run in parallel.
  // Keep the generous bound above the mandatory 3s interaction pacing so a healthy login is not
  // mislabeled as a failure merely because Chromium is encoding another clip at the same time.
  await options.locator('.protectedNav[data-tab="workspace"]:not(:disabled)').waitFor({ timeout: 45_000 });
  await options.locator("#settingsTourSkip").click({ force: true }).catch(() => {});
  trace("authenticated");

  await options.getByRole("button", { name: "Workspace", exact: true }).click();
  await options.locator('[data-open-composer="clientComposer"]').click();
  await options.locator("#clientName").fill("Cliente Demo");
  await options.locator("#clientAbbreviation").fill("CD");
  await options.locator("#clientForm button[type=submit]").click();
  await options.locator('[data-open-composer="projectComposer"]').click();
  await options.locator("#projectClient").selectOption({ label: "Cliente Demo" });
  await options.locator("#projectName").fill("Projeto Demo");
  await options.locator("#projectForm button[type=submit]").click();
  await options.locator('[data-open-composer="productComposer"]').click();
  await options.locator("#productProject").selectOption({ label: "Projeto Demo" });
  await options.locator("#productName").fill("Produto Demo");
  await options.locator("#productForm button[type=submit]").click();
  await options.locator('[data-workspace-nav="environments"]').click();
  await options.locator('.composerTrigger[data-open-composer="environmentComposer"]').click();
  await options.locator("#environmentName").fill("QA");
  await options.locator("#environmentColor").fill("#2563eb");
  await options.locator("#environmentForm button[type=submit]").click();
  await options.locator('[data-workspace-nav="urls"]').click();
  for (const pattern of [`http://127.0.0.1:${capturePort}/sandbox/*`]) {
    await options.locator('[data-open-composer="urlRelationComposer"]').click();
    await options.locator('#urlProductPicker [data-url-product]', { hasText: "Produto Demo" }).click();
    await options.locator("#urlPatternInput").fill(pattern);
    await options.locator("#urlPatternAdd").click();
    await options.locator(".environmentToggle", { hasText: "QA" }).last().click();
    await options.locator("#urlRelationForm button[type=submit]").click();
  }

  // Seed a test account, a payment method and a resource too, so the corresponding tools have
  // something real to display instead of an empty drawer.
  if (!captureOnly) {
  await options.locator('[data-workspace-nav="accounts"]').click();
  await options.locator('[data-open-composer="testAccountComposer"]').click();
  await options.locator('#testAccountScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator('#testAccountScopePicker [data-facet-panel="environmentIds"] label', { hasText: "QA" }).last().locator("input").check();
  await options.locator('#testAccountScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator("#testAccountLabel").fill("Conta sandbox");
  await options.locator("#testAccountUsername").fill("sandbox@example.com");
  await options.locator("#testAccountPassword").fill("local-password-value");
  await options.locator("#testAccountForm button[type=submit]").click();
  await options.locator('[data-workspace-nav="payments"]').click();
  await options.locator('[data-open-composer="paymentMethodComposer"]').click();
  await options.locator('#paymentMethodScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator('#paymentMethodScopePicker [data-facet-panel="environmentIds"] label', { hasText: "QA" }).last().locator("input").check();
  await options.locator('#paymentMethodScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator("#paymentMethodLabel").fill("Visa sandbox");
  await options.locator("#paymentMethodValue").fill("4242424242424242");
  await options.locator("#paymentMethodForm button[type=submit]").click();
  await options.locator('[data-workspace-nav="integrations"]').click();
  await options.locator('[data-open-composer="resourceComposer"]').click();
  await options.locator("#resourceLabel").fill("Runbook QA");
  await options.locator("#resourceUrl").fill("https://example.com/runbook");
  await options.locator("#resourceForm button[type=submit]").click();
  }
  trace("workspace ready (client/project/product/environment/URLs/account/payment/resource)");

  if (!captureOnly) {
  await options.locator('[data-workspace-nav="structure"]').click();
  await options.screenshot({ path: resolve(assetsPath, "workspace-setup.png"), fullPage: true });
  trace("captured workspace-setup.png");

  // Close the long setup page without publishing its recording. A fresh page below records only
  // the concise demonstration, keeping the shipped tutorial clip small and easy to follow.
  await options.close();
  const walkthrough = await context.newPage();
  await walkthrough.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await walkthrough.locator('.protectedNav[data-tab="general"]:not(:disabled)').waitFor();
  await walkthrough.locator('.navItem[data-tab="general"]').click();
  await walkthrough.waitForTimeout(700);
  await walkthrough.locator('[data-theme-choice="light"]').click();
  await walkthrough.waitForTimeout(550);
  await walkthrough.locator('[data-theme-choice="dark"]').click();
  // Every shipped tutorial asset must end in the product default, never in the temporary dark
  // demonstration state used one action earlier.
  await walkthrough.locator('[data-color-family="blue"]').click();
  await walkthrough.locator('.navItem[data-tab="workspace"]').click();
  const demos = [
    ["structure", "clientComposer"], ["structure", "projectComposer"], ["structure", "productComposer"],
    ["environments", "environmentComposer"], ["urls", "urlRelationComposer"], ["accounts", "testAccountComposer"],
    ["payments", "paymentMethodComposer"], ["integrations", "inspectorComposer"], ["integrations", "apiComposer"],
    ["integrations", "resourceComposer"],
  ];
  for (const [tab, composer] of demos) {
    await walkthrough.locator(`[data-workspace-nav="${tab}"]`).click();
    await walkthrough.locator(`[data-open-composer="${composer}"]`).first().click();
    await walkthrough.waitForTimeout(500);
    await walkthrough.locator(`#${composer} [data-close-composer]`).first().click();
  }
  await walkthrough.locator('.navItem[data-tab="data"]').click();
  await walkthrough.waitForTimeout(1_000);
  await walkthrough.locator('.navItem[data-tab="tutorial"]').click();
  await walkthrough.waitForTimeout(700);
  await walkthrough.locator('.navItem[data-tab="faq"]').click();
  await walkthrough.waitForTimeout(700);
  const walkthroughVideo = walkthrough.video();
  await walkthrough.close();
  if (walkthroughVideo) {
    const walkthroughVideoPath = resolve(assetsPath, "workspace-setup.webm");
    await walkthroughVideo.saveAs(walkthroughVideoPath);
    await compressVideo(ffmpegPath, walkthroughVideoPath);
  }
  trace("captured workspace-setup.webm (appearance + complete Workspace CRUD walkthrough)");
  } else {
    // A filtered recapture still needs the authenticated Workspace/URL seed above, but must not
    // spend minutes recreating unrelated media or fail on a full-page screenshot it will not use.
    await options.close();
  }

  await captureTool("testStatus", async (page) => {
    await openToolByMenu(page, "statusMenuItem");
    await page.locator("#qts-test-status-modal").waitFor();
    await page.waitForTimeout(1_400); // let the four status options sit on screen before picking one
    await page.screenshot({ path: resolve(assetsPath, "testStatus.png"), fullPage: false });
    await page.locator('#qts-test-status-modal [data-status="pass"]').click();
    await page.waitForTimeout(600); // show the after-click result, not just the picker
    return { skipFinalScreenshot: true };
  });

  await captureTool("passFail", async (page) => {
    await showSandboxPage(page, "practice-form");
    await page.locator("#passButton").click();
    await page.locator("#contactName-label").click({ force: true });
    // Reveal the marker's own controls (resize/hide/remove/drag) so the clip shows what's
    // available on a placed marker, not just the marker itself.
    await page.locator(".qts-marker [data-visibility-toggle]").click();
    await page.waitForTimeout(1_000);
    const handle = page.locator(".qts-marker [data-drag-handle]");
    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 });
      await page.mouse.up();
    }
  });

  await captureTool("notesShapes", async (page) => {
    await openToolByMenu(page, "notesMenuItem");
    await page.locator(".qts-note textarea").fill("Confirmar mensagem de erro com o time de produto");
    await page.locator(".qts-note [data-save]").click();
    await page.waitForTimeout(400);
    await openToolByMenu(page, "shapesMenuItem");
    await page.locator('[data-shape-pick="rectangle"]').click();
    await page.mouse.move(300, 420);
    await page.mouse.down();
    await page.mouse.move(520, 560, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  });

  await captureTool("line", async (page) => {
    await openToolByMenu(page, "shapesMenuItem");
    await page.locator('[data-shape-pick="line"]').click();
    await page.mouse.move(280, 420);
    await page.mouse.down();
    await page.mouse.move(560, 420, { steps: 10 });
    await page.mouse.up();
    await page.locator(".qts-line [data-visibility-toggle]").click();
    await page.locator(".qts-line .qts-edit-btn").click();
    await page.locator('[name="line-end"][value="arrow"]').check({ force: true });
    // Keep the editor open in the final frame so the screenshot documents the icon-only endpoint
    // controls instead of showing only the resulting line after the controls have disappeared.
    await page.locator(".qts-line-endpoint-options").last().waitFor();
  });

  await captureTool("blurElements", async (page) => {
    await showSandboxPage(page, "practice-form");
    await openToolByMenu(page, "blurElementsMenuItem");
    await page.locator("#blurSelectElement").click();
    await page.locator("#contactName").click();
    await page.waitForTimeout(600);
  });

  await captureTool("holofote", async (page) => {
    await openToolByMenu(page, "holofoteMenuItem");
    await page.locator("#holofoteToggle").click();
    await closeDrawer(page);
    await page.mouse.move(420, 380);
    await page.mouse.down();
    await page.waitForTimeout(3_400);
  });

  await captureTool("pixelPerfect", async (page) => {
    await openToolByMenu(page, "pixelPerfectMenuItem");
    await page.locator("#pixelPerfectToggle").click();
    await closeDrawer(page);
    await page.mouse.move(280, 260);
    await page.mouse.click(280, 260);
    await page.mouse.move(560, 420, { steps: 12 });
    await page.waitForTimeout(600);
  });

  await captureTool("screenshot", async (page) => {
    await page.locator("#screenshotButton").click().catch(() => {});
  });

  await captureTool("recording", async (page) => {
    // Real screen recording needs OS-level display-capture consent that automation can't safely
    // drive -- hover the button (visible + highlighted) instead of clicking it, so the clip shows
    // the real UI without triggering getDisplayMedia().
    await page.locator("#recordToggleButton").hover();
  });

  await captureTool("clickSpy", async (page) => {
    await showSandboxPage(page, "practice-form");
    await openToolByMenu(page, "clickSpyMenuItem");
    await page.locator("#contactName").hover();
  });

  await captureTool("freezeClock", async (page) => {
    await openToolByMenu(page, "freezeClockMenuItem");
  });

  await captureTool("forceHttp", async (page) => {
    await openToolByMenu(page, "forceHttpMenuItem");
  });

  await captureTool("errorMonitor", async (page) => {
    await openToolByMenu(page, "errorMonitorMenuItem");
  });

  await captureTool("inspectors", async (page) => {
    await openToolByMenu(page, "inspectorsMenuItem");
  });

  await captureTool("jsonStudio", async (page) => {
    await openToolByMenu(page, "jsonStudioMenuItem");
    await page.locator("#jsonInput").fill('{"ok":true,"example":"qa-toolbar-sandbox"}');
    await page.locator("#jsonFormat").click();
  });

  await captureTool("breakpoints", async (page) => {
    await openToolByMenu(page, "breakpointMenuItem");
    await page.locator("#bpStage .qts-bp-frame").nth(1).waitFor();
    // The frames themselves attach fast, but the mobile-sized iframe still needs a moment to
    // actually paint the page inside it -- without this the clip/screenshot caught an empty frame.
    await page.locator("#bpStage .qts-bp-frame").nth(1).locator("iframe").waitFor();
    await page.waitForTimeout(1_800);
  });

  await captureTool("characterCounter", async (page) => {
    await openToolByMenu(page, "characterCounterMenuItem");
    await page.locator("#characterCounterInput").fill("QA Toolbar Sandbox\nTeste de contagem");
  });

  await captureTool("multiClick", async (page) => {
    await showSandboxPage(page, "practice-form");
    await openToolByMenu(page, "multiClickMenuItem");
    await page.locator("#multiSelect").click();
    await page.locator("#contactSubmit").click();
    await page.locator("#multiCount").fill("3");
    await page.locator("#multiInterval").fill("150");
    await page.locator("#multiRun").click();
  });

  await captureTool("inputLab", async (page) => {
    await showSandboxPage(page, "practice-form");
    await openToolByMenu(page, "inputLabMenuItem");
    await page.locator("#inputSelect").click();
    await page.locator("#contactName").click();
    await page.locator("#inputRun").click();
    await page.locator("#inputResults tbody tr").first().waitFor();
  });

  await captureTool("fakerFill", async (page) => {
    await openToolByMenu(page, "fakerFillMenuItem");
    await page.locator("#fakerRun").click();
  });

  await captureTool("macroStudio", async (page) => {
    await showSandboxPage(page, "practice-form");
    await openToolByMenu(page, "macroStudioMenuItem");
    await page.locator("#startMacroRecording").click();
    await page.locator("#contactName").click();
    await page.keyboard.type("QA Toolbar Sandbox");
    await page.locator("#contactName").press("Tab");
    await page.locator("#macroRecDoneButton").click();
    await page.locator("#macroSave").click();
    await page.locator("#macroList .qts-card").first().waitFor();
  });

  await captureTool("stepsRecorder", async (page) => {
    await showSandboxPage(page, "practice-form");
    await openToolByMenu(page, "stepsRecorderMenuItem");
    await page.locator("#newStepsName").fill("Validar cadastro de usuário");
    await page.locator("#startSteps").click();
    await page.locator("#contactName").fill("Matheus QA");
    await page.locator("#contactEmail").fill("qa@example.com");
    await page.locator("#stepsRecPauseButton").click();
    await page.waitForTimeout(700);
    await page.locator("#stepsRecPauseButton").click();
    await page.locator("#contactSubmit").click();
    await page.waitForTimeout(900);
    await page.locator("#stepsRecDoneButton").click();
    // No upfront mode picker anymore - numbered vs Gherkin is a view toggle in the editor now.
    await page.locator("#stepsMode").selectOption("gherkin");
    await page.locator('[data-doc-step="0"] summary').click();
    await page.locator('[data-doc-step="0"] [data-step-expected]').fill("Formulário disponível para preenchimento");
    await page.waitForTimeout(1_200);
  });

  await captureTool("keyView", async (page) => {
    await openToolByMenu(page, "keyViewMenuItem");
    await page.locator("#keyViewTyping").check();
    await page.locator("#keyViewToggle").click();
    // Keep the configured drawer visible in the final frame: the transient typing overlay fades
    // during the mandatory 3s pacing and previously produced a nearly blank screenshot.
    await page.locator(".qts-key-view-preview").waitFor();
  });

  await captureTool("elementCapture", async (page) => {
    await openToolByMenu(page, "elementCaptureMenuItem");
    await page.getByText(/elemento\(s\) encontrado\(s\)/).waitFor();
  });

  await captureTool("languageValidator", async (page) => {
    await openToolByMenu(page, "languageValidatorMenuItem");
    await page.locator("#languageFile").setInputFiles({ name: "pt-BR.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ title: "QA Toolbar Sandbox", missing: "Texto pendente" })) });
    await page.getByText(/textos encontrados/).waitFor();
  });

  await captureTool("qrCode", async (page) => {
    await openToolByMenu(page, "qrCodeMenuItem");
    await page.locator("#qrCanvas").waitFor();
    await page.waitForFunction(() => document.querySelector("#qts-toolbar-host")?.shadowRoot?.querySelector("#qrStatus")?.textContent?.startsWith("http"));
  });

  await captureTool("testAccounts", async (page) => {
    await openToolByMenu(page, "testAccountsMenuItem");
  });

  await captureTool("paymentMethods", async (page) => {
    await openToolByMenu(page, "paymentMethodsMenuItem");
  });

  await captureTool("resources", async (page) => {
    await openToolByMenu(page, "resourcesMenuItem");
  });

  const expectedMediaKeys = [
    "workspace-setup", "testStatus", "passFail", "notesShapes", "line", "blurElements", "holofote",
    "pixelPerfect", "screenshot", "recording", "clickSpy", "freezeClock", "forceHttp", "errorMonitor",
    "inspectors", "jsonStudio", "breakpoints", "characterCounter", "multiClick", "inputLab", "fakerFill",
    "macroStudio", "stepsRecorder", "keyView", "elementCapture", "languageValidator", "qrCode", "testAccounts", "paymentMethods", "resources",
  ];
  const mediaKeysToValidate = captureOnly ? [captureOnly] : expectedMediaKeys;
  for (const key of mediaKeysToValidate) {
    for (const extension of ["png", "webm"]) {
      try { await stat(resolve(assetsPath, `${key}.${extension}`)); }
      catch { failures.push(`${key}.${extension}`); }
    }
  }
  if (failures.length) {
    trace(`done with failures: ${failures.join(", ")} -- existing tutorial assets were preserved`);
    process.exitCode = 1;
  } else if (captureOnly) {
    await mkdir(finalAssetsPath, { recursive: true });
    for (const extension of ["png", "webm"]) {
      await cp(resolve(assetsPath, `${captureOnly}.${extension}`), resolve(finalAssetsPath, `${captureOnly}.${extension}`));
    }
    trace(`done: ${captureOnly}.png and ${captureOnly}.webm were refreshed`);
  } else {
    await rm(finalAssetsPath, { recursive: true, force: true });
    await cp(assetsPath, finalAssetsPath, { recursive: true });
    trace("done: every tutorial screenshot and video was atomically replaced with the current blue light capture");
  }
} finally {
  await context.close();
  await new Promise((resolveClosed) => sandboxServer.close(resolveClosed));
  await rm(videoTmpPath, { recursive: true, force: true });
}
