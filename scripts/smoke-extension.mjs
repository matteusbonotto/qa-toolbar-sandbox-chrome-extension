import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "apps/extension");
const profilePath = resolve(root, "artifacts/chrome-smoke-profile");
const evidencePath = resolve(root, "artifacts/runtime-evidence");
await rm(profilePath, { recursive: true, force: true });
await mkdir(evidencePath, { recursive: true });

const server = createServer((_request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end("<!doctype html><html><head><title>QA Smoke Host</title></head><body style='margin:0;font:16px sans-serif'><main style='padding:80px 30px'><h1>Site qualquer, sem configuração prévia</h1><p>A barra deve aparecer aqui por padrão.</p></main></body></html>");
});
await new Promise((resolveReady) => server.listen(43117, "127.0.0.1", resolveReady));

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--window-position=20,20",
    "--window-size=1400,900",
    "--no-first-run",
  ],
  viewport: { width: 1400, height: 900 },
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;

  const workerErrors = [];
  worker.on("console", (message) => { if (message.type() === "error") workerErrors.push(message.text()); });
  worker.on("pageerror", (error) => workerErrors.push(error.message));

  const errors = [];
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("http://127.0.0.1:43117/");
  await page.waitForTimeout(800);
  const toolbar = page.getByRole("toolbar", { name: "QA Toolbar Sandbox" });
  await toolbar.waitFor({ timeout: 10_000 });
  await page.screenshot({ path: resolve(evidencePath, "vanilla-default-any-site.png"), fullPage: false });

  const breadcrumbText = await page.evaluate(() => {
    const host = document.getElementById("qts-toolbar-host");
    return host?.shadowRoot?.getElementById("breadcrumb")?.textContent ?? null;
  });
  if (breadcrumbText !== "Nenhum ambiente configurado para esta URL") {
    throw new Error(`Unexpected breadcrumb on a fresh install: ${breadcrumbText}`);
  }

  // Test Status: open the modal, choose Pass, confirm the full-screen result overlay renders and clears itself.
  await page.locator("#testStatusButton").click();
  await page.locator("[data-status='pass']").click();
  await page.locator(".qts-result-overlay .qts-result-text").waitFor({ timeout: 2_000 });
  await page.screenshot({ path: resolve(evidencePath, "vanilla-test-status-overlay.png"), fullPage: false });
  await page.locator("#qts-result-overlay").waitFor({ state: "detached", timeout: 3_000 });

  // Pass marker: enable placement mode, click the page, confirm a draggable marker lands and Clear All appears.
  await page.locator("#passButton").click();
  await page.mouse.click(400, 300);
  await page.locator(".qts-marker").waitFor({ timeout: 2_000 });
  const clearAllVisibleAfterMarker = await page.evaluate(() => !document
    .querySelector("#qts-toolbar-host").shadowRoot.getElementById("clearAllButton").classList.contains("isHidden"));
  if (!clearAllVisibleAfterMarker) throw new Error("Clear All should be visible once a marker exists");

  // Text note: create one, save it, confirm the saved text renders.
  await page.locator("#noteButton").click();
  await page.locator(".qts-note textarea").fill("Nota de evidência");
  await page.locator(".qts-note [data-save]").click();
  await page.locator(".qts-note-content").waitFor({ timeout: 2_000 });
  const noteText = await page.locator(".qts-note-content").textContent();
  if (noteText !== "Nota de evidência") throw new Error(`Unexpected saved note text: ${noteText}`);
  await page.screenshot({ path: resolve(evidencePath, "vanilla-annotations.png"), fullPage: false });

  // Clear All removes every floating annotation and hides itself again.
  await page.locator("#clearAllButton").click();
  const remainingItems = await page.evaluate(() => document.querySelectorAll(".qts-floating-item").length);
  if (remainingItems !== 0) throw new Error(`Expected 0 floating items after Clear All, got ${remainingItems}`);

  // Screenshot button: exercises the full round trip to the background service worker and back.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 5_000 }),
    page.locator("#screenshotButton").click(),
  ]);
  if (!download.suggestedFilename().startsWith("qa-screenshot-")) {
    throw new Error(`Unexpected screenshot filename: ${download.suggestedFilename()}`);
  }

  const optionsUrl = `chrome-extension://${extensionId}/src/options/options.html`;
  await page.goto(optionsUrl);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(evidencePath, "vanilla-options-scope.png"), fullPage: true });
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByPlaceholder("Nome do cliente").fill("Cliente Demo");
  await page.getByRole("button", { name: "+ Criar" }).first().click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(evidencePath, "vanilla-options-workspace.png"), fullPage: true });

  const clientCount = await page.locator("#clientCount").textContent();
  if (clientCount !== "1") throw new Error(`Expected 1 client after creating one, got ${clientCount}`);

  if (errors.length) throw new Error(`Console errors:\n${errors.join("\n")}`);
  if (workerErrors.length) throw new Error(`Background service worker errors:\n${workerErrors.join("\n")}`);
  console.log(JSON.stringify({
    extensionId, toolbarMountedByDefault: true, noEnvironmentConfigured: true,
    testStatusOverlayWorks: true, markerPlacementWorks: true, textNoteWorks: true,
    clearAllWorks: true, screenshotWorks: true, workspaceCrudWorks: true,
    consoleErrors: 0, workerErrors: 0,
  }));
} finally {
  await context.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
