import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "apps/extension/.output/chrome-mv3");
const profilePath = resolve(root, "artifacts/chrome-smoke-profile");
const evidencePath = resolve(root, "artifacts/runtime-evidence");
await rm(profilePath, { recursive: true, force: true });
await mkdir(evidencePath, { recursive: true });

const server = createServer((_request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end("<!doctype html><html><head><title>QA Smoke Host</title></head><body style='margin:0;font:16px sans-serif'><main style='padding:80px 30px'><h1>Aplicação hospedeira</h1><button id='checkout'>Finalizar compra</button></main></body></html>");
});
await new Promise((resolveReady) => server.listen(43117, "127.0.0.1", resolveReady));

const context = await chromium.launchPersistentContext(profilePath, {
  // Chrome suppresses unpacked MV3 extensions in Playwright's headless launch.
  // Run the real browser in a normal window so Chromium paints extension UI reliably.
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--window-position=20,20",
    "--window-size=1600,1000",
    "--no-first-run",
    "--disable-component-update",
  ],
  viewport: { width: 1600, height: 1000 },
});

try {
  await context.route("https://example.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><title>Preview seguro</title><main><h1>Aplicação de demonstração</h1><p>Conteúdo para validação responsiva.</p></main>",
  }));
  await context.route("**/functions/v1/register-installation", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ registered: true }),
  }));
  await context.route("**/functions/v1/billing-status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      plan: { key: "scale", name: "Scale" },
      subscription: null,
      overrides: [],
      features: { "domains.maximum": 9999, "networkHistory.maximum": 100000, "recording.enabled": true, "annotations.enabled": true, "inspectors.enabled": true, "httpControls.enabled": true },
      trial: { active: false, endsAt: null, daysRemaining: 0 },
      access: { active: true, source: "manual", expiresAt: null, daysRemaining: null, expiryWarning: false, installUrl: "https://chromewebstore.google.com/" },
      featureFlags: {},
      referral: { code: null, qualified: 0 },
      checkedAt: new Date().toISOString(),
    }),
  }));
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 30_000 });
  const extensionId = new URL(worker.url()).host;
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const errors = [];
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(optionsUrl);
  await page.screenshot({ path: resolve(evidencePath, "options-initial.png"), fullPage: true });
  await page.getByRole("button", { name: /Minha conta|My account|Mi cuenta/i }).waitFor();
  await page.screenshot({ path: resolve(evidencePath, "options-logged-out.png"), fullPage: true });
  await page.getByRole("button", { name: /Configura|Settings/i }).click();
  await page.getByText(/Entre na sua conta para acessar as configurações/i).waitFor();

  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      qtsAuthSession: { accessToken: "a".repeat(64), refreshToken: "safe-test-refresh-token", expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "d5c9b84c-0564-4fc8-87ad-12409180403b", email: "runtime@example.test" } },
      qtsOnboardingV2Complete: true,
    });
  });
  await page.reload();
  await page.getByRole("button", { name: /Configura|Settings/i }).click();
  await page.getByText(/Configuração guiada/i).waitFor();
  await page.screenshot({ path: resolve(evidencePath, "options-logged-in.png"), fullPage: true });
  await page.locator(".qtsWizardSteps button").nth(1).click();
  await page.getByText(/Ambientes e identidade visual/i).waitFor();
  await page.screenshot({ path: resolve(evidencePath, "configuration-environments.png"), fullPage: true });
  await page.getByRole("button", { name: /Workspace/i }).click();
  await page.getByText("Central de dados de QA", { exact: false }).waitFor();
  await page.screenshot({ path: resolve(evidencePath, "workspace-professional.png"), fullPage: true });
  await page.getByPlaceholder(/Nome do novo item/i).fill("Cliente de demonstração");
  await page.getByRole("button", { name: /Criar/i }).click();
  await page.getByText(/Editar Cliente de demonstração/i).waitFor();
  await page.screenshot({ path: resolve(evidencePath, "workspace-crud-form.png"), fullPage: true });
  await page.getByRole("button", { name: /Fechar editor/i }).click();
  await page.getByRole("button", { name: /Convertio e GIF/i }).click();
  await page.getByText(/Convertio para GIF/i).waitFor();
  await page.screenshot({ path: resolve(evidencePath, "convertio-settings.png"), fullPage: true });
  await page.getByRole("button", { name: /Dados e reset/i }).click();
  await page.getByText(/Dados locais e segurança/i).waitFor();
  await page.screenshot({ path: resolve(evidencePath, "data-security.png"), fullPage: true });
  await page.getByRole("button", { name: /Breakpoints/i }).click();
  await page.getByText(/Laboratório responsivo/i).waitFor();
  await page.screenshot({ path: resolve(evidencePath, "breakpoint-lab.png"), fullPage: true });

  const host = await context.newPage();
  host.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  host.on("pageerror", (error) => errors.push(error.message));
  await host.goto("http://127.0.0.1:43117/");
  const toolbar = host.getByRole("toolbar", { name: "QA Toolbar Sandbox" });
  await toolbar.waitFor({ timeout: 15_000 });
  await host.waitForTimeout(1_000);
  if (!await toolbar.isVisible()) {
    const stored = await worker.evaluate(async () => chrome.storage.local.get(["qtsAuthSession", "qtsEntitlementCache"]));
    const hosts = await host.locator("qts-toolbar").count();
    throw new Error(`A toolbar desapareceu depois da inicialização. hosts=${hosts} session=${Boolean(stored.qtsAuthSession)} entitlement=${Boolean(stored.qtsEntitlementCache)}`);
  }
  const tools = toolbar.getByRole("button", { name: /Ferramentas|Tools/i });
  await tools.click();
  if (!await toolbar.isVisible()) throw new Error("A toolbar desapareceu ao abrir Ferramentas.");
  await tools.click();
  await host.waitForTimeout(250);
  if (!await toolbar.isVisible()) throw new Error("A toolbar desapareceu ao fechar Ferramentas.");
  await tools.click();
  await host.waitForTimeout(250);
  if (!await toolbar.isVisible()) throw new Error("A toolbar desapareceu na segunda abertura de Ferramentas.");
  await host.screenshot({ path: resolve(evidencePath, "toolbar-host-page.png"), fullPage: true });

  if (errors.length) throw new Error(`Chrome runtime errors:\n${errors.join("\n")}`);
  console.log(JSON.stringify({ extensionId, optionsLoggedOut: true, authGate: true, optionsLoggedIn: true, toolbarMountedForSession: true, consoleErrors: 0 }));
} finally {
  await context.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
