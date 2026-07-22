// Local/manual media capture for the extension's Tutorial panel (Part B revision). Modeled on the
// already-validated pattern in scripts/smoke-extension.mjs (launchPersistentContext + route mocks
// for the Edge Functions + extensionId extraction via serviceWorkers(), and the exact tool
// interaction selectors already proven there) -- the novelty here is aiming the bar at a real
// external site (demoqa.com) instead of the local fixture server, recording a short video per tool
// (Playwright's native recordVideo, one fresh page per tool so each clip stays short and focused),
// and saving everything into a VERSIONED directory (apps/extension/src/options/tutorial-assets/)
// since artifacts/ is gitignored and can't be the final destination for assets the Tutorial panel
// loads at runtime.
//
// Not part of CI -- run manually with `npm run tutorial:capture` and review the media before
// committing. Each tool capture is wrapped so one failure doesn't abort the whole batch; failures
// are reported at the end so they're easy to re-run individually later.
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "apps/extension");
const profilePath = resolve(root, "artifacts/chrome-tutorial-capture-profile");
const videoTmpPath = resolve(root, "artifacts/tutorial-video-tmp");
const assetsPath = resolve(root, "apps/extension/src/options/tutorial-assets");
const DEMO_URL = "https://demoqa.com/text-box";
const trace = (label) => console.log(`[tutorial-capture] ${label}`);
await rm(profilePath, { recursive: true, force: true });
await rm(videoTmpPath, { recursive: true, force: true });
await mkdir(assetsPath, { recursive: true });
await mkdir(videoTmpPath, { recursive: true });

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
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
  if (name === "access-status") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ active: true, plan: { key: "release-manager", name: "Release Manager" }, source: "manual", expiresAt: null, features: { "characterCounter.enabled": true, "multiClick.enabled": true, "inputLab.enabled": true, "fakerFill.enabled": true, "macroStudio.enabled": true, "keyView.enabled": true, "elementCapture.enabled": true }, checkedAt: new Date().toISOString() }) });
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

async function closeDrawer(page) {
  await page.locator("#drawerClose").click().catch(() => {});
}

// One fresh page per tool keeps each recorded .webm short and focused on that single tool, instead
// of one long video covering the whole session -- Playwright's recordVideo is context-scoped, so a
// page's own clip is finalized (and renameable via page.video().saveAs) once that page closes.
async function captureTool(key, action) {
  const page = await context.newPage();
  try {
    await waitForToolbar(page);
    await action(page);
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: resolve(assetsPath, `${key}.png`), fullPage: false });
    const video = page.video();
    await page.close();
    if (video) await video.saveAs(resolve(assetsPath, `${key}.webm`));
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

  // Seed a test account, a payment method and a resource too, so the corresponding tools have
  // something real to display instead of an empty drawer.
  await options.locator('[data-workspace-tab="accounts"]').click();
  await options.locator('[data-open-composer="testAccountComposer"]').click();
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
  await options.locator('[data-workspace-tab="integrations"]').click();
  await options.locator('[data-open-composer="resourceComposer"]').click();
  await options.locator("#resourceLabel").fill("Runbook QA");
  await options.locator("#resourceUrl").fill("https://example.com/runbook");
  await options.locator("#resourceForm button[type=submit]").click();
  trace("workspace ready (client/project/product/environment/URLs/account/payment/resource)");

  await options.locator('[data-workspace-tab="structure"]').click();
  await options.screenshot({ path: resolve(assetsPath, "workspace-setup.png"), fullPage: true });
  trace("captured workspace-setup.png");
  await options.close();

  await captureTool("testStatus", async (page) => {
    await page.locator("#testStatusButton").click();
    await page.locator("#qts-test-status-modal").waitFor();
  });

  await captureTool("passFail", async (page) => {
    await page.locator("#passButton").click();
    await page.locator("#userName-label").click({ force: true });
  });

  await captureTool("notesShapes", async (page) => {
    await page.locator("#noteButton").click();
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
    await openToolByMenu(page, "clickSpyMenuItem");
    await page.locator("#userName").hover();
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
  });

  await captureTool("characterCounter", async (page) => {
    await openToolByMenu(page, "characterCounterMenuItem");
    await page.locator("#characterCounterInput").fill("QA Toolbar Sandbox\nTeste de contagem");
  });

  await captureTool("multiClick", async (page) => {
    await openToolByMenu(page, "multiClickMenuItem");
    await page.locator("#multiSelect").click();
    await page.locator("#submit").click();
    await page.locator("#multiCount").fill("3");
    await page.locator("#multiInterval").fill("150");
    await page.locator("#multiRun").click();
  });

  await captureTool("inputLab", async (page) => {
    await openToolByMenu(page, "inputLabMenuItem");
    await page.locator("#inputSelect").click();
    await page.locator("#userName").click();
    await page.locator("#inputRun").click();
    await page.locator("#inputResults tbody tr").first().waitFor();
  });

  await captureTool("fakerFill", async (page) => {
    await openToolByMenu(page, "fakerFillMenuItem");
    await page.locator("#fakerRun").click();
  });

  await captureTool("macroStudio", async (page) => {
    await openToolByMenu(page, "macroStudioMenuItem");
    await page.locator("#startMacroRecording").click();
    await page.locator("#userName").click();
    await page.keyboard.type("QA Toolbar Sandbox");
    await page.locator("#userName").press("Tab");
    await page.locator("#macroRecDoneButton").click();
    await page.locator("#macroSave").click();
    await page.locator("#macroList .qts-card").first().waitFor();
  });

  await captureTool("keyView", async (page) => {
    await openToolByMenu(page, "keyViewMenuItem");
    await page.locator("#keyViewToggle").click();
    await closeDrawer(page);
    await page.locator("h1").click();
    await page.keyboard.press("Control+V");
  });

  await captureTool("elementCapture", async (page) => {
    await openToolByMenu(page, "elementCaptureMenuItem");
    await page.getByText(/elemento\(s\) encontrado\(s\)/).waitFor();
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

  if (failures.length) trace(`done with failures: ${failures.join(", ")} -- rerun this script, only the failed tools need retrying (workspace setup is idempotent-ish but review the profile first)`);
  else trace("done -- review the media in apps/extension/src/options/tutorial-assets/ before committing");
} finally {
  await context.close();
  await rm(videoTmpPath, { recursive: true, force: true });
}
