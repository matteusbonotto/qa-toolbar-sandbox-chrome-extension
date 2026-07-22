import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "apps/extension");
const profilePath = resolve(root, "artifacts/chrome-smoke-profile");
const evidencePath = resolve(root, "artifacts/runtime-evidence");
const trace = (label) => console.log(`[chrome-smoke] ${label}`);
await rm(profilePath, { recursive: true, force: true });
await mkdir(evidencePath, { recursive: true });

const server = createServer((request, response) => {
  if (request.url === "/api/data") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ hello: "world", nested: { count: 3 } }));
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html><head><title>QA Smoke Host</title></head><body style="margin:0;font:16px sans-serif"><main style="padding:90px 30px"><h1>Ambiente de teste</h1><button id="spaApp">Ir para /app</button><button id="spaOutside">Ir para /outside</button><button id="navMacro">Navegar na macro</button><a id="sampleLink" href="https://example.com/destino">Link de exemplo</a><hr><button id="multiTarget" type="button">Alvo</button><button id="macroTarget" type="button">Ação da macro</button><form id="qaForm"><label>Nome <input id="qaName" name="name" maxlength="12" required></label><label>E-mail <input id="qaEmail" name="email" type="email"></label><label>Observação <textarea id="macroText" name="notes"></textarea></label><label>Senha <input id="qaPassword" name="password" type="password"></label><label>Perfil <select id="qaProfile" name="profile"><option value="">Selecione</option><option value="qa">QA</option></select></label></form></main><script>spaApp.onclick=()=>history.pushState({},'', '/app?token=segredo-nao-pode-aparecer');spaOutside.onclick=()=>history.pushState({},'', '/outside');navMacro.onclick=()=>location.href='/app/next';multiTarget.onclick=()=>multiTarget.dataset.clicks=String(Number(multiTarget.dataset.clicks||0)+1);macroTarget.onclick=()=>macroTarget.dataset.clicks=String(Number(macroTarget.dataset.clicks||0)+1);</script></body></html>`);
});
await new Promise((resolveReady) => server.listen(43117, "127.0.0.1", resolveReady));

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--window-position=20,20", "--window-size=1400,900", "--no-first-run"],
  viewport: { width: 1400, height: 900 },
});
context.setDefaultTimeout(15_000);

const fakeSession = {
  accessToken: "test-access-token-with-more-than-twenty-characters",
  refreshToken: "test-refresh-token",
  expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
  user: { id: "00000000-0000-4000-8000-000000000001", email: "tester@example.com" },
};

await context.route("https://xhusvkylbouwtpcevgri.supabase.co/functions/v1/**", async (route) => {
  const name = new URL(route.request().url()).pathname.split("/").pop();
  if (name === "auth-sign-in" || name === "auth-refresh") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeSession) });
  if (name === "access-status") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ active: true, plan: { key: "release-manager", name: "Release Manager" }, source: "manual", expiresAt: null, features: { "characterCounter.enabled": true, "multiClick.enabled": true, "inputLab.enabled": true, "fakerFill.enabled": true, "macroStudio.enabled": true, "keyView.enabled": true, "elementCapture.enabled": true }, checkedAt: new Date().toISOString() }) });
  if (name === "legal-registration") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, status: "payment_pending", softwareName: "QA Toolbar Sandbox", holderName: "Matheus Alves Bonotto Santos", protocolNumber: null, protocolDate: null, registrationNumber: null, grantDate: null, publicQueryUrl: null, publicNotice: null, updatedAt: new Date().toISOString() }) });
  return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  const workerErrors = [];
  worker.on("console", (message) => { if (message.type() === "error") workerErrors.push(message.text()); });
  worker.on("pageerror", (error) => workerErrors.push(error.message));

  const host = await context.newPage();
  const hostErrors = [];
  host.on("console", (message) => { if (message.type() === "error") hostErrors.push(message.text()); });
  host.on("pageerror", (error) => hostErrors.push(error.message));
  await host.goto("http://127.0.0.1:43117/");
  await host.waitForTimeout(500);
  if (await host.locator("#qts-toolbar-host").count()) throw new Error("Toolbar mounted without authentication");

  const options = await context.newPage();
  const optionsErrors = [];
  options.on("console", (message) => { if (message.type() === "error") optionsErrors.push(message.text()); });
  options.on("pageerror", (error) => optionsErrors.push(error.message));
  await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await options.locator("#loginEmail").fill("tester@example.com");
  await options.locator("#loginPassword").fill("safe-test-password");
  await options.locator("#loginForm button[type=submit]").click();
  await options.locator('.protectedNav[data-tab="workspace"]:not(:disabled)').waitFor({ timeout: 10_000 });
  trace("authenticated");
  await options.locator('#langSwitch [data-locale="en"]').click();
  await options.getByRole("button", { name: "My account" }).waitFor();
  if (await options.locator("html").getAttribute("lang") !== "en") throw new Error("Options locale did not switch to English");
  if (await options.locator("#clientName").getAttribute("placeholder") !== "Client name") throw new Error("Options placeholders were not translated to English");
  if (!await options.getByText("Enable Key View", { exact: true }).count()) throw new Error("Key View settings were not translated to English");
  await options.locator('#langSwitch [data-locale="es"]').click();
  await options.getByRole("button", { name: "Mi cuenta" }).waitFor();
  if (await options.locator("#environmentName").getAttribute("placeholder") !== "Nombre del entorno (ej.: QA, Staging)") throw new Error("Options placeholders were not translated to Spanish");
  if (!await options.getByText("Activar Key View", { exact: true }).count()) throw new Error("Key View settings were not translated to Spanish");
  await options.locator('#langSwitch [data-locale="pt-BR"]').click();
  await options.getByRole("button", { name: "Minha conta" }).click();
  await options.locator("#signedInState").waitFor({ state: "visible" });
  await options.screenshot({ path: resolve(evidencePath, "extension-authenticated-account.png"), fullPage: true });

  await options.getByRole("button", { name: "Workspace" }).click();
  if (await options.locator(".workspaceTab").count() !== 6) throw new Error("Workspace Studio tabs are incomplete");
  await options.locator('[data-open-composer="clientComposer"]').click();
  await options.locator("#clientName").fill("Cliente Demo");
  await options.locator("#clientAbbreviation").fill("CD");
  await options.locator('#clientForm [data-image-file]').setInputFiles({ name: "client-logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#7657ff"/><circle cx="60" cy="40" r="24" fill="#42d5c2"/></svg>') });
  await options.waitForFunction(() => document.querySelector("#clientLogoUrl")?.value.startsWith("data:image/svg+xml"));
  await options.locator("#clientForm .imageEditButton").click();
  await options.locator("#imageEditorDialog[open]").waitFor();
  await options.locator("#imageEditorZoom").fill("1.35");
  await options.locator("#imageEditorX").fill("20");
  await options.locator("#imageEditorApply").click();
  if (!await options.locator("#clientLogoUrl").inputValue().then((value) => value.startsWith("data:image/webp"))) throw new Error("Image editor did not apply a safe local crop");
  await options.locator("#clientForm button[type=submit]").click();
  await options.locator('[data-open-composer="projectComposer"]').click();
  await options.locator("#projectClient").selectOption({ label: "Cliente Demo" });
  await options.locator("#projectName").fill("Webapp Demo");
  await options.locator("#projectAbbreviation").fill("WEB");
  await options.locator("#projectForm button[type=submit]").click();
  await options.locator('[data-open-composer="productComposer"]').click();
  await options.locator("#productProject").selectOption({ label: "Webapp Demo" });
  await options.locator("#productName").fill("Checkout");
  await options.locator("#productAbbreviation").fill("CHK");
  await options.locator("#productForm button[type=submit]").click();
  await options.locator('[data-workspace-tab="environments"]').click();
  await options.locator('.composerTrigger[data-open-composer="environmentComposer"]').click();
  await options.locator("#environmentName").fill("QA");
  await options.locator("#environmentColor").fill("#5b21b6");
  await options.locator("#environmentForm button[type=submit]").click();
  await options.locator('[data-workspace-tab="urls"]').click();
  await options.locator('[data-open-composer="urlRelationComposer"]').click();
  await options.locator("#urlRelationProduct").selectOption({ label: "Checkout" });
  await options.locator("#urlPatternInput").fill("http://127.0.0.1:43117/*");
  await options.locator(".environmentToggle", { hasText: "QA" }).click();
  await options.locator("#urlRelationForm button[type=submit]").click();
  await options.waitForTimeout(600);
  trace("primary workspace created");

  // Environments are reusable tiers (no product of their own); the product association — and one
  // pattern belonging to multiple environments — lives entirely on the URL binding.
  await options.locator('[data-workspace-tab="environments"]').click();
  await options.locator('.composerTrigger[data-open-composer="environmentComposer"]').click();
  await options.locator("#environmentName").fill("Beta");
  await options.locator("#environmentColor").fill("#0f766e");
  await options.locator("#environmentForm button[type=submit]").click();
  await options.locator('[data-workspace-tab="urls"]').click();
  await options.locator('[data-open-composer="urlRelationComposer"]').click();
  await options.locator("#urlRelationProduct").selectOption({ label: "Checkout" });
  await options.locator("#urlPatternInput").fill("http://beta.example.invalid/*");
  await options.locator(".environmentToggle", { hasText: "Beta" }).click();
  await options.locator("#urlRelationForm button[type=submit]").click();
  await options.locator('[data-open-composer="urlRelationComposer"]').click();
  await options.locator("#urlRelationProduct").selectOption({ label: "Checkout" });
  await options.locator("#urlPatternInput").fill("https://shared.example.com/*");
  await options.locator("[data-url-environment]").nth(0).click();
  await options.locator("[data-url-environment]").nth(1).click();
  await options.locator("#urlRelationForm button[type=submit]").click();
  const urlBindings = await options.evaluate(async () => {
    const stored = await chrome.storage.local.get("qtsWorkspaceV1");
    return stored.qtsWorkspaceV1.urlBindings.map((binding) => ({ patterns: binding.patterns, environmentIds: binding.environmentIds }));
  });
  const sharedBinding = urlBindings.find((binding) => binding.patterns.includes("https://shared.example.com/*"));
  if (!sharedBinding || sharedBinding.environmentIds.length !== 2) throw new Error(`Relational URL association failed: ${JSON.stringify(urlBindings)}`);
  // The URLs tab now groups bindings into one accordion per environment (see
  // renderUrlRelationList), so a binding shared across two environments (like this one) renders
  // once under EACH — two .listRow matches, not one — each still showing both environment badges.
  const sharedBindingRows = options.locator('#urlRelationList .listRow').filter({ hasText: "https://shared.example.com/*" });
  if (await sharedBindingRows.count() !== 2) throw new Error("Shared URL binding did not render once per linked environment accordion");
  if (await sharedBindingRows.first().locator(".relationBadge").count() !== 2) throw new Error("Relational URL UI did not show both linked environments");
  await options.screenshot({ path: resolve(evidencePath, "extension-options-workspace-studio.png"), fullPage: true });
  await options.evaluate(async () => {
    const next = await window.QTS_STORAGE.getWorkspace();
    for (let index = 0; index < 3; index += 1) next.environments.push({ id: `env_picker_${index}`, name: `Preview ${index + 1}`, color: "#5b21b6", active: true });
    await window.QTS_STORAGE.saveWorkspace(next);
  });
  await options.waitForFunction(() => document.querySelector("#environmentCount")?.textContent === "5");
  await options.locator('[data-open-composer="urlRelationComposer"]').click();
  await options.locator("#urlEnvironmentPicker .environmentMultiSelect > summary").click();
  await options.locator("[data-environment-search]").waitFor();
  if (await options.locator("[data-url-environment]").count()) throw new Error("URL environment picker did not switch to searchable multiselect above four environments");
  await options.locator("[data-environment-search]").fill("Beta");
  if (await options.locator('.multiSelectOptions [data-environment-option]:not([hidden])').count() !== 1) throw new Error("URL environment multiselect search did not filter environments");
  await options.locator("#urlRelationComposer [data-close-composer]").click();
  trace("workspace relationships verified");

  // Deletion now goes through a themed <dialog> instead of window.confirm() — verify both the
  // Cancelar (no-op) and Excluir (removes) paths against one of the injected preview environments.
  await options.locator('[data-workspace-tab="environments"]').click();
  const previewRow = options.locator("#environmentList .listRow", { hasText: "Preview 1" });
  await previewRow.locator('[data-action="remove"]').click();
  await options.locator("#deleteConfirmDialog[open]").waitFor();
  await options.locator("#deleteConfirmCancel").click();
  if (await options.locator("#deleteConfirmDialog[open]").count()) throw new Error("Delete confirmation dialog did not close on Cancelar");
  if (!(await previewRow.count())) throw new Error("Cancelar incorrectly deleted the item");
  await previewRow.locator('[data-action="remove"]').click();
  await options.locator("#deleteConfirmDialog[open]").waitFor();
  await options.locator("#deleteConfirmAccept").click();
  await options.waitForFunction(() => document.querySelector("#environmentCount")?.textContent === "4");
  if (await previewRow.count()) throw new Error("Excluir did not remove the item");
  trace("delete confirmation dialog verified");

  await host.reload();
  const toolbar = host.getByRole("toolbar", { name: "Ferramentas de QA" });
  await toolbar.waitFor({ timeout: 10_000 });
  const hierarchy = await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    return {
      barText: root?.getElementById("bar")?.textContent || "",
      clientText: root?.getElementById("clientLabel")?.textContent || "",
      contextText: root?.getElementById("breadcrumb")?.textContent || "",
      url: root?.getElementById("currentUrl")?.textContent || "",
      height: root?.getElementById("bar")?.getBoundingClientRect().height,
      background: getComputedStyle(root.getElementById("bar")).backgroundColor,
    };
  });
  if (hierarchy.barText.includes("QA Sandbox")) throw new Error("Toolbar still displays the QA Sandbox brand");
  if (!hierarchy.clientText.includes("Cliente Demo")) throw new Error(`Client row is missing: ${JSON.stringify(hierarchy)}`);
  for (const expected of ["Webapp Demo", "Checkout", "QA"]) if (!hierarchy.contextText.includes(expected)) throw new Error(`Context is missing ${expected}: ${JSON.stringify(hierarchy)}`);
  if (!hierarchy.url.includes("http://127.0.0.1:43117/")) throw new Error(`Current URL pill is missing: ${JSON.stringify(hierarchy)}`);
  // Founder feedback made the bar hug its content (min-height + 2px top/bottom padding) instead
  // of a fixed 48px box with a lot of empty space around the buttons — 37px is that new real
  // rendered height with the actual toolbar content, not a regression.
  if (hierarchy.height !== 37 || hierarchy.background !== "rgb(91, 33, 182)") throw new Error(`Toolbar layout/color mismatch: ${JSON.stringify(hierarchy)}`);
  await host.screenshot({ path: resolve(evidencePath, "extension-toolbar-hierarchy-url.png"), fullPage: false });
  const passSoundRequestPromise = host.waitForRequest((request) => request.url().endsWith("/src/assets/sounds/test-pass.mp3"));
  await host.locator("#testStatusButton").click();
  await host.locator('#qts-test-status-modal [data-status="pass"]').click();
  await passSoundRequestPromise;
  trace("toolbar hierarchy verified");

  // The first-run callout moved from a popup card (which sat right where the tour balloon and
  // evidence recordings needed that space) into the notification bell.
  if (await host.locator("#firstRunIntro").count()) throw new Error("First-run intro still renders as a popup card instead of a bell notification");
  await host.locator("#notificationBellButton").click();
  await host.getByText("A barra está pronta").waitFor({ timeout: 5_000 });
  await host.locator('[data-dismiss-intro]').click();
  if (await host.locator("#notificationBellBadge.isVisible").count()) throw new Error("Notification bell badge stayed visible after dismissing the first-run entry");
  await host.locator("#notificationBellButton").click();
  trace("first-run notification moved to the bell");

  // Shapes: Formato (rectangle/square/circle) constrains the box and sets the CSS radius;
  // Efeito "Borrão" swaps the color inputs for a blur-strength slider and applies a real
  // backdrop-filter instead of a color, so a sensitive area can be hidden instead of just outlined.
  await host.locator("#shapeButton").click();
  await host.mouse.move(300, 300);
  await host.mouse.down();
  await host.mouse.move(460, 420, { steps: 6 });
  await host.mouse.up();
  await host.locator(".qts-shape [data-visibility-toggle]").click();
  await host.locator(".qts-shape .qts-edit-btn").click();
  await host.locator("[data-shape-type]").selectOption("circle");
  const circleRadius = await host.locator(".qts-shape-box").evaluate((box) => getComputedStyle(box).borderRadius);
  if (!circleRadius.includes("50%")) throw new Error(`Shape "Círculo" did not apply a 50% radius: ${circleRadius}`);
  const [circleWidth, circleHeight] = await host.locator(".qts-shape").evaluate((shape) => [shape.offsetWidth, shape.offsetHeight]);
  if (circleWidth !== circleHeight) throw new Error(`Shape "Círculo" did not constrain to equal width/height: ${circleWidth}x${circleHeight}`);
  await host.locator("[data-shape-effect]").selectOption("blur");
  if (await host.locator("[data-shape-blur-control]").isHidden()) throw new Error("Blur-strength slider did not appear after selecting the Borrão effect");
  const blurFilter = await host.locator(".qts-shape-box").evaluate((box) => getComputedStyle(box).backdropFilter || getComputedStyle(box).webkitBackdropFilter);
  if (!blurFilter.includes("blur")) throw new Error(`Shape "Borrão" effect did not apply a real backdrop-filter blur: ${blurFilter}`);
  await host.locator(".qts-shape .qts-remove-btn").click();
  trace("shape formato/efeito (círculo + borrão) verified");

  // Borrar elementos: click-to-select (reusing the same selectPageElement UX as Element Capture),
  // toggles the blur on/off per element, re-arms itself for picking more than one, and "Limpar
  // todos" resets everything.
  await host.locator("#toolsButton").click();
  await host.locator("#blurElementsMenuItem").click();
  await host.locator("#blurSelectElement").click();
  await host.locator("#qaName").click();
  if (!(await host.locator("#qaName").evaluate((element) => element.classList.contains("qts-blurred-element")))) throw new Error("Borrar elementos did not blur the clicked element");
  await host.locator("#qaEmail").click();
  if (!(await host.locator("#qaEmail").evaluate((element) => element.classList.contains("qts-blurred-element")))) throw new Error("Borrar elementos did not blur a second element (selection did not re-arm)");
  await host.locator("#qaName").click();
  if (await host.locator("#qaName").evaluate((element) => element.classList.contains("qts-blurred-element"))) throw new Error("Clicking an already-blurred element did not undo the blur");
  await host.keyboard.press("Escape");
  await host.locator("#toolsButton").click();
  await host.locator("#blurElementsMenuItem").click();
  await host.locator("#blurClearAll").click();
  if (await host.locator("#qaEmail").evaluate((element) => element.classList.contains("qts-blurred-element"))) throw new Error('"Limpar todos os borrados" left an element blurred');
  await host.locator("#drawerClose").click();
  trace("borrar elementos tool verified (select, toggle, re-arm, clear all)");

  // Linha: drawn from two literal points (not a drag-to-size box), width matches the real
  // distance between them, and enabling the arrow endpoint adds the CSS class that renders it.
  await host.locator("#lineButton").click();
  await host.mouse.move(200, 200);
  await host.mouse.down();
  await host.mouse.move(400, 200, { steps: 6 });
  await host.mouse.up();
  const lineWidth = await host.locator(".qts-line").evaluate((line) => line.offsetWidth);
  if (Math.abs(lineWidth - 200) > 5) throw new Error(`Line width did not match the drawn distance: ${lineWidth}`);
  await host.locator(".qts-line [data-visibility-toggle]").click();
  await host.locator(".qts-line .qts-edit-btn").click();
  await host.locator("[data-line-arrow]").selectOption("end");
  if (!(await host.locator(".qts-line").evaluate((line) => line.classList.contains("hasArrow")))) throw new Error("Line arrow endpoint option did not apply");
  await host.locator(".qts-line .qts-remove-btn").click();
  if (await host.locator(".qts-line").count()) throw new Error("Removing the line did not remove it from the page");
  trace("linha com ponta de seta verified");

  // Holofote: never preventDefault's the real mouse events (the page must keep working while the
  // mode is on), only shows the spotlight after a genuine 3s hold, and fades back out on release.
  await host.locator("#toolsButton").click();
  await host.locator("#holofoteMenuItem").click();
  await host.locator("#holofoteToggle").click();
  await host.locator("#drawerClose").click();
  await host.mouse.move(320, 260);
  await host.mouse.down();
  if (await host.locator("#qts-holofote-overlay.isVisible").count()) throw new Error("Holofote appeared before the 3s hold threshold");
  await host.waitForTimeout(3_400);
  await host.locator("#qts-holofote-overlay.isVisible").waitFor({ timeout: 2_000 });
  await host.mouse.up();
  if (await host.locator("#qts-holofote-overlay.isVisible").count()) throw new Error("Holofote did not start fading out on release");
  if (!(await host.locator("h1").isVisible())) throw new Error("Holofote mode blocked normal page interaction");
  await host.locator("#toolsButton").click();
  await host.locator("#holofoteMenuItem").click();
  await host.locator("#holofoteToggle").click();
  await host.locator("#drawerClose").click();
  trace("modo holofote verified (3s hold, follows release fade, page stays interactive)");

  // Recording type menu: clicking the record button (while idle) offers "Vídeo" vs "Vídeo em
  // partes (30s)" instead of recording immediately. The parts option is intentionally disabled
  // ("Em breve") — shipping it under any GIF-adjacent framing was judged misleading since it
  // produces WEBM/MP4 segments, not real GIF pixels, so only plain "Vídeo" is clickable for now.
  // Actually invoking getDisplayMedia is not exercised here — it opens a real native OS picker
  // with no Chromium test flag that reliably auto-approves it (unlike camera/mic fake devices),
  // so clicking past this menu would hang or flake the suite. The menu wiring itself (open/close,
  // both options present, parts option disabled) is real coverage; the segmentation/zip-packaging
  // logic was verified separately via a Node harness against the already-proven window.QTS_ZIP writer.
  await host.locator("#recordToggleButton").click();
  await host.locator("#recordTypeMenu:not(.isHidden)").waitFor({ timeout: 2_000 });
  if (!(await host.locator("#recordTypeVideoItem").isVisible())) throw new Error("Record type menu missing the single-video option");
  if (!(await host.locator("#recordTypePartsItem").isVisible())) throw new Error("Record type menu missing the 30s-parts option");
  if (!(await host.locator("#recordTypePartsItem").isDisabled())) throw new Error("30s-parts recording option should stay disabled (Em breve) until it ships");
  await host.locator("#currentUrl").click();
  await host.locator("#recordTypeMenu:not(.isHidden)").waitFor({ state: "hidden", timeout: 2_000 });
  trace("record type menu verified (video option works, 30s-parts is disabled/Em breve, opens/closes correctly)");

  // A tool action must never dismantle the bar.
  await host.locator("#toolsButton").click();
  await host.locator("#jsonStudioMenuItem").click();
  await host.locator("#jsonInput").fill('{"ok":true}');
  await host.locator("#jsonFormat").click();
  await host.locator("#drawerClose").click();

  // Element Capture exports automation-ready locators without field values and neutralizes
  // spreadsheet formulas from site-controlled text before the CSV reaches Excel/Sheets.
  await host.evaluate(() => {
    document.querySelector("#sampleLink").textContent = '=HYPERLINK("https://unsafe.example")';
    document.querySelector("#qaPassword").value = "never-export-this-password";
    const probe = document.createElement("button");
    probe.id = 'qa"name\'mixed';
    probe.textContent = "XPath probe";
    document.querySelector("main").appendChild(probe);
  });
  await host.locator("#toolsButton").click();
  await host.locator("#elementCaptureMenuItem").click();
  await host.getByText(/elemento\(s\) encontrado\(s\)/).waitFor();
  const elementCaptureDownloadPromise = host.waitForEvent("download");
  await host.locator("#elementCaptureExport").click();
  const elementCaptureDownload = await elementCaptureDownloadPromise;
  const elementCaptureCsv = await readFile(await elementCaptureDownload.path(), "utf8");
  if (!elementCaptureCsv.includes("css_selector,xpath") || !elementCaptureCsv.includes("qa\"\"name'mixed") || !elementCaptureCsv.includes("concat(")) throw new Error("Element Capture did not export the expected CSS/XPath locators");
  if (elementCaptureCsv.includes("never-export-this-password")) throw new Error("Element Capture leaked a typed password value");
  if (!elementCaptureCsv.includes("'=HYPERLINK")) throw new Error("Element Capture did not neutralize spreadsheet formula injection");
  await host.locator("#drawerClose").click();
  await host.evaluate(() => document.getElementById('qa"name\'mixed')?.remove());
  trace("element capture verified");
  if (!await toolbar.isVisible()) throw new Error("Toolbar disappeared after using a tool");

  // Responsive View keeps the two differently sized devices centered as one visual group.
  await host.locator("#toolsButton").click();
  await host.locator("#breakpointMenuItem").click();
  await host.locator("#bpStage .qts-bp-frame").nth(1).waitFor();
  const responsiveCentering = await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    const stage = root?.getElementById("bpStage")?.getBoundingClientRect();
    const frames = [...(root?.querySelectorAll("#bpStage .qts-bp-frame") || [])].map((frame) => frame.getBoundingClientRect());
    return {
      stageCenter: stage ? stage.left + stage.width / 2 : 0,
      groupCenter: frames.length ? (Math.min(...frames.map((frame) => frame.left)) + Math.max(...frames.map((frame) => frame.right))) / 2 : 0,
      frameCount: frames.length,
    };
  });
  if (responsiveCentering.frameCount !== 2 || Math.abs(responsiveCentering.stageCenter - responsiveCentering.groupCenter) > 2) throw new Error(`Responsive View is not centered: ${JSON.stringify(responsiveCentering)}`);
  await host.locator("#bpClose").click();

  // Key View renders SVG keycaps for three seconds, keeps opt-in typing only in
  // memory, never captures sensitive fields, and visualizes mouse actions.
  await host.locator("#toolsButton").click();
  await host.locator("#keyViewMenuItem").click();
  if (await host.locator("[data-key-view-position]").count() !== 9) throw new Error("Key View does not expose all nine screen positions");
  await host.locator("#keyViewTyping").check();
  await host.locator("#keyViewTheme").selectOption("light");
  await host.locator("#keyViewKeySize").selectOption("large");
  await host.locator("#keyViewMouseSize").selectOption("small");
  if (await host.locator("#keyViewPreview .qts-keycap").first().evaluate((node) => node.getBoundingClientRect().height) < 65) throw new Error("Key View large-key preview did not resize");
  await host.locator('[data-key-view-position="top-right"]').click();
  await host.locator("#keyViewSave").click();
  await host.getByText("Configurações salvas.").waitFor();
  await host.locator("#keyViewToggle").click();
  await host.locator("#drawerClose").click();
  trace("qa tools verified");
  await host.locator("#macroText").click();
  await host.keyboard.type("asd123!@# ç");
  await host.locator("h1").click();
  await host.keyboard.press("Control+V");
  const keyView = await host.evaluate(() => {
    const overlay = document.querySelector("#qts-key-view-overlay");
    return {
      theme: overlay?.dataset.theme,
      position: overlay?.dataset.position,
      keySize: overlay?.dataset.keySize,
      typing: overlay?.querySelector("[data-key-view-text]")?.textContent,
      keycaps: [...(overlay?.querySelectorAll("[data-key-view-shortcut] .qts-keycap") || [])].map((keycap) => keycap.getAttribute("aria-label")),
      keycapHeight: overlay?.querySelector("[data-key-view-shortcut] .qts-keycap")?.getBoundingClientRect().height || 0,
      svgCount: overlay?.querySelectorAll("[data-key-view-shortcut] svg").length || 0,
    };
  });
  if (keyView.theme !== "light" || keyView.position !== "top-right" || keyView.keySize !== "large" || keyView.keycapHeight < 65 || keyView.typing !== "asd123!@# ç" || keyView.svgCount !== 2 || keyView.keycaps.join("+") !== "Ctrl+V") throw new Error(`Key View keyboard mismatch: ${JSON.stringify(keyView)}`);
  await host.screenshot({ path: resolve(evidencePath, "extension-key-view.png"), fullPage: false });
  const typingBeforePassword = await host.locator("[data-key-view-text]").innerText();
  await host.locator("#qaPassword").click();
  await host.keyboard.type("NeverCapture9!");
  if (await host.locator("[data-key-view-text]").innerText() !== typingBeforePassword) throw new Error("Key View captured a sensitive password field");
  await host.locator("#qaPassword").fill("");
  await host.waitForTimeout(3_100);
  if (!await host.locator("[data-key-view-shortcut]").isHidden()) throw new Error("Key View shortcut did not fade after three seconds");
  await host.locator("main").dispatchEvent("mousedown", { button: 0, clientX: 420, clientY: 320 });
  if (await host.locator("#qts-mouse-view-overlay").getAttribute("data-action") !== "left") throw new Error("Key View did not visualize the left mouse button");
  const mouseSize = await host.locator("#qts-mouse-view-overlay").evaluate((node) => ({ size: node.dataset.mouseSize, width: node.offsetWidth, height: node.offsetHeight }));
  if (mouseSize.size !== "small" || mouseSize.width !== 40 || mouseSize.height !== 52) throw new Error(`Key View mouse size mismatch: ${JSON.stringify(mouseSize)}`);
  await host.locator("main").dispatchEvent("mouseup", { button: 0, clientX: 420, clientY: 320 });
  await host.locator("main").dispatchEvent("mousedown", { button: 2, clientX: 430, clientY: 330 });
  if (await host.locator("#qts-mouse-view-overlay").getAttribute("data-action") !== "right") throw new Error("Key View did not visualize the right mouse button");
  await host.locator("main").dispatchEvent("wheel", { deltaY: 120, clientX: 440, clientY: 340 });
  if (await host.locator("#qts-mouse-view-overlay").getAttribute("data-action") !== "scroll-down") throw new Error("Key View did not visualize scroll direction");
  await host.locator("[data-key-view-clear]").click();
  if (await host.locator("#qts-key-view-overlay").count()) throw new Error("Key View typing was not cleared on demand");
  await host.locator("#toolsButton").click();
  await host.locator("#keyViewMenuItem").click();
  await host.locator("#keyViewToggle").click();
  await host.locator("#drawerClose").click();
  await host.locator("h1").press("Control+C");
  if (await host.locator("#qts-key-view-overlay").count()) throw new Error("Key View kept listening after being disabled");

  // Character Counter measures Unicode code points with and without whitespace.
  await host.locator("#toolsButton").click();
  await host.locator("#characterCounterMenuItem").click();
  await host.locator("#characterCounterInput").fill("QA test!\nOK");
  const counterText = await host.locator("#characterMetrics").innerText();
  for (const expected of ["11\nCom espaços", "9\nSem espaços", "3\nPalavras", "2\nLinhas"]) if (!counterText.includes(expected)) throw new Error(`Character Counter mismatch: ${counterText}`);
  await host.locator("#drawerClose").click();

  // Faker Fill populates visible form fields locally and always protects passwords.
  await host.locator("#toolsButton").click();
  await host.locator("#fakerFillMenuItem").click();
  await host.locator("#fakerRun").click();
  const fakerResult = await host.evaluate(() => ({ name: document.querySelector("#qaName").value, email: document.querySelector("#qaEmail").value, password: document.querySelector("#qaPassword").value }));
  if (!fakerResult.name || !fakerResult.email.endsWith("@example.com") || fakerResult.password) throw new Error(`Faker Fill security mismatch: ${JSON.stringify(fakerResult)}`);
  await host.locator("#drawerClose").click();

  // Input Lab inspects constraints, tests six data classes and restores the original value.
  await host.locator("#qaName").fill("Original");
  await host.locator("#toolsButton").click();
  await host.locator("#inputLabMenuItem").click();
  await host.locator("#inputSelect").click();
  await host.locator("#qaName").click();
  await host.locator("#inputRun").click();
  await host.locator("#inputResults tbody tr").nth(5).waitFor();
  if (await host.locator("#inputResults tbody tr").count() !== 6 || await host.locator("#qaName").inputValue() !== "Original") throw new Error("Input Lab did not complete or restore the input");
  await host.locator("#drawerClose").click();

  // Multiclick uses the visual selector and respects the requested count.
  await host.locator("#toolsButton").click();
  await host.locator("#multiClickMenuItem").click();
  await host.locator("#multiSelect").click();
  await host.locator("#multiTarget").click();
  await host.locator("#multiCount").fill("4");
  await host.locator("#multiInterval").fill("0");
  await host.locator("#multiRun").click();
  await host.getByText("4 cliques concluídos.").waitFor();
  if (await host.locator("#multiTarget").getAttribute("data-clicks") !== "4") throw new Error("Multiclick executed an incorrect count");
  await host.locator("#drawerClose").click();

  // Macro recording captures normal interactions but ignores password content.
  await host.locator("#toolsButton").click();
  await host.locator("#macroStudioMenuItem").click();
  await host.locator("#startMacroRecording").click();
  await host.locator("#macroTarget").click();
  await host.locator("#macroText").fill("texto gravado");
  await host.locator("#macroText").press("Tab");
  await host.locator("#qaPassword").fill("segredo-da-gravacao");
  await host.locator("#qaPassword").press("Tab");
  await host.locator("#macroRecDoneButton").click();
  await host.locator("#macroSave").click();
  await host.locator("#macroList .qts-card").first().waitFor();
  await host.locator('#macroList .qts-card').first().locator('[data-macro-action="pin"]').click();
  await host.locator("#macroList .qts-card").first().waitFor();
  const pinnedMacroCount = await host.locator("#pinnedMacrosMenu [data-pinned-macro]").count();
  if (pinnedMacroCount !== 1) throw new Error("Pinned macro was not added to the tools menu");
  await host.locator('#macroList .qts-card').first().locator('[data-macro-action="edit"]').click();
  await host.locator('[data-macro-mode="coder"]').click();
  const generatedCode = await host.locator("#macroCode").innerText();
  if (!generatedCode.includes("page.locator") || generatedCode.includes("segredo-da-gravacao") || /\beval\s*\(/.test(generatedCode)) throw new Error(`Unsafe or incomplete generated macro code: ${generatedCode}`);
  await host.locator("#macroBack").click();
  const macroDownloadPromise = host.waitForEvent("download");
  await host.locator("#exportAllMacros").click();
  const macroDownload = await macroDownloadPromise;
  const macroExport = await readFile(await macroDownload.path(), "utf8");
  const macroPayload = JSON.parse(macroExport);
  if (macroPayload.format !== "qts-macros" || macroPayload.version !== 1 || macroPayload.macros.length !== 1 || macroExport.includes("segredo-da-gravacao")) throw new Error("Macro export format/security mismatch");
  await host.locator("#macroFile").setInputFiles({ name: "imported-macro.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "qts-macros", version: 1, macros: [{ id: "imported", name: "Importada QA", steps: [{ action: "click", selector: "#navMacro" }, { action: "javascript", value: "alert(1)" }, { action: "fill", selector: "#macroText", value: "após navegação" }] }] })) });
  await host.getByText("Importada QA").waitFor();
  if (await host.locator("#macroList .qts-card").count() !== 2) throw new Error("Macro import did not merge the validated macro");
  await host.locator("#drawerClose").click();

  // Replaying the recorded macro performs the captured click and fill.
  await host.evaluate(() => { document.querySelector("#macroTarget").dataset.clicks = "0"; document.querySelector("#macroText").value = ""; });
  await host.locator("#toolsButton").click();
  await host.locator("#pinnedMacrosMenu [data-pinned-macro]").click();
  await host.waitForFunction(() => document.querySelector("#macroTarget")?.dataset.clicks === "1" && document.querySelector("#macroText")?.value === "texto gravado", null, { timeout: 15_000 });
  const replay = await host.evaluate(() => ({ clicks: document.querySelector("#macroTarget").dataset.clicks, value: document.querySelector("#macroText").value }));
  if (replay.clicks !== "1" || replay.value !== "texto gravado") throw new Error(`Macro replay mismatch: ${JSON.stringify(replay)}`);
  trace("macro replay verified");

  // A pending run is scoped to the current tab and resumes after full document navigation.
  await host.locator("#toolsButton").click();
  await host.locator("#macroStudioMenuItem").click();
  await host.locator('#macroList .qts-card').filter({ hasText: "Importada QA" }).locator('[data-macro-action="play"]').click();
  await host.waitForURL("**/app/next");
  await host.locator("#qts-toolbar-host").waitFor({ state: "attached" });
  await host.waitForFunction(() => document.querySelector("#macroText")?.value === "após navegação");
  await host.goto("http://127.0.0.1:43117/");
  await toolbar.waitFor({ timeout: 10_000 });

  // Compact mode hides project/product names, preserving their image/initial badges and environment.
  await options.getByRole("button", { name: "Barra e aparência" }).click();
  await options.waitForFunction(() => document.querySelector("#keyViewTheme")?.value === "light" && document.querySelector("#keyViewPosition")?.value === "top-right" && document.querySelector("#keyViewKeySize")?.value === "large" && document.querySelector("#keyViewMouseSize")?.value === "small" && !document.querySelector("#keyViewEnabled")?.checked);
  if (await options.locator('[data-tool="keyView"]').count() !== 1 || await options.locator('[data-tool="keyView"]').isChecked() !== true) throw new Error("Key View menu preference did not persist in options");
  await options.locator('[data-compact-entity="project"]').check();
  await options.locator("#saveGeneralSettings").click();
  await host.waitForTimeout(500);
  const compact = await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    return { client: root?.getElementById("clientLabel")?.textContent || "", text: root?.getElementById("breadcrumb")?.textContent || "", badges: root?.getElementById("breadcrumb")?.querySelectorAll(".qts-badge-avatar").length || 0 };
  });
  if (compact.text.includes("Webapp Demo") || !compact.text.includes("Checkout") || !compact.text.includes("QA") || !compact.client.includes("Cliente Demo") || compact.badges !== 2) throw new Error(`Per-entity compact mode mismatch: ${JSON.stringify(compact)}`);

  // Editing a URL binding's pattern uses the same canonical workspace and immediately changes registration.
  await options.getByRole("button", { name: "Workspace" }).click();
  await options.locator('[data-workspace-tab="urls"]').click();
  await options.locator("#urlRelationList .listRow", { hasText: "http://127.0.0.1:43117/*" }).locator('[data-action="edit"]').click();
  // Editing now prefills every existing pattern as a removable pill (not just one) — remove the
  // old one before adding the new one, to actually replace it rather than adding a second pattern.
  await options.locator(".patternPill", { hasText: "http://127.0.0.1:43117/*" }).locator("[data-remove-pattern]").click();
  await options.locator("#urlPatternInput").fill("http://127.0.0.1:43117/app*");
  await options.locator("#urlRelationForm button[type=submit]").click();
  await host.waitForTimeout(700);
  if (await host.locator("#qts-toolbar-host").count()) throw new Error("Toolbar remained on a URL removed from the environment");

  await host.goto("http://127.0.0.1:43117/app?token=segredo-nao-pode-aparecer");
  await toolbar.waitFor({ timeout: 10_000 });
  const safeUrl = await host.evaluate(() => document.querySelector("#qts-toolbar-host")?.shadowRoot?.getElementById("currentUrl")?.textContent || "");
  if (!safeUrl.includes("%5Boculto%5D") || safeUrl.includes("segredo-nao-pode-aparecer")) throw new Error(`Sensitive URL parameter was not redacted: ${safeUrl}`);
  await host.locator("#spaOutside").click();
  await host.waitForTimeout(500);
  if (await host.locator("#qts-toolbar-host").count()) {
    const toolbarUrl = await host.evaluate(() => document.querySelector("#qts-toolbar-host")?.shadowRoot?.getElementById("currentUrl")?.textContent || "");
    throw new Error(`SPA navigation outside the environment kept the toolbar mounted: page=${host.url()} toolbar=${toolbarUrl}`);
  }
  await host.locator("#spaApp").click();
  await toolbar.waitFor({ timeout: 3_000 });
  trace("environment and SPA reactivity verified");

  // Extra settings categories persist and secure export strips local secrets.
  await options.getByRole("button", { name: "Dados de teste" }).click();
  await options.locator('[data-open-composer="testAccountComposer"]').click();
  // Environment/product are now a floating multi-select combobox (four independent facets,
  // see options.js's renderScopePicker) instead of a plain <select> — open the Ambientes facet,
  // tick "QA", close it back.
  await options.locator('#testAccountScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator('#testAccountScopePicker [data-facet-panel="environmentIds"] label', { hasText: "QA" }).locator("input").check();
  await options.locator('#testAccountScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator("#testAccountLabel").fill("Conta sandbox");
  await options.locator("#testAccountUsername").fill("sandbox@example.com");
  await options.locator("#testAccountPassword").fill("local-password-value");
  await options.locator("#testAccountForm button[type=submit]").click();
  await options.locator('[data-workspace-tab="payments"]').click();
  await options.locator('[data-open-composer="paymentMethodComposer"]').click();
  await options.locator('#paymentMethodScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator('#paymentMethodScopePicker [data-facet-panel="environmentIds"] label', { hasText: "QA" }).locator("input").check();
  await options.locator('#paymentMethodScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator("#paymentMethodLabel").fill("Visa sandbox");
  await options.locator("#paymentMethodValue").fill("4242424242424242");
  await options.locator("#paymentMethodForm button[type=submit]").click();
  await options.getByRole("button", { name: "Inspectors e recursos" }).click();
  await options.locator('[data-open-composer="apiComposer"]').click();
  await options.locator("#apiLabel").fill("API Demo");
  await options.locator("#apiBaseUrl").fill("https://api.example.com");
  await options.locator("#apiToken").fill("local-api-token-value");
  await options.locator("#apiForm button[type=submit]").click();
  await options.locator('[data-open-composer="resourceComposer"]').click();
  await options.locator("#resourceLabel").fill("Runbook QA");
  await options.locator("#resourceUrl").fill("https://example.com/runbook");
  await options.locator("#resourceForm button[type=submit]").click();

  const paymentDrawer = await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    root?.getElementById("toolsButton")?.click();
    root?.getElementById("paymentMethodsMenuItem")?.click();
    return root?.getElementById("drawerBody")?.textContent || "";
  });
  if (!paymentDrawer.includes("Visa sandbox") || !paymentDrawer.includes("4242") || paymentDrawer.includes("4242424242424242")) throw new Error(`Payment method drawer did not stay masked: ${paymentDrawer}`);
  const resourcesDrawer = await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    root?.getElementById("drawerClose")?.click();
    root?.getElementById("toolsButton")?.click();
    root?.getElementById("resourcesMenuItem")?.click();
    return { text: root?.getElementById("drawerBody")?.textContent || "", href: root?.getElementById("drawerBody")?.querySelector("a")?.href || "" };
  });
  const resourceUrl = new URL(resourcesDrawer.href);
  if (!resourcesDrawer.text.includes("Runbook QA") || resourceUrl.protocol !== "https:" || resourceUrl.hostname !== "example.com" || resourceUrl.pathname !== "/runbook") throw new Error(`Resources drawer mismatch: ${JSON.stringify(resourcesDrawer)}`);
  await options.getByRole("button", { name: "Importar / Exportar" }).click();
  const downloadPromise = options.waitForEvent("download");
  await options.locator("#exportButton").click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), "utf8");
  for (const secret of ["local-password-value", "4242424242424242", "local-api-token-value"]) if (exported.includes(secret)) throw new Error("Secure export leaked a local secret");
  const exportedPayload = JSON.parse(exported);
  if (!/^sha256:[a-f0-9]{64}$/i.test(exportedPayload.checksum || "")) throw new Error("Secure export did not include an integrity checksum");
  trace("settings and secure export verified");

  // Tutorial (Part B + live-tour revision): banner stays visible until dismissed (its "Fazer o
  // tour" action is exercised via the live-tour and start-button checks further below, both of
  // which route through the same qts:start-tutorial-tour message this banner now sends instead of
  // just switching tabs). This block covers the video-library panel: every card exposes a playable
  // video thumbnail, marking a step done plays the achievement sound and opens the completion
  // modal (Repetir/Próximo/Fechar, not the old toast), progress persists across reload, no tool
  // shows a lock badge, and the FAQ's expand/collapse-all touches every accordion (now illustrated
  // with the same screenshots).
  await options.getByRole("button", { name: "Minha conta" }).click();
  if (await options.locator("#tutorialBanner").isHidden()) throw new Error("Tutorial banner should be visible before it's dismissed");
  await options.getByRole("button", { name: "Tutorial" }).click();
  const tutorialModuleCount = await options.locator("[data-tutorial-module]").count();
  if (tutorialModuleCount < 20) throw new Error(`Tutorial panel rendered too few modules: ${tutorialModuleCount}`);
  if (await options.locator(".tutorialLockBadge").count() !== 0) throw new Error("A tool showed a plan lock badge despite every plan feature being enabled in this mock");
  if (await options.locator("[data-tutorial-play]:not([disabled])").count() < 20) throw new Error("Tutorial cards did not expose a playable video thumbnail");
  const tutorialGroupCount = await options.locator(".tutorialGroupAccordion").count();
  if (tutorialGroupCount < 3) throw new Error(`Tutorial panel did not group modules into accordion sections: ${tutorialGroupCount}`);
  if (await options.locator('[data-tutorial-try="testStatus"]').count() !== 1) throw new Error('Tutorial card is missing the "Tentar" button');
  const [tryTourTab] = await Promise.all([
    context.waitForEvent("page"),
    options.locator('[data-tutorial-try="testStatus"]').click(),
  ]);
  if (!tryTourTab.url().includes("qtsTutorialStep=testStatus")) throw new Error(`"Tentar" did not target the requested step: ${tryTourTab.url()}`);
  await tryTourTab.close();
  trace('tutorial "Tentar" button verified (jumps the live tour straight to the requested step)');

  // Video dialog: opens with a real source, "Marcar como concluído" closes it and chains straight
  // into the completion modal, whose "Próximo" opens the following module's video.
  await options.locator('[data-tutorial-play="testStatus"]').click();
  await options.locator("#tutorialVideoDialog[open]").waitFor();
  if (!(await options.locator("#tutorialVideoPlayer").getAttribute("src"))?.includes("testStatus.webm")) throw new Error("Video dialog did not load the expected clip");
  await options.locator("#tutorialVideoComplete").click();
  await options.locator("#tutorialStepDoneDialog[open]").waitFor();
  if ((await options.locator("#tutorialStepDoneTitle").innerText()) !== "Test Status concluído!") throw new Error("Completion modal did not show the right step title after finishing from the video dialog");
  await options.locator("#tutorialStepNext").click();
  await options.locator("#tutorialVideoDialog[open]").waitFor();
  if (!(await options.locator("#tutorialVideoPlayer").getAttribute("src"))?.includes("passFail.webm")) throw new Error("Completion modal's Próximo did not open the next module's video");
  await options.locator("#tutorialVideoClose").click();
  trace("tutorial video dialog + completion modal chaining verified");

  const achievementSoundPromise = options.waitForRequest((request) => request.url().endsWith("/src/assets/sounds/test-pass.mp3"));
  await options.locator('[data-tutorial-complete="workspace"]').click();
  await achievementSoundPromise;
  await options.locator("#tutorialStepDoneDialog[open]").waitFor();
  if ((await options.locator("#tutorialStepDoneTitle").innerText()) !== "Prepare seu workspace concluído!") throw new Error("Completion modal did not show the right step title");
  if (!(await options.locator("#tutorialStepDoneBody").innerText()).includes("Dica:")) throw new Error("Completion modal did not show the practical tip");
  await options.locator("#tutorialStepClose").click();
  await options.locator('[data-tutorial-module="workspace"].isDone').waitFor();
  if ((await options.locator("#tutorialProgressLabel").textContent()) !== `2 de ${tutorialModuleCount} concluídos`) throw new Error("Tutorial progress label did not update after completing a step");
  trace("tutorial step completion verified");

  await options.reload();
  await options.locator('.protectedNav[data-tab="tutorial"]:not(:disabled)').waitFor({ timeout: 10_000 });
  await options.getByRole("button", { name: "Tutorial" }).click();
  await options.locator('[data-tutorial-module="workspace"].isDone').waitFor();
  trace("tutorial progress persisted across reload");

  await options.getByRole("button", { name: "FAQ" }).click();
  const faqCount = await options.locator(".faqAccordion").count();
  if (faqCount < 20) throw new Error(`FAQ panel rendered too few entries: ${faqCount}`);
  await options.locator("#faqExpandAll").click();
  if (await options.locator(".faqAccordion:not([open])").count() !== 0) throw new Error("Expandir tudo did not open every FAQ entry");
  if (await options.locator(".faqAnswer img").count() < 20) throw new Error("FAQ entries did not render illustrative screenshots");
  if (await options.locator(".faqGroupAccordion").count() < 4) throw new Error("FAQ panel did not group entries into accordion sections");
  await options.locator(".faqAnswer img").first().click();
  await options.locator("#imageLightbox:not([hidden])").waitFor();
  if (!(await options.locator("#imageLightboxImg").getAttribute("src"))) throw new Error("Image lightbox did not load the clicked screenshot");
  await options.locator("#imageLightboxClose").click();
  if (!(await options.locator("#imageLightbox").isHidden())) throw new Error("Image lightbox did not close");
  await options.locator("#faqCollapseAll").click();
  if (await options.locator(".faqAccordion[open]").count() !== 0) throw new Error("Recolher tudo did not close every FAQ entry");
  trace("FAQ accordions + image lightbox verified");

  // Live tutorial tour: same overlay code path as the real demoqa.com launch (background.js only
  // hardcodes that URL for the actual seed-and-open flow, tested separately below) -- toolbar.js
  // reacts to the exact same ?qtsTutorial=1 query param regardless of host, so pointing it at the
  // local fixture page keeps this a zero-external-network check while exercising the real code.
  // The URL binding pattern was narrowed to /app* earlier ("environment and SPA reactivity
  // verified"), so this has to match that, not the original root pattern.
  await host.goto("http://127.0.0.1:43117/app?qtsTutorial=1");
  await toolbar.waitFor({ timeout: 10_000 });
  await host.locator(".qts-tour-spotlight").waitFor({ timeout: 5_000 });
  const firstTourStepTitle = await host.locator(".qts-tour-balloon b").innerText();
  const tourSoundPromise = host.waitForRequest((request) => request.url().endsWith("/src/assets/sounds/test-pass.mp3"));
  await host.locator("[data-tour-done]").click();
  await tourSoundPromise;
  await host.locator(".qts-tour-card").waitFor();
  if (!(await host.locator(".qts-tour-card-tip").innerText()).includes("Dica:")) throw new Error("Live tour completion card did not show the practical tip");
  await host.locator("[data-tour-next-card]").click();
  await host.locator(".qts-tour-balloon").waitFor();
  const secondTourStepTitle = await host.locator(".qts-tour-balloon b").innerText();
  if (secondTourStepTitle === firstTourStepTitle) throw new Error("Live tour did not advance to the next step after Próximo");
  const [workspaceTabAfterSkip] = await Promise.all([
    context.waitForEvent("page"),
    host.locator("[data-tour-skip]").click(),
  ]);
  await workspaceTabAfterSkip.locator('[data-panel="workspace"].isActive').waitFor({ timeout: 10_000 });
  await workspaceTabAfterSkip.close();
  if (await host.locator(".qts-tour-balloon").count()) throw new Error("Pular tutorial did not close the live tour overlay");
  trace("live tutorial tour verified (spotlight, step advance, achievement sound, skip-to-workspace)");

  // "Iniciar tutorial" in the Settings Tutorial panel must never clobber a workspace that already
  // has real data (this run already built one earlier) -- it should just open the demo tab.
  await options.getByRole("button", { name: "Tutorial" }).click();
  const clientCountBeforeTourButton = await options.evaluate(async () => (await chrome.storage.local.get("qtsWorkspaceV1")).qtsWorkspaceV1?.clients?.length || 0);
  const [demoTab] = await Promise.all([
    context.waitForEvent("page"),
    options.locator("#tutorialStartTour").click(),
  ]);
  const demoTabUrl = demoTab.url();
  let demoTabHost;
  try {
    demoTabHost = new URL(demoTabUrl).hostname;
  } catch {
    throw new Error(`"Iniciar tutorial" opened an unexpected URL: ${demoTabUrl}`);
  }
  const allowedDemoHosts = new Set(["demoqa.com", "www.demoqa.com"]);
  if (!allowedDemoHosts.has(demoTabHost)) throw new Error(`"Iniciar tutorial" opened an unexpected URL: ${demoTabUrl}`);
  await demoTab.close();
  const clientCountAfterTourButton = await options.evaluate(async () => (await chrome.storage.local.get("qtsWorkspaceV1")).qtsWorkspaceV1?.clients?.length || 0);
  if (clientCountAfterTourButton !== clientCountBeforeTourButton) throw new Error(`"Iniciar tutorial" modified the existing workspace: ${clientCountBeforeTourButton} -> ${clientCountAfterTourButton}`);
  trace("tutorial start button verified (opens demo tab, never overwrites an existing workspace)");

  // Settings-screen tour: spotlight + balloon walking through the 8 nav sections, right here on
  // options.html (separate engine from the toolbar's live tour -- no shadow DOM involved).
  await options.getByRole("button", { name: "Minha conta" }).click();
  await options.locator("#settingsTourStart").click();
  await options.locator(".settingsTourBalloon").waitFor();
  const settingsTourFirstTitle = await options.locator(".settingsTourBalloon b").innerText();
  await options.locator("#settingsTourNext").click();
  const settingsTourSecondTitle = await options.locator(".settingsTourBalloon b").innerText();
  if (settingsTourSecondTitle === settingsTourFirstTitle) throw new Error("Settings tour did not advance to the next section");
  if (await options.locator('[data-panel="general"].isActive').count() !== 1) throw new Error("Settings tour did not switch to the section it's pointing at");
  await options.locator("#settingsTourSkip").click();
  if (await options.locator(".settingsTourBalloon").count()) throw new Error("Settings tour overlay did not close");
  trace("settings-screen tour verified");

  await options.getByRole("button", { name: "Minha conta" }).click();
  await options.locator("#signOutButton").click();
  await host.waitForTimeout(500);
  if (await host.locator("#qts-toolbar-host").count()) throw new Error("Toolbar remained after logout");
  if (!await options.locator('.protectedNav[data-tab="workspace"]').isDisabled()) throw new Error("Protected settings remained enabled after logout");

  if (hostErrors.length || optionsErrors.length || workerErrors.length) throw new Error(`Console errors:\n${[...hostErrors, ...optionsErrors, ...workerErrors].join("\n")}`);
  console.log(JSON.stringify({ extensionId, unauthenticatedBlocked: true, authenticatedWorkspace: true, optionsI18nPtEsEn: true, workspaceStudioTabs: true, relationalUrls: true, searchableEnvironmentMultiselect: true, imageEditor: true, hierarchyAndUrl: true, soundEffectsRequested: true, responsiveViewCentered: true, keyViewSvgShortcuts: true, keyViewSizes: true, keyViewTypingProtected: true, keyViewMouseEffects: true, characterCounter: true, elementCaptureCsvSafe: true, fakerFillProtected: true, inputLab: true, multiClick: true, macroRecordReplay: true, macroVibeCoder: true, macroImportExportPin: true, macroNavigationResume: true, compactModePerEntity: true, environmentEditReactive: true, spaReactive: true, paymentMethodsMasked: true, resourcesVisible: true, secureExport: true, tutorialGamification: true, tutorialProgressPersisted: true, faqAccordions: true, liveTutorialTour: true, tutorialStartButton: true, logoutRemovesToolbar: true, consoleErrors: 0, workerErrors: 0 }));
} finally {
  await context.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
