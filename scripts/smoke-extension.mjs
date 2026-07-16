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

const server = createServer((request, response) => {
  if (request.url === "/api/data") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ hello: "world", nested: { count: 3 } }));
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end("<!doctype html><html><head><title>QA Smoke Host</title></head><body style='margin:0;font:16px sans-serif'><main style='padding:80px 30px'><h1>Site qualquer, sem configuração prévia</h1><p>A barra deve aparecer aqui por padrão.</p><a id='sampleLink' href='https://example.com/destino'>Link de exemplo</a></main></body></html>");
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
  await page.locator("#qts-result-overlay").waitFor({ state: "detached", timeout: 5_000 });

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

  // Tools menu: open it once via the button, exercising the dropdown itself.
  const openTools = () => page.locator("#toolsButton").click();

  // Freeze Clock: Date.now() must stop advancing while frozen, then resume.
  await openTools();
  await page.locator("#freezeClockMenuItem").click();
  await page.waitForTimeout(200);
  const frozenA = await page.evaluate(() => Date.now());
  await page.waitForTimeout(300);
  const frozenB = await page.evaluate(() => Date.now());
  if (frozenA !== frozenB) throw new Error(`Freeze Clock did not freeze Date.now(): ${frozenA} vs ${frozenB}`);
  await openTools();
  await page.locator("#freezeClockMenuItem").click();
  await page.waitForTimeout(150);
  const resumedA = await page.evaluate(() => Date.now());
  await page.waitForTimeout(150);
  const resumedB = await page.evaluate(() => Date.now());
  if (resumedA === resumedB) throw new Error("Freeze Clock did not resume Date.now() after toggling off");

  // Force HTTP: arm a 500, trigger a fetch, confirm the forced status came back and Inspectors captured it.
  await openTools();
  await page.locator("#forceHttpMenuItem").click();
  await page.locator("[data-status='500']").click();
  const forcedStatus = await page.evaluate(() => fetch("/api/data").then((response) => response.status));
  if (forcedStatus !== 500) throw new Error(`Force HTTP did not apply, got status ${forcedStatus}`);

  // A second, un-forced fetch should capture the real JSON payload for the Inspectors list.
  await page.evaluate(() => fetch("/api/data").then((response) => response.json()));
  await page.waitForTimeout(200);
  await openTools();
  await page.locator("#inspectorsMenuItem").click();
  await page.locator(".qts-net-item").first().waitFor({ timeout: 2_000 });
  const netItemCount = await page.locator(".qts-net-item").count();
  if (netItemCount < 2) throw new Error(`Expected at least 2 captured network entries (forced + real), got ${netItemCount}`);

  // Search filters the list.
  await page.locator("#inspectorsSearch").fill("nested");
  await page.waitForTimeout(150);
  const filteredCount = await page.locator(".qts-net-item").count();
  if (filteredCount !== 1) throw new Error(`Expected search "nested" to leave exactly 1 result, got ${filteredCount}`);
  await page.locator("#inspectorsSearch").fill("");

  // Collapse toggle hides the filter/search chrome for a minimal view, and can be re-expanded.
  await page.locator("#inspectorsCollapseToggle").click();
  const collapsedVisible = await page.locator("#inspectorsFilterBar").isVisible();
  if (collapsedVisible) throw new Error("Inspectors filter bar should be hidden after collapsing");
  await page.locator("#inspectorsCollapseToggle").click();

  // Opening an entry defaults to the friendly view; the Raw toggle switches to the JSON tree.
  await page.locator(".qts-net-item").first().click();
  await page.locator(".qts-friendly-field, .qts-friendly-section").first().waitFor({ timeout: 2_000 });
  const rawVisibleBeforeToggle = await page.locator(".qts-json-tree").count();
  if (rawVisibleBeforeToggle !== 0) throw new Error("Raw view should not render until explicitly selected");
  await page.screenshot({ path: resolve(evidencePath, "vanilla-inspectors-friendly.png"), fullPage: false });
  await page.locator("[data-mode='raw']").click();
  await page.locator(".qts-json-tree").waitFor({ timeout: 2_000 });
  await page.screenshot({ path: resolve(evidencePath, "vanilla-inspectors-raw.png"), fullPage: false });
  await page.locator("#drawerClose").click();

  // JSON Studio: paste minified JSON, format it, confirm it becomes multi-line.
  await openTools();
  await page.locator("#jsonStudioMenuItem").click();
  await page.locator("#jsonInput").fill('{"a":1,"b":[1,2,3]}');
  await page.locator("#jsonFormat").click();
  const formattedJson = await page.locator("#jsonInput").inputValue();
  if (!formattedJson.includes("\n")) throw new Error("JSON Studio format did not pretty-print the JSON");
  await page.locator("#drawerClose").click();

  // Breakpoint Viewer: full-screen, both device panes load the URL typed in, scaled to the device's real size.
  await openTools();
  await page.locator("#breakpointMenuItem").click();
  await page.waitForTimeout(400);
  const bpState = await page.evaluate(() => {
    const host = document.querySelector("#qts-toolbar-host").shadowRoot;
    const overlay = host.querySelector(".qts-bp-overlay");
    const paneA = host.querySelector('[data-pane="a"] iframe');
    const paneB = host.querySelector('[data-pane="b"] iframe');
    return {
      isFullScreen: overlay ? getComputedStyle(overlay).position === "fixed" && overlay.getBoundingClientRect().width === window.innerWidth : false,
      srcA: paneA?.src, srcB: paneB?.src,
      transformA: paneA?.style.transform, transformB: paneB?.style.transform,
      hasLaptopChrome: Boolean(host.querySelector(".qts-bp-laptop-bar")),
      hasPhoneChrome: Boolean(host.querySelector(".qts-bp-phone-status")),
    };
  });
  if (!bpState.isFullScreen) throw new Error("Breakpoint Viewer should cover the full screen, not a sidebar");
  if (!bpState.srcA?.startsWith("http://127.0.0.1:43117") || !bpState.srcB?.startsWith("http://127.0.0.1:43117")) {
    throw new Error(`Breakpoint Viewer panes did not load the expected URL: ${JSON.stringify(bpState)}`);
  }
  if (!bpState.transformA?.includes("scale") || !bpState.transformB?.includes("scale")) {
    throw new Error("Breakpoint Viewer panes should emulate real device scale via CSS transform");
  }
  if (!bpState.hasLaptopChrome || !bpState.hasPhoneChrome) throw new Error("Breakpoint Viewer should render device/browser chrome for each pane kind");

  // Sync toggles are independent and reflect their on/off state visually.
  await page.locator("#bpSyncScroll").click();
  await page.locator("#bpSyncClick").click();
  const syncState = await page.evaluate(() => {
    const host = document.querySelector("#qts-toolbar-host").shadowRoot;
    return [host.getElementById("bpSyncScroll").classList.contains("isOn"), host.getElementById("bpSyncClick").classList.contains("isOn")];
  });
  if (!syncState[0] || !syncState[1]) throw new Error(`Expected both sync toggles to be on: ${JSON.stringify(syncState)}`);
  await page.locator("#bpSyncScroll").click();
  const scrollOffAfterToggle = await page.evaluate(() => document.querySelector("#qts-toolbar-host").shadowRoot.getElementById("bpSyncScroll").classList.contains("isOn"));
  if (scrollOffAfterToggle) throw new Error("Sync scroll toggle should turn off independently of sync click");

  await page.screenshot({ path: resolve(evidencePath, "vanilla-breakpoint-viewer.png"), fullPage: true });
  await page.locator("#bpClose").click();

  // Click Spy: activate, click the sample link, confirm it reports the destination instead of navigating.
  await openTools();
  await page.locator("#clickSpyMenuItem").click();
  await page.locator("#sampleLink").click();
  await page.locator(".qts-drawer").waitFor({ timeout: 2_000 });
  const clickSpyReport = await page.locator(".qts-drawer-body").textContent();
  if (!clickSpyReport.includes("example.com/destino")) throw new Error(`Click Spy did not report the link destination: ${clickSpyReport}`);
  if (page.url().includes("example.com")) throw new Error("Click Spy should not have actually navigated");
  await page.locator("#drawerClose").click();

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
    freezeClockWorks: true, forceHttpWorks: true, inspectorsCaptureWorks: true,
    jsonStudioWorks: true, breakpointViewerWorks: true, clickSpyWorks: true,
    consoleErrors: 0, workerErrors: 0,
  }));
} finally {
  await context.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
