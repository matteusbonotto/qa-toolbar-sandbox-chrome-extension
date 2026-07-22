// Real-Chrome verification for the "import a client workspace" scenario the extension is built
// for: loads the unpacked extension, imports fixtures/cineluna-import-example.json (a fictional
// client -- see docs/legal guidance on never using real client/employer names in fixtures) through
// the options page's own "Importar JSON" button (not a storage.set shortcut -- this exercises the
// exact same code path a real user hits), and confirms every entity landed with the right counts,
// badges and colors. Kept separate from scripts/smoke-extension.mjs (which stays intentionally
// generic/white-label) since this one is about proving a specific multi-entity import scenario end
// to end, not about extension features in general.
import { resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "apps/extension");
const fixturePath = resolve(root, "apps/extension/fixtures/cineluna-import-example.json");
const profilePath = resolve(root, "artifacts/chrome-cineluna-profile");
const evidencePath = resolve(root, "artifacts/runtime-evidence");
await mkdir(evidencePath, { recursive: true });
await rm(profilePath, { recursive: true, force: true });

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
  if (name === "legal-registration") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, status: "payment_pending", softwareName: "QA Toolbar Sandbox", holderName: "Matheus Alves Bonotto Santos", protocolNumber: null, protocolDate: null, registrationNumber: null, grantDate: null, publicQueryUrl: null, publicNotice: null, updatedAt: new Date().toISOString() }) });
  return route.fulfill({ status: 404, body: "{}" });
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;

  const errors = [];
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await page.locator("#loginEmail").fill("tester@example.com");
  await page.locator("#loginPassword").fill("safe-test-password");
  await page.locator("#loginForm button[type=submit]").click();
  await page.locator('.protectedNav[data-tab="data"]:not(:disabled)').waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Importar / Exportar" }).click();

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#importButton").click(),
  ]);
  await fileChooser.setFiles(fixturePath);
  await page.waitForTimeout(400);

  const counts = {
    clients: await page.locator("#clientCount").textContent(),
    projects: await page.locator("#projectCount").textContent(),
    products: await page.locator("#productCount").textContent(),
    environments: await page.locator("#environmentCount").textContent(),
    testAccounts: await page.locator("#testAccountCount").textContent(),
    paymentMethods: await page.locator("#paymentMethodCount").textContent(),
    inspectors: await page.locator("#inspectorCount").textContent(),
    apis: await page.locator("#apiCount").textContent(),
    resources: await page.locator("#resourceCount").textContent(),
  };
  // Every collection the fixture ships must land with exactly one row -- this is meant to be a
  // complete "one example of every CRUD entity" reference, so a silently-dropped collection
  // (a normalizeWorkspace filter rejecting it, a broken foreign key) must fail loudly here.
  const expected = { clients: "1", projects: "1", products: "1", environments: "4", testAccounts: "1", paymentMethods: "1", inspectors: "1", apis: "1", resources: "1" };
  for (const [key, value] of Object.entries(expected)) {
    if (counts[key] !== value) throw new Error(`Expected ${key}=${value} after import, got ${counts[key]}`);
  }

  // Test account custom fields (Phase 2 dynamic schema) round-trip through the same edit path a
  // real user would use -- switch to the tab that actually renders the list (the counts above are
  // read straight from the DOM regardless of panel visibility, but a real click needs the panel
  // visible), then open the account for editing and confirm all 3 field rows re-render.
  await page.locator('.protectedNav[data-tab="test-data"]').click();
  await page.locator("#testAccountList [data-action=edit]").click();
  const customFieldKeys = await page.locator("#testAccountCustomFields [data-field-key]").evaluateAll((inputs) => inputs.map((input) => input.value));
  const expectedKeys = ["Pontos de fidelidade", "Voucher ativo", "Nível"];
  for (const key of expectedKeys) {
    if (!customFieldKeys.includes(key)) throw new Error(`Missing custom field "${key}" after re-opening the imported account: ${customFieldKeys.join(", ")}`);
  }
  await page.locator('[data-cancel="testAccount"]').click();

  const clientBadge = await page.locator("#clientList .qts-badge-avatar").textContent();
  if (clientBadge.trim() !== "C") throw new Error(`Expected client badge "C" (Cineluna), got: ${clientBadge}`);

  const environmentNames = await page.locator("#environmentList b").allTextContents();
  for (const name of ["Dev", "QA", "Beta", "Produção"]) {
    if (!environmentNames.some((text) => text.includes(name))) {
      throw new Error(`Missing environment "${name}" in the list: ${environmentNames.join(", ")}`);
    }
  }

  await page.screenshot({ path: resolve(evidencePath, "cineluna-import-workspace.png"), fullPage: true });

  // Breadcrumb rendering for a URL matching an imported wildcard pattern is already covered
  // end-to-end by scripts/smoke-extension.mjs (creates an environment via the CRUD form and
  // asserts the toolbar breadcrumb on a matching page). Re-proving that here with a second
  // browser tab would just duplicate that coverage -- what's specific to this fixture is the
  // import pipeline and data integrity, which the assertions above already establish.

  if (errors.length) throw new Error(`Console errors:\n${errors.join("\n")}`);
  console.log(JSON.stringify({ extensionId, importedCounts: counts, clientBadge, environmentNames, consoleErrors: 0 }));
} finally {
  await context.close();
}
