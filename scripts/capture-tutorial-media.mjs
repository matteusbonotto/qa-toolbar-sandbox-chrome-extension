// Local/manual media capture for the extension's Tutorial panel (Part B). Modeled directly on the
// already-validated pattern in scripts/smoke-extension.mjs (launchPersistentContext + route mocks
// for the Edge Functions + extensionId extraction via serviceWorkers()) -- the novelty here is
// aiming the bar at real external sites (demoqa.com / saucedemo.com, per the user's request)
// instead of the local fixture server, and saving screenshots into a VERSIONED directory
// (apps/extension/src/options/tutorial-assets/) since artifacts/ is gitignored and can't be the
// final destination for assets the Tutorial panel loads at runtime.
//
// Not part of CI -- run manually with `npm run tutorial:capture` and review the PNGs before
// committing. Captures an initial representative batch (workspace setup + flagship tools that
// don't require a second site login); rerun/extend later for the remaining tools.
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "apps/extension");
const profilePath = resolve(root, "artifacts/chrome-tutorial-capture-profile");
const assetsPath = resolve(root, "apps/extension/src/options/tutorial-assets");
const trace = (label) => console.log(`[tutorial-capture] ${label}`);
await rm(profilePath, { recursive: true, force: true });
await mkdir(assetsPath, { recursive: true });

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--window-position=20,20", "--window-size=1440,960", "--no-first-run"],
  viewport: { width: 1440, height: 960 },
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
  if (name === "access-status") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ active: true, plan: { key: "release-manager", name: "Release Manager" }, source: "manual", expiresAt: null, features: { "characterCounter.enabled": true, "multiClick.enabled": true, "inputLab.enabled": true, "fakerFill.enabled": true, "macroStudio.enabled": true, "keyView.enabled": true, "elementCapture.enabled": true }, checkedAt: new Date().toISOString() }) });
  if (name === "legal-registration") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, status: "payment_pending", softwareName: "QA Toolbar Sandbox", holderName: "Matheus Alves Bonotto Santos", protocolNumber: null, protocolDate: null, registrationNumber: null, grantDate: null, publicQueryUrl: null, publicNotice: null, updatedAt: new Date().toISOString() }) });
  return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await options.locator("#loginEmail").fill("tutorial-capture@example.com");
  await options.locator("#loginPassword").fill("safe-test-password");
  await options.locator("#loginForm button[type=submit]").click();
  await options.locator('.protectedNav[data-tab="workspace"]:not(:disabled)').waitFor({ timeout: 10_000 });
  trace("authenticated");

  await options.getByRole("button", { name: "Workspace" }).click();
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
  await options.locator('[data-workspace-tab="environments"]').click();
  await options.locator('.composerTrigger[data-open-composer="environmentComposer"]').click();
  await options.locator("#environmentName").fill("QA");
  await options.locator("#environmentColor").fill("#5b21b6");
  await options.locator("#environmentForm button[type=submit]").click();
  await options.locator('[data-workspace-tab="urls"]').click();
  for (const pattern of ["https://demoqa.com/*", "https://www.saucedemo.com/*"]) {
    await options.locator('[data-open-composer="urlRelationComposer"]').click();
    await options.locator("#urlRelationProduct").selectOption({ label: "Produto Demo" });
    await options.locator("#urlPatternInput").fill(pattern);
    await options.locator("#urlPatternAdd").click();
    await options.locator(".environmentToggle", { hasText: "QA" }).click();
    await options.locator("#urlRelationForm button[type=submit]").click();
  }
  trace("workspace ready (Cliente Demo / Projeto Demo / Produto Demo, demoqa.com + saucedemo.com)");
  await options.locator('[data-workspace-tab="structure"]').click();
  await options.screenshot({ path: resolve(assetsPath, "workspace-setup.png"), fullPage: true });
  trace("captured workspace-setup.png");

  const host = await context.newPage();
  // demoqa.com is ad-heavy and slow to reach a full "load" event; domcontentloaded + a generous
  // timeout is enough since we only need the DOM present for the toolbar's URL-match to fire.
  await host.goto("https://demoqa.com/text-box", { waitUntil: "domcontentloaded", timeout: 45_000 });
  const toolbar = host.locator("#qts-toolbar-host");
  await toolbar.waitFor({ state: "attached", timeout: 15_000 });
  await host.waitForTimeout(600);
  trace("toolbar mounted on demoqa.com/text-box");

  // Test Status
  await host.locator("#testStatusButton").click();
  await host.locator("#qts-test-status-modal").waitFor();
  await host.screenshot({ path: resolve(assetsPath, "test-status.png"), fullPage: false });
  await host.keyboard.press("Escape");
  trace("captured test-status.png");

  // Pass/Fail marker
  await host.locator("#passButton").click();
  await host.locator("#userName-label").click({ force: true });
  await host.screenshot({ path: resolve(assetsPath, "pass-fail.png"), fullPage: false });
  trace("captured pass-fail.png");

  // Screenshot button (captures the toast, not the resulting image)
  const cameraButton = host.locator('button[title]', { hasText: "" });
  await host.locator("#screenshotButton").click().catch(() => {});
  await host.screenshot({ path: resolve(assetsPath, "screenshot.png"), fullPage: false });
  trace("captured screenshot.png");

  // Click Spy
  await host.locator("#toolsButton").click();
  await host.locator("#clickSpyMenuItem").click();
  await host.locator("#userName").hover();
  await host.screenshot({ path: resolve(assetsPath, "click-spy.png"), fullPage: false });
  await host.locator("#toolsButton").click();
  await host.locator("#clickSpyMenuItem").click();
  trace("captured click-spy.png");

  // Freeze Clock (opens in the same drawer as Force HTTP/JSON Studio/etc -- close it explicitly
  // via #drawerClose rather than Escape, which these drawers don't listen for)
  await host.locator("#toolsButton").click();
  await host.locator("#freezeClockMenuItem").click();
  await host.waitForTimeout(300);
  await host.screenshot({ path: resolve(assetsPath, "freeze-clock.png"), fullPage: false });
  await host.locator("#drawerClose").click().catch(() => {});
  trace("captured freeze-clock.png");

  // Force HTTP
  await host.locator("#toolsButton").click();
  await host.locator("#forceHttpMenuItem").click();
  await host.waitForTimeout(300);
  await host.screenshot({ path: resolve(assetsPath, "force-http.png"), fullPage: false });
  await host.locator("#drawerClose").click().catch(() => {});
  trace("captured force-http.png");

  // Capturar Elementos
  await host.locator("#toolsButton").click();
  await host.locator("#elementCaptureMenuItem").click();
  await host.getByText(/elemento\(s\) encontrado\(s\)/).waitFor();
  await host.screenshot({ path: resolve(assetsPath, "element-capture.png"), fullPage: false });
  await host.locator("#drawerClose").click().catch(() => {});
  trace("captured element-capture.png");

  trace("done -- review the PNGs in apps/extension/src/options/tutorial-assets/ before committing");
} finally {
  await context.close();
}
