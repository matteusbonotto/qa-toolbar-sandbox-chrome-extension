import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
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
  response.end(`<!doctype html><html><head><title>QA Smoke Host</title></head><body style="margin:0;font:16px sans-serif"><main style="padding:90px 30px"><h1>Ambiente de teste</h1><button id="spaApp">Ir para /app</button><button id="spaOutside">Ir para /outside</button><button id="navMacro">Navegar na macro</button><a id="sampleLink" href="https://example.com/destino">Link de exemplo</a><hr><button id="multiTarget" type="button">Alvo</button><button id="macroTarget" type="button">Ação da macro</button><form id="qaForm"><label>Nome <input id="qaName" name="name" maxlength="12" required></label><label>E-mail <input id="qaEmail" name="email" type="email"></label><label>Observação <textarea id="macroText" name="notes"></textarea></label><label>Senha <input id="qaPassword" name="password" type="password"></label><label>Perfil <select id="qaProfile" name="profile"><option value="">Selecione</option><option value="qa">QA</option></select></label></form></main><script>spaApp.onclick=()=>history.pushState({},'', '/app?token=segredo-nao-pode-aparecer');spaOutside.onclick=()=>history.pushState({},'', '/outside');navMacro.onclick=()=>location.href='/app/next';multiTarget.onclick=()=>multiTarget.dataset.clicks=String(Number(multiTarget.dataset.clicks||0)+1);macroTarget.onclick=()=>macroTarget.dataset.clicks=String(Number(macroTarget.dataset.clicks||0)+1);</script></body></html>`);
});
await new Promise((resolveReady) => server.listen(43117, "127.0.0.1", resolveReady));

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--window-position=20,20", "--window-size=1400,900", "--no-first-run"],
  viewport: { width: 1400, height: 900 },
});

const fakeSession = {
  accessToken: "test-access-token-with-more-than-twenty-characters",
  refreshToken: "test-refresh-token",
  expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
  user: { id: "00000000-0000-4000-8000-000000000001", email: "tester@example.com" },
};

await context.route("https://xhusvkylbouwtpcevgri.supabase.co/functions/v1/**", async (route) => {
  const name = new URL(route.request().url()).pathname.split("/").pop();
  if (name === "auth-sign-in" || name === "auth-refresh") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeSession) });
  if (name === "access-status") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ active: true, plan: { key: "release-manager", name: "Release Manager" }, source: "manual", expiresAt: null, checkedAt: new Date().toISOString() }) });
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
  await options.locator('#langSwitch [data-locale="en"]').click();
  await options.getByRole("button", { name: "My account" }).waitFor();
  if (await options.locator("html").getAttribute("lang") !== "en") throw new Error("Options locale did not switch to English");
  if (await options.locator("#clientName").getAttribute("placeholder") !== "Client name") throw new Error("Options placeholders were not translated to English");
  await options.locator('#langSwitch [data-locale="es"]').click();
  await options.getByRole("button", { name: "Mi cuenta" }).waitFor();
  if (await options.locator("#environmentName").getAttribute("placeholder") !== "Nombre del entorno (ej.: QA, Staging)") throw new Error("Options placeholders were not translated to Spanish");
  await options.locator('#langSwitch [data-locale="pt-BR"]').click();
  await options.getByRole("button", { name: "Minha conta" }).click();
  await options.locator("#signedInState").waitFor({ state: "visible" });
  await options.screenshot({ path: resolve(evidencePath, "extension-authenticated-account.png"), fullPage: true });

  await options.getByRole("button", { name: "Workspace" }).click();
  await options.locator("#clientName").fill("Cliente Demo");
  await options.locator("#clientAbbreviation").fill("CD");
  await options.locator("#clientForm button[type=submit]").click();
  await options.locator("#projectClient").selectOption({ label: "Cliente Demo" });
  await options.locator("#projectName").fill("Webapp Demo");
  await options.locator("#projectAbbreviation").fill("WEB");
  await options.locator("#projectForm button[type=submit]").click();
  await options.locator("#productProject").selectOption({ label: "Webapp Demo" });
  await options.locator("#productName").fill("Checkout");
  await options.locator("#productAbbreviation").fill("CHK");
  await options.locator("#productForm button[type=submit]").click();
  await options.locator("#environmentProduct").selectOption({ label: "Checkout" });
  await options.locator("#environmentName").fill("QA");
  await options.locator("#environmentColor").fill("#5b21b6");
  await options.locator("#environmentPatterns").fill("http://127.0.0.1:43117/*");
  await options.locator("#environmentForm button[type=submit]").click();
  await options.waitForTimeout(600);

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
  if (hierarchy.height !== 48 || hierarchy.background !== "rgb(91, 33, 182)") throw new Error(`Toolbar layout/color mismatch: ${JSON.stringify(hierarchy)}`);
  await host.screenshot({ path: resolve(evidencePath, "extension-toolbar-hierarchy-url.png"), fullPage: false });

  // A tool action must never dismantle the bar.
  await host.locator("#toolsButton").click();
  await host.locator("#jsonStudioMenuItem").click();
  await host.locator("#jsonInput").fill('{"ok":true}');
  await host.locator("#jsonFormat").click();
  await host.locator("#drawerClose").click();
  if (!await toolbar.isVisible()) throw new Error("Toolbar disappeared after using a tool");

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
  await host.locator("#macroRecordingChip").click();
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
  await options.locator("#compactMode").check();
  await options.locator("#savePreferences").click();
  await host.waitForTimeout(500);
  const compact = await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    return { text: root?.getElementById("breadcrumb")?.textContent || "", badges: root?.getElementById("breadcrumb")?.querySelectorAll(".qts-badge-avatar").length || 0 };
  });
  if (compact.text.includes("Webapp Demo") || compact.text.includes("Checkout") || !compact.text.includes("QA") || compact.badges !== 2) throw new Error(`Compact mode mismatch: ${JSON.stringify(compact)}`);

  // Editing the environment uses the same canonical workspace and immediately changes registration.
  await options.getByRole("button", { name: "Workspace" }).click();
  await options.locator("#environmentList [data-action=edit]").click();
  await options.locator("#environmentPatterns").fill("http://127.0.0.1:43117/app*");
  await options.locator("#environmentForm button[type=submit]").click();
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

  // Extra settings categories persist and secure export strips local secrets.
  await options.getByRole("button", { name: "Dados de teste" }).click();
  await options.locator("#testAccountEnvironment").selectOption({ label: "Checkout · QA" });
  await options.locator("#testAccountLabel").fill("Conta sandbox");
  await options.locator("#testAccountUsername").fill("sandbox@example.com");
  await options.locator("#testAccountPassword").fill("local-password-value");
  await options.locator("#testAccountForm button[type=submit]").click();
  await options.locator("#paymentMethodEnvironment").selectOption({ label: "Checkout · QA" });
  await options.locator("#paymentMethodLabel").fill("Visa sandbox");
  await options.locator("#paymentMethodValue").fill("4242424242424242");
  await options.locator("#paymentMethodForm button[type=submit]").click();
  await options.getByRole("button", { name: "Inspectors e recursos" }).click();
  await options.locator("#apiLabel").fill("API Demo");
  await options.locator("#apiBaseUrl").fill("https://api.example.com");
  await options.locator("#apiToken").fill("local-api-token-value");
  await options.locator("#apiForm button[type=submit]").click();
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

  await options.getByRole("button", { name: "Minha conta" }).click();
  await options.locator("#signOutButton").click();
  await host.waitForTimeout(500);
  if (await host.locator("#qts-toolbar-host").count()) throw new Error("Toolbar remained after logout");
  if (!await options.locator('.protectedNav[data-tab="workspace"]').isDisabled()) throw new Error("Protected settings remained enabled after logout");

  if (hostErrors.length || optionsErrors.length || workerErrors.length) throw new Error(`Console errors:\n${[...hostErrors, ...optionsErrors, ...workerErrors].join("\n")}`);
  console.log(JSON.stringify({ extensionId, unauthenticatedBlocked: true, authenticatedWorkspace: true, optionsI18nPtEsEn: true, hierarchyAndUrl: true, characterCounter: true, fakerFillProtected: true, inputLab: true, multiClick: true, macroRecordReplay: true, macroVibeCoder: true, macroImportExportPin: true, macroNavigationResume: true, compactMode: true, environmentEditReactive: true, spaReactive: true, paymentMethodsMasked: true, resourcesVisible: true, secureExport: true, logoutRemovesToolbar: true, consoleErrors: 0, workerErrors: 0 }));
} finally {
  await context.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
