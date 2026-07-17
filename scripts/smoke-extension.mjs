import { createServer } from "node:http";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
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
    // Bypasses the native getDisplayMedia picker so evidence recording can be exercised for real.
    "--auto-select-desktop-capture-source=QA Smoke Host",
    "--use-fake-ui-for-media-stream",
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

  // Evidence recording: start (real getDisplayMedia via --auto-select-desktop-capture-source,
  // no mocking), confirm the timer runs, pause, resume, then stop and confirm a real video
  // file downloads with a duration greater than zero.
  await page.locator("#recordToggleButton").click();
  await page.waitForFunction(() => {
    const host = document.querySelector("#qts-toolbar-host").shadowRoot;
    return host.getElementById("recordToggleButton").classList.contains("isActive");
  }, { timeout: 5_000 });
  await page.waitForTimeout(1_200);
  const timerAfterRecording = await page.locator("#recordTimer").textContent();
  if (timerAfterRecording === "00:00") throw new Error("Record timer did not advance while recording");
  await page.screenshot({ path: resolve(evidencePath, "vanilla-recording-active.png"), fullPage: false });

  await page.locator("#recordToggleButton").click(); // pause
  const isPaused = await page.evaluate(() => document.querySelector("#qts-toolbar-host").shadowRoot.getElementById("recordToggleButton").classList.contains("isPaused"));
  if (!isPaused) throw new Error("Record toggle should show paused state after pausing");
  await page.locator("#recordToggleButton").click(); // resume
  await page.waitForTimeout(800);

  const [recordingDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 8_000 }),
    page.locator("#recordStopButton").click(),
  ]);
  const recordingFilename = recordingDownload.suggestedFilename();
  if (!/^qa-evidencia-.+\.(mp4|webm)$/.test(recordingFilename)) {
    throw new Error(`Unexpected evidence recording filename: ${recordingFilename}`);
  }
  const recordingPath = await recordingDownload.path();
  const recordingStats = await stat(recordingPath);
  if (recordingStats.size < 1000) throw new Error(`Recorded evidence file looks empty: ${recordingStats.size} bytes`);
  const idleAfterStop = await page.evaluate(() => document.querySelector("#qts-toolbar-host").shadowRoot.getElementById("recordTimer").classList.contains("isHidden"));
  if (!idleAfterStop) throw new Error("Record timer should hide again once recording stops");

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
    const wrapA = host.querySelector('[data-pane="a"] [data-viewport-wrap]');
    const wrapB = host.querySelector('[data-pane="b"] [data-viewport-wrap]');
    return {
      isFullScreen: overlay ? getComputedStyle(overlay).position === "fixed" && overlay.getBoundingClientRect().width === window.innerWidth : false,
      srcA: paneA?.src, srcB: paneB?.src,
      transformA: paneA?.style.transform, transformB: paneB?.style.transform,
      hasLaptopChrome: Boolean(host.querySelector(".qts-bp-laptop-bar")),
      hasPhoneChrome: Boolean(host.querySelector(".qts-bp-phone-status")),
      renderedWidthA: wrapA?.getBoundingClientRect().width, renderedWidthB: wrapB?.getBoundingClientRect().width,
      renderedHeightA: wrapA?.getBoundingClientRect().height, renderedHeightB: wrapB?.getBoundingClientRect().height,
    };
  });
  if (!bpState.isFullScreen) throw new Error("Breakpoint Viewer should cover the full screen, not a sidebar");
  if (!bpState.srcA?.startsWith("http://127.0.0.1:43117") || !bpState.srcB?.startsWith("http://127.0.0.1:43117")) {
    throw new Error(`Breakpoint Viewer panes did not load the expected URL: ${JSON.stringify(bpState)}`);
  }
  // Pane A is the MacBook Air preset (1280x832), pane B is the iPhone 12 Pro Max preset (379x820) by
  // default — the monitor must always render bigger than the phone, on both axes, never the reverse.
  if (bpState.renderedWidthA <= bpState.renderedWidthB || bpState.renderedHeightA <= bpState.renderedHeightB) {
    throw new Error(`Desktop pane should render larger than the phone pane on both axes: ${JSON.stringify(bpState)}`);
  }
  if (!bpState.transformA?.includes("scale") || !bpState.transformB?.includes("scale")) {
    throw new Error("Breakpoint Viewer panes should emulate real device scale via CSS transform");
  }
  if (!bpState.hasLaptopChrome || !bpState.hasPhoneChrome) throw new Error("Breakpoint Viewer should render device/browser chrome for each pane kind");

  // Each pane must show its own scale label — a prior bug had both panes writing into the same
  // (unscoped) label element, so the desktop one silently never appeared.
  const scaleLabels = await page.locator("[data-scale-label]").allTextContents();
  if (!scaleLabels.some((text) => text.includes("MacBook")) || !scaleLabels.some((text) => text.includes("iPhone"))) {
    throw new Error(`Expected one scale label per pane (MacBook + iPhone), got: ${JSON.stringify(scaleLabels)}`);
  }

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

  // White-label badges: a client with no logo/abbreviation gets auto-derived initials.
  const clientBadgeText = await page.locator("#clientList .qts-badge-initials").textContent();
  if (!clientBadgeText || clientBadgeText.length > 4) throw new Error(`Expected short auto-derived client initials, got: ${clientBadgeText}`);

  // Project with an explicit abbreviation + name shown, product with an abbreviation but name hidden (icon-only).
  await page.locator("#projectClient").selectOption({ label: "Cliente Demo" });
  await page.getByPlaceholder("Nome do projeto").fill("Webapp Demo");
  await page.locator("#projectAbbreviation").fill("WEB");
  await page.locator("#projectForm button[type=submit]").click();
  await page.waitForTimeout(150);

  await page.locator("#productProject").selectOption({ label: "Webapp Demo" });
  await page.getByPlaceholder("Nome do produto").fill("AR");
  await page.locator("#productAbbreviation").fill("AR");
  await page.locator("#productShowLabel").uncheck();
  await page.locator("#productForm button[type=submit]").click();
  await page.waitForTimeout(150);

  await page.locator("#environmentProduct").selectOption({ label: "AR" });
  await page.getByPlaceholder("Nome do ambiente (ex.: QA, Staging)").fill("BETA");
  await page.getByPlaceholder("Padrões de URL, separados por vírgula").fill("http://127.0.0.1:43117/*");
  await page.locator("#environmentForm button[type=submit]").click();
  await page.waitForTimeout(150);

  // Test accounts: sandbox-only credentials scoped to an environment, masked by default.
  await page.locator("#testAccountEnvironment").selectOption({ label: "AR · BETA" });
  await page.getByPlaceholder("Nome da conta (ex.: Conta padrão)").fill("Conta Gold");
  await page.locator("#testAccountType").fill("Gold");
  await page.locator("#testAccountUsername").fill("gold.tester@example.com");
  await page.locator("#testAccountPassword").fill("s3nh4-super-secreta");
  await page.locator("#testAccountForm button[type=submit]").click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(evidencePath, "vanilla-options-workspace-full.png"), fullPage: true });

  const maskedPassword = await page.locator("#testAccountList .listRow small").last().textContent();
  if (maskedPassword.includes("s3nh4-super-secreta")) throw new Error("Password should be masked by default in the options list");

  await page.locator("#testAccountList [data-reveal]").click();
  const revealedPassword = await page.locator("#testAccountList .listRow small").last().textContent();
  if (!revealedPassword.includes("s3nh4-super-secreta")) throw new Error(`Expected revealed password in options list, got: ${revealedPassword}`);
  await page.locator("#testAccountList [data-reveal]").click();
  await page.waitForTimeout(150);

  const exportDownloadPromise = page.waitForEvent("download", { timeout: 8_000 });
  await page.evaluate(() => document.getElementById("exportButton").click());
  const exportDownload = await exportDownloadPromise;
  const exportPath = await exportDownload.path();
  const exportedJson = await readFile(exportPath, "utf8");
  if (exportedJson.includes("s3nh4-super-secreta")) throw new Error("Exported workspace JSON must never include test account passwords");
  if (!exportedJson.includes("gold.tester@example.com")) throw new Error("Exported workspace JSON should still include the non-secret username");

  const productBadgeHasName = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("#productList .listRow")).find((el) => el.textContent.includes("AR"));
    return row ? row.querySelector(".qts-badge-name") !== null : null;
  });
  if (productBadgeHasName !== false) throw new Error(`Expected product badge to hide its name (showLabel unchecked), found name element: ${productBadgeHasName}`);

  // Reload the test page: the environment now matches this URL, so the breadcrumb should render
  // client/project/product badges instead of the "no environment" fallback.
  await page.goto("http://127.0.0.1:43117/");
  await page.waitForTimeout(500);
  const breadcrumbAfterSetup = await page.evaluate(() => {
    const host = document.getElementById("qts-toolbar-host");
    const root = host?.shadowRoot;
    return {
      clientLabelHtml: root?.getElementById("clientLabel")?.innerHTML ?? null,
      clientLabelHidden: root?.getElementById("clientLabel")?.classList.contains("isHidden") ?? null,
      breadcrumbHtml: root?.getElementById("breadcrumb")?.innerHTML ?? null,
    };
  });
  if (breadcrumbAfterSetup.clientLabelHidden !== false) throw new Error("Client corner label should be visible once an environment matches");
  if (!breadcrumbAfterSetup.clientLabelHtml?.includes("qts-badge-avatar")) throw new Error(`Client label missing badge: ${breadcrumbAfterSetup.clientLabelHtml}`);
  if (!breadcrumbAfterSetup.breadcrumbHtml?.includes("Webapp Demo")) throw new Error(`Breadcrumb missing project name (showLabel on): ${breadcrumbAfterSetup.breadcrumbHtml}`);
  if (!breadcrumbAfterSetup.breadcrumbHtml?.includes("BETA")) throw new Error(`Breadcrumb missing environment name: ${breadcrumbAfterSetup.breadcrumbHtml}`);
  await page.screenshot({ path: resolve(evidencePath, "vanilla-breadcrumb-badges.png"), fullPage: false });

  // Toolbar-side test accounts drawer: read-only view scoped to the matching environment,
  // masked by default, with a per-account reveal toggle.
  await openTools();
  await page.locator("#testAccountsMenuItem").click();
  await page.locator(".qts-drawer-body .qts-net-item").waitFor({ timeout: 2_000 });
  const drawerMasked = await page.locator(".qts-drawer-body .qts-net-item").textContent();
  if (!drawerMasked.includes("Conta Gold") || drawerMasked.includes("s3nh4-super-secreta")) {
    throw new Error(`Test accounts drawer should show the account masked: ${drawerMasked}`);
  }
  await page.locator("[data-reveal-account]").click();
  const drawerRevealed = await page.locator(".qts-drawer-body .qts-net-item").textContent();
  if (!drawerRevealed.includes("s3nh4-super-secreta")) throw new Error(`Expected revealed password in toolbar drawer: ${drawerRevealed}`);
  await page.locator("#drawerClose").click();

  if (errors.length) throw new Error(`Console errors:\n${errors.join("\n")}`);
  if (workerErrors.length) throw new Error(`Background service worker errors:\n${workerErrors.join("\n")}`);
  console.log(JSON.stringify({
    extensionId, toolbarMountedByDefault: true, noEnvironmentConfigured: true,
    testStatusOverlayWorks: true, markerPlacementWorks: true, textNoteWorks: true,
    clearAllWorks: true, screenshotWorks: true, workspaceCrudWorks: true,
    freezeClockWorks: true, forceHttpWorks: true, inspectorsCaptureWorks: true,
    jsonStudioWorks: true, breakpointViewerWorks: true, clickSpyWorks: true,
    evidenceRecordingWorks: true, recordingFileSizeBytes: recordingStats.size,
    consoleErrors: 0, workerErrors: 0,
  }));
} finally {
  await context.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
