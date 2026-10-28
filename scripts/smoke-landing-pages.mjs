import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const workspace = process.cwd();
const landingDirectory = path.join(workspace, "apps", "landing");
const landingDist = path.join(landingDirectory, "dist");
const adminDist = path.join(workspace, "apps", "admin", "dist");
const adminTarget = path.join(landingDist, "admin");
const extensionVersion = JSON.parse(fs.readFileSync(path.join(workspace, "apps", "extension", "manifest.json"), "utf8")).version;
const basePath = "/qa-toolbar-sandbox-chrome-extension/";
const origin = "http://127.0.0.1:4173";

if (!fs.existsSync(path.join(landingDist, "index.html")) || !fs.existsSync(path.join(adminDist, "index.html"))) {
  throw new Error("Build landing and admin before running the Pages smoke test.");
}
fs.mkdirSync(adminTarget, { recursive: true });
fs.cpSync(adminDist, adminTarget, { recursive: true, force: true });
fs.copyFileSync(path.join(landingDist, "index.html"), path.join(landingDist, "404.html"));

const viteCli = path.join(workspace, "node_modules", "vite", "bin", "vite.js");
const preview = spawn(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", "4173", "--base", basePath], {
  cwd: landingDirectory,
  stdio: "ignore",
  windowsHide: true,
});

async function waitForPreview() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${origin}${basePath}`);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Vite preview did not start.");
}

// Founder report 2026-10-28 (live presentation): no visible feedback for a voucher, and a voucher
// applied before sign-up was lost across the e-mail confirmation (new page load), so access never
// became active and the install button never appeared. Backend responses are mocked here so the
// smoke proves the real UI states (inline, persistent, aria roles) and the resume after
// confirmation without touching any real voucher or account.
const supabaseOrigin = "https://xhusvkylbouwtpcevgri.supabase.co";
const domainVoucher = {
  valid: true,
  kind: "days",
  label: "Campanha MB Labs",
  plan: { key: "regression-runner", name: "Regression Runner" },
  grantDays: 30,
  discountPercentOff: null,
  discountAmountOffMinor: null,
  allowedEmailDomains: ["mblabs.com.br"],
};

const smokeUser = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "qa@mblabs.com.br",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-10-28T00:00:00.000Z",
};
const intentKey = "qts:pending-plan-intent:v1";

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

// Every backend call of the pricing flow is answered locally: no real voucher, account or Stripe
// session is ever touched. Later routes take precedence in Playwright, so the catch-alls go first.
async function mockVoucherBackend(context, { onCheckout, accessFailsAfterGrant = false } = {}) {
  let redeemed = false;
  await context.route(`${supabaseOrigin}/rest/v1/**`, (route) => {
    if (route.request().url().includes("/stripe_prices")) {
      return json(route, ["regression-runner", "root-cause-analyst", "release-manager"].flatMap((key, index) => [
        { billing_cycle: "monthly", amount_minor: 1900 + index * 1000, currency: "brl", plans: { key } },
        { billing_cycle: "yearly", amount_minor: 18000 + index * 9000, currency: "brl", plans: { key } },
      ]));
    }
    return json(route, []);
  });
  await context.route(`${supabaseOrigin}/rest/v1/store_listing_status**`, (route) => json(route, [{ chrome_web_store_version: extensionVersion, status: "live" }]));
  await context.route(`${supabaseOrigin}/functions/v1/**`, (route) => json(route, {}));
  await context.route(`${supabaseOrigin}/auth/v1/user**`, (route) => json(route, smokeUser));
  // Sign-up with e-mail confirmation required: a user and no session.
  await context.route(`${supabaseOrigin}/auth/v1/signup**`, (route) => json(route, { ...smokeUser, identities: [{ id: smokeUser.id }] }));
  await context.route(`${supabaseOrigin}/functions/v1/voucher-preview`, (route) => {
    const { code } = route.request().postDataJSON() ?? {};
    return json(route, code === "MBLABS-2026" ? domainVoucher : { valid: false, reason: "voucher_unavailable" });
  });
  await context.route(`${supabaseOrigin}/functions/v1/checkout-create-session`, (route) => {
    redeemed = true;
    onCheckout?.(route.request().postDataJSON());
    return json(route, { accessGranted: true, voucherRedeemed: true, label: domainVoucher.label, expiresAt: "2026-11-27T00:00:00.000Z" });
  });
  await context.route(`${supabaseOrigin}/functions/v1/access-status`, (route) => {
    if (redeemed && accessFailsAfterGrant) return json(route, { error: "service_unavailable" }, 503);
    return json(route, redeemed
      ? {
        active: true, plan: { key: "regression-runner", name: "Regression Runner" }, source: "voucher",
        expiresAt: "2026-11-27T00:00:00.000Z", billing: null, checkedAt: new Date().toISOString(),
        installUrl: "https://chromewebstore.google.com/detail/qa-toolbar-sandbox/ddaapjklnfjhjigeglgmjmadjnmdodfe",
      }
      : { active: false, plan: null, source: null, expiresAt: null, billing: null, installUrl: null, checkedAt: new Date().toISOString() });
  });
}

// What the sign-up confirmation link puts in the URL (implicit flow); supabase-js turns it into a
// session (GET /auth/v1/user is mocked above) and shares it with the other open tabs.
function confirmationLinkUrl() {
  const base64Url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({ sub: smokeUser.id, email: smokeUser.email, role: "authenticated", aud: "authenticated", exp: expiresAt })}.smoke`;
  const hash = new URLSearchParams({
    access_token: accessToken, refresh_token: "test-smoke-refresh", expires_in: "3600",
    expires_at: String(expiresAt), token_type: "bearer", type: "signup",
  });
  return `${origin}${basePath}#${hash}`;
}

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function smokeVoucherFeedbackAndResume(browserInstance) {
  // 1) Guest: invalid code, then a valid domain-restricted voucher with its action inside the preview.
  const guest = await browserInstance.newContext({ viewport: { width: 1280, height: 900 } });
  await mockVoucherBackend(guest);
  const guestPage = await guest.newPage();
  await guestPage.goto(`${origin}${basePath}`, { waitUntil: "networkidle" });
  await guestPage.locator("#qts-voucher-code").fill("codigo-errado");
  await guestPage.getByRole("button", { name: "Aplicar" }).click();
  const voucherError = guestPage.locator("#qts-voucher-error");
  await voucherError.waitFor();
  if (await voucherError.getAttribute("role") !== "alert" || !(await voucherError.innerText()).includes("Voucher inválido")) {
    throw new Error("Invalid voucher does not show an inline role=alert message next to the field.");
  }
  // The old toast vanished after 6s; the inline error must still be there afterwards.
  await guestPage.waitForTimeout(6_500);
  if (!(await voucherError.isVisible())) throw new Error("Invalid voucher error auto-dismissed; errors must persist.");

  await guestPage.locator("#qts-voucher-code").fill("mblabs-2026");
  await guestPage.locator("#qts-voucher-code").press("Enter");
  const preview = guestPage.locator("#qts-voucher-preview");
  await preview.waitFor();
  const previewText = await preview.innerText();
  for (const expected of ["Voucher válido", "MBLABS-2026", "Exclusivo para e-mails @mblabs.com.br", "Ainda não resgatado. Clique abaixo e crie sua conta"]) {
    if (!previewText.includes(expected)) throw new Error(`Voucher preview is missing "${expected}": ${previewText}`);
  }
  if (await voucherError.count()) throw new Error("Previous voucher error stayed visible after a valid voucher.");
  if ((await guestPage.locator(".qts-voucher-row button[type=submit]").innerText()).trim() !== "Aplicar") {
    throw new Error("Apply button label changed while the inline checking line is the feedback.");
  }
  const previewCta = preview.locator(".qts-voucher-cta");
  if ((await previewCta.innerText()).trim() !== "30 dias grátis") throw new Error("Voucher preview has no action button with the plan CTA label.");
  if (!(await guestPage.locator(".qts-plan-card").nth(1).getAttribute("class"))?.includes("is-voucher-highlight")) {
    throw new Error("Plan card targeted by the voucher lost its highlight.");
  }

  await previewCta.click();
  const dialog = guestPage.getByRole("dialog");
  await dialog.waitFor();
  if (await dialog.getByRole("tab", { name: "Criar conta" }).getAttribute("aria-selected") !== "true") {
    throw new Error("Auth modal opened from a voucher does not start on the sign-up tab.");
  }
  if (!(await dialog.locator(".qts-auth-context").innerText()).includes("resgatar o voucher MBLABS-2026")) {
    throw new Error("Auth modal does not show the queued voucher in place of the generic lead.");
  }
  await dialog.locator('input[type="email"]').fill("qa@gmail.com");
  const domainHint = dialog.locator("#qts-auth-domain-hint");
  if (!(await domainHint.innerText()).includes("não será resgatado") || !(await domainHint.getAttribute("class"))?.includes("is-warning")) {
    throw new Error("Auth modal does not warn that the typed e-mail is outside the voucher domain.");
  }
  const savedIntent = await guestPage.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), intentKey);
  if (savedIntent?.voucherCode !== "MBLABS-2026" || savedIntent?.planId !== "regression-runner") {
    throw new Error(`Plan click did not persist the pending voucher/plan intent: ${JSON.stringify(savedIntent)}`);
  }
  await dialog.locator(".qts-auth-close").click();
  if (await guestPage.evaluate((key) => localStorage.getItem(key), intentKey) !== null) {
    throw new Error("Abandoning the auth modal before any e-mail step must discard this tab's pending intent.");
  }
  await guestPage.setViewportSize({ width: 360, height: 800 });
  if (await horizontalOverflow(guestPage) > 2) throw new Error("Voucher feedback overflows at 360px.");
  await guest.close();

  // 2) Sign-up needing e-mail confirmation, a third tab opening/closing the header modal (M2),
  //    then the confirmation link in a new tab while the original tab stays open (M1).
  const multi = await browserInstance.newContext({ viewport: { width: 360, height: 800 } });
  const checkoutBodies = [];
  await mockVoucherBackend(multi, { onCheckout: (body) => checkoutBodies.push(body) });
  const tabA = await multi.newPage();
  await tabA.goto(`${origin}${basePath}`, { waitUntil: "networkidle" });
  await tabA.locator("#qts-voucher-code").fill("MBLABS-2026");
  await tabA.locator("#qts-voucher-code").press("Enter");
  await tabA.locator(".qts-voucher-cta").click();
  const signupDialog = tabA.getByRole("dialog");
  await signupDialog.waitFor();
  await signupDialog.locator('input[type="email"]').fill("qa@mblabs.com.br");
  await signupDialog.locator('input[type="password"]').fill("senha-de-teste-123");
  await signupDialog.locator("#qts-auth-terms").check();
  await signupDialog.locator(".qts-auth-submit").click();
  const awaiting = signupDialog.locator(".qts-auth-awaiting");
  await awaiting.waitFor();
  const awaitingText = await awaiting.innerText();
  if (!awaitingText.includes("Confira seu e-mail") || !awaitingText.includes("qa@mblabs.com.br") || !awaitingText.includes("MBLABS-2026")) {
    throw new Error(`Sign-up without session does not show the dedicated check-your-e-mail panel: ${awaitingText}`);
  }
  await tabA.waitForFunction(() => document.activeElement?.tagName === "H4");
  const intentAfterSignup = await tabA.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), intentKey);
  if (intentAfterSignup?.email !== "qa@mblabs.com.br") throw new Error("Sign-up did not attach the e-mail to the pending intent.");
  await awaiting.getByRole("button", { name: "Fechar" }).click();
  if (!(await tabA.locator(".qts-resume-notice").innerText()).includes("Falta confirmar seu e-mail")) {
    throw new Error("Closing the modal after sign-up forgets that the e-mail still has to be confirmed.");
  }

  const tabC = await multi.newPage();
  await tabC.goto(`${origin}${basePath}`, { waitUntil: "networkidle" });
  await tabC.locator(".qts-site-toolbar-cta").click();
  await tabC.getByRole("dialog").waitFor();
  await tabC.locator(".qts-auth-close").click();
  if ((await tabC.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), intentKey))?.voucherCode !== "MBLABS-2026") {
    throw new Error("Opening and closing the header modal in another tab deleted the pending intent (M2).");
  }

  const tabB = await multi.newPage();
  await tabB.goto(confirmationLinkUrl(), { waitUntil: "networkidle" });
  const accessPanel = tabB.locator(".qts-access-ready");
  await accessPanel.waitFor({ timeout: 15_000 });
  const panelText = await accessPanel.innerText();
  if (!panelText.includes("Voucher resgatado") || !panelText.includes("Instalar pela Chrome Web Store") || !panelText.includes("voucher MBLABS-2026")) {
    throw new Error(`Access panel does not show the redeemed state and install step: ${panelText}`);
  }
  if (!(await tabB.locator(".qts-install-fab").count())) throw new Error("Floating install button did not appear after resume.");
  if (await horizontalOverflow(tabB) > 2) throw new Error("Access panel overflows at 360px.");
  // Give the other tabs time to receive the shared session; none of them may redeem again.
  await tabB.waitForTimeout(2_000);
  if (checkoutBodies.length !== 1 || checkoutBodies[0]?.voucherCode !== "MBLABS-2026" || checkoutBodies[0]?.planKey !== "regression-runner") {
    throw new Error(`Pending voucher must be redeemed exactly once, by the e-mail link tab (M1): ${JSON.stringify(checkoutBodies)}`);
  }
  for (const [name, tab] of [["original", tabA], ["header-modal", tabC]]) {
    if (await tab.locator('.qts-resume-notice[aria-busy="true"]').count()) throw new Error(`The ${name} tab started a resume from a cross-tab session (M1).`);
  }
  if (await tabB.evaluate((key) => localStorage.getItem(key), intentKey) !== null) throw new Error("Pending intent was not cleared after being resumed.");
  await tabB.reload({ waitUntil: "networkidle" });
  await tabB.locator(".qts-access-ready").waitFor();
  if (checkoutBodies.length !== 1) throw new Error("Pending intent was resumed more than once.");
  await multi.close();

  // 3) Grant succeeded but access-status keeps failing: never end in silence (UX review HIGH 1).
  const flaky = await browserInstance.newContext({ viewport: { width: 1280, height: 900 } });
  await mockVoucherBackend(flaky, { accessFailsAfterGrant: true });
  await flaky.addInitScript((key) => {
    if (sessionStorage.getItem("qts-smoke-seeded")) return;
    sessionStorage.setItem("qts-smoke-seeded", "1");
    localStorage.setItem(key, JSON.stringify({ planId: "regression-runner", billingCycle: "monthly", voucherCode: "MBLABS-2026", email: "qa@mblabs.com.br", savedAt: Date.now() }));
  }, intentKey);
  const flakyPage = await flaky.newPage();
  await flakyPage.goto(confirmationLinkUrl(), { waitUntil: "networkidle" });
  const flakyNotice = flakyPage.locator(".qts-resume-notice", { hasText: "Não conseguimos carregar o botão de instalar" });
  await flakyNotice.waitFor({ timeout: 15_000 });
  if (!(await flakyNotice.getByRole("button", { name: "Recarregar" }).count())) throw new Error("Access-load failure after a grant has no reload action.");
  await flaky.close();
}

let browser;
try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // Store review status is backed by an optional migration that may not exist in every project
  // used to build/test the static artifact. Mock only this row; pricing and auth continue hitting
  // the official backend so the Pages smoke still detects real integration regressions.
  await page.route("https://xhusvkylbouwtpcevgri.supabase.co/rest/v1/store_listing_status**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ chrome_web_store_version: extensionVersion, status: "live" }]),
  }));
  await page.route("https://xhusvkylbouwtpcevgri.supabase.co/rest/v1/legal_registration**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "preparation",
      software_name: "QA Toolbar Sandbox",
      holder_name: "Matheus Alves Bonotto Santos",
      protocol_number: null,
      protocol_date: null,
      registration_number: null,
      grant_date: null,
      public_query_url: null,
      public_notice: null,
      updated_at: new Date().toISOString(),
    }),
  }));
  const consoleErrors = [];
  const failedResources = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${origin}${basePath}`, { waitUntil: "networkidle" });
  const landingBrand = page.locator(".qts-site-toolbar-logo.qts-logo-light");
  if (!await landingBrand.getAttribute("src").then((value) => value?.endsWith("qa-toolbar-sandbox-logo.svg"))) {
    throw new Error("Landing navigation does not use the new color SVG logo.");
  }
  if (!await landingBrand.evaluate((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)) {
    throw new Error("Landing color SVG logo did not load.");
  }
  const landingBrandDark = page.locator(".qts-site-toolbar-logo.qts-logo-dark");
  if (!await landingBrandDark.getAttribute("src").then((value) => value?.endsWith("qa-toolbar-sandbox-logo-dark.svg"))) {
    throw new Error("Landing navigation is missing the dark-scheme SVG logo variant.");
  }
  if (!await landingBrandDark.evaluate((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)) {
    throw new Error("Landing dark SVG logo did not load.");
  }
  if (await page.locator(".qts-plan-card").count() !== 4) {
    throw new Error(`Expected four pricing plans. URL=${page.url()} title=${await page.title()} resources=${failedResources.join(" | ")} console=${consoleErrors.join(" | ")}`);
  }
  await page.waitForFunction(() => !document.querySelector("#planos")?.textContent?.includes("Aguarde"));
  const pricingText = await page.locator("#planos").innerText();
  if (!pricingText.includes("R$")) {
    throw new Error(`Official backend prices did not render. resources=${failedResources.join(" | ")} console=${consoleErrors.join(" | ")} content=${pricingText.slice(0, 500)}`);
  }
  const landingText = await page.locator("body").innerText();
  if (/\b(?:Supabase|backend)\b/i.test(landingText)) {
    throw new Error("Customer-facing landing copy contains implementation details.");
  }
  if (await page.locator(".qts-account-panel").count()) {
    throw new Error("Account form must not remain embedded in the pricing page.");
  }
  if (await page.locator(".qts-reward-wheel").count()) {
    throw new Error("Rewards wheel must stay hidden until the user explicitly clicks Try your luck.");
  }
  const communityHeadings = await page.locator("#comunidade h3").allInnerTexts();
  if (!communityHeadings.some((text) => text.includes("Atividades da comunidade")) || !communityHeadings.some((text) => text.includes("Pronto para testar a sorte"))) {
    throw new Error("Rewards section does not present community activities before the luck CTA.");
  }
  if (await page.locator(".qts-community-activity-preview > div").count() !== 3) throw new Error("Logged-out community section does not explain its three activities before authentication");
  await page.locator(".qts-luck-cta .qts-btn").click();
  const wheelDialog = page.getByRole("dialog", { name: "Pronto para testar a sorte?" });
  await wheelDialog.waitFor();
  const wheelDialogWidth = await wheelDialog.evaluate((element) => element.getBoundingClientRect().width);
  if (wheelDialogWidth < 700) throw new Error(`Desktop wheel modal inherited an incorrectly narrow generic width: ${wheelDialogWidth}px`);
  if (!(await wheelDialog.getByText("Seus pontos atuais").count()) || !(await wheelDialog.getByText("Entre para consultar seus pontos e participar.").count())) {
    throw new Error("Logged-out rewards modal does not explain points and authentication.");
  }
  if (!(await wheelDialog.locator(".qts-reward-wheel").count())) throw new Error("Rewards wheel is not centered inside its modal.");
  if (!(await wheelDialog.locator(".qts-wheel-segment-label").count())) throw new Error("Rewards wheel does not show prize labels inside its segments.");
  await wheelDialog.getByRole("button", { name: "Entrar para participar" }).click();
  await page.getByRole("dialog", { name: "Sua conta" }).waitFor();
  await page.locator(".qts-auth-close").click();
  if ((await page.locator('.qts-billing-toggle-row [role="radio"][aria-checked="true"]').innerText()).trim() !== "Mensal") {
    throw new Error("Pricing must default to monthly billing; annual billing cannot be preselected.");
  }
  if (!(await page.locator('label[for="qts-voucher-code"]').count())) {
    throw new Error("Voucher input has no explicit accessible label.");
  }
  await page.getByRole("button", { name: "Alterar idioma para EN" }).click();
  if (await page.locator("html").getAttribute("lang") !== "en") throw new Error("English locale did not update html.lang");
  if (!(await page.title()).includes("Manual testing")) throw new Error("English locale did not update document metadata");
  if (!(await page.locator('meta[name="description"]').getAttribute("content"))?.includes("Manual testing")) throw new Error("English locale did not update meta description");
  if ((await page.locator(".qts-site-toolbar-cta").innerText()).trim() !== "Sign in") throw new Error("Logged-out navbar CTA is not translated in English");
  if (!(await page.getByRole("navigation", { name: "Page navigation" }).count())) throw new Error("Navigation accessible name was not translated");
  await page.getByRole("button", { name: "Switch language to PT" }).click();

  await page.locator(".qts-site-toolbar-cta").click();
  const accountDialog = page.getByRole("dialog");
  await accountDialog.waitFor();
  if (await accountDialog.locator('input[type="email"]').count() !== 1 || await accountDialog.locator('input[type="password"]').count() !== 1) {
    throw new Error("Navbar account modal did not render the login form.");
  }
  if (!await accountDialog.evaluate((dialog) => dialog.contains(document.activeElement))) throw new Error("Account modal did not move focus inside");
  if (!await page.locator("#root").evaluate((root) => root.inert && root.getAttribute("aria-hidden") === "true")) throw new Error("Background is not inert while account modal is open");
  const signInTab = accountDialog.getByRole("tab", { name: "Entrar" });
  const signUpTab = accountDialog.getByRole("tab", { name: "Criar conta" });
  if (await signInTab.getAttribute("aria-controls") !== "qts-auth-panel" || await signUpTab.getAttribute("tabindex") !== "-1") {
    throw new Error("Account modal tabs do not expose correct ARIA/roving tabindex state");
  }
  await signInTab.focus();
  await page.keyboard.press("ArrowRight");
  if (await signUpTab.getAttribute("aria-selected") !== "true" || await accountDialog.getByRole("tabpanel").getAttribute("aria-labelledby") !== "qts-auth-tab-signup") {
    throw new Error("Account modal tabs do not support keyboard navigation");
  }
  await accountDialog.locator(".qts-auth-submit").click();
  const emailInput = accountDialog.locator('input[type="email"]');
  if (await emailInput.getAttribute("aria-invalid") !== "true" || await emailInput.getAttribute("aria-describedby") !== "qts-email-error") {
    throw new Error("Account modal did not expose field-specific email validation");
  }
  if (!await emailInput.evaluate((input) => input === document.activeElement)) throw new Error("Account modal did not focus the first invalid field");
  await emailInput.fill("qa@example.com");
  await accountDialog.locator('input[type="password"]').fill("curta");
  await accountDialog.locator(".qts-auth-submit").click();
  if (!(await accountDialog.getByText("A senha deve ter pelo menos 8 caracteres.").count()) || !(await accountDialog.getByText("Aceite a Política de Privacidade para criar sua conta.").count())) {
    throw new Error("Signup does not report password and terms errors separately");
  }
  await page.keyboard.press("Shift+Tab");
  if (!await accountDialog.evaluate((dialog) => dialog.contains(document.activeElement))) throw new Error("Account modal focus escaped backwards");
  await accountDialog.locator(".qts-auth-close").click();
  if (await page.locator("#root").evaluate((root) => root.inert || root.hasAttribute("aria-hidden"))) throw new Error("Modal close did not restore the page accessibility tree");
  await page.waitForFunction(() => document.querySelector(".qts-site-toolbar-cta") === document.activeElement);
  await page.locator(".qts-plan-cta").first().click();
  await page.getByRole("dialog").waitFor();
  await page.locator(".qts-auth-close").click();

  await page.goto(`${origin}${basePath}privacidade`, { waitUntil: "networkidle" });
  if (!(await page.getByRole("heading", { name: "O que o QA Toolbar Sandbox pede ao seu navegador" }).count())) throw new Error("Privacy route did not render its complete policy");
  if (!(await page.getByRole("navigation", { name: "Navegação da página" }).count())) throw new Error("Privacy route is missing the global navigation/language controls");
  if (!(await page.getByText("Screenshots e demais evidências são gerados localmente").count())) throw new Error("Privacy storage disclosure does not accurately describe downloaded evidence");
  if (await page.locator('.qts-site-toolbar-nav a[href="#sobre"]').count()) throw new Error("Legal-page navigation still points to dead local anchors");
  await page.getByRole("button", { name: "Alterar idioma para EN" }).click();
  if (!(await page.getByRole("heading", { name: "What QA Toolbar Sandbox asks from your browser" }).count())) throw new Error("Privacy policy did not switch to English");

  await page.goto(`${origin}${basePath}propriedade-intelectual`, { waitUntil: "networkidle" });
  if (!(await page.getByRole("heading", { name: "Intellectual Property" }).count())) throw new Error("Intellectual-property route did not preserve the selected locale");
  if (!(await page.getByText("Software registration in preparation").count())) throw new Error("INPI page did not render the truthful backend registration status");
  if (await page.locator(".qts-third-party-item").count() !== 6) throw new Error("Third-party content is still presented as one unscannable text wall");
  await page.getByRole("button", { name: "Switch language to PT" }).click();
  if (!(await page.getByText("Registro de software em preparação").count())) throw new Error("INPI status did not switch back to Portuguese");

  await page.goto(`${origin}${basePath}rota-inexistente`, { waitUntil: "networkidle" });
  if (!(await page.getByRole("heading", { name: "Página não encontrada" }).count())) throw new Error("Landing unknown route did not render a conscious 404");
  if (!(await page.getByRole("link", { name: "Voltar ao início" }).count())) throw new Error("Landing 404 has no recovery action");

  await page.evaluate(() => localStorage.setItem("qts-landing-locale", "en"));
  await page.reload({ waitUntil: "networkidle" });
  if (!(await page.getByRole("heading", { name: "Page not found" }).count())) throw new Error("Landing 404 was not translated to English");

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${origin}${basePath}`, { waitUntil: "networkidle" });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (horizontalOverflow > 2) throw new Error(`Landing has horizontal overflow on mobile: ${horizontalOverflow}px`);
  // WCAG 1.4.10's 200% reflow target is equivalent to a 320 CSS-pixel viewport.
  await page.setViewportSize({ width: 320, height: 800 });
  const reflowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (reflowOverflow > 2) {
    const offenders = await page.evaluate(() => [...document.querySelectorAll("*")]
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 2)
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const parents = [];
        let parent = element.parentElement;
        while (parent && parents.length < 4) {
          const parentRect = parent.getBoundingClientRect();
          parents.push(`${parent.className || parent.tagName}[${Math.round(parentRect.left)},${Math.round(parentRect.right)}]`);
          parent = parent.parentElement;
        }
        return `${element.tagName}.${element.className}:[${Math.round(rect.left)},${Math.round(rect.right)}] <- ${parents.join("<-")}`;
      }));
    throw new Error(`Landing has horizontal overflow at the 200% reflow target: ${reflowOverflow}px; ${offenders.join(" | ")}`);
  }

  await smokeVoucherFeedbackAndResume(browser);

  await page.goto(`${origin}${basePath}admin/`, { waitUntil: "networkidle" });
  if (!(await page.title()).includes("Admin")) throw new Error("Admin artifact did not load.");
  const adminBrand = page.locator('img[src$="qa-toolbar-sandbox-logo.svg"]').first();
  if (!await adminBrand.count() || !await adminBrand.evaluate((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)) {
    throw new Error("Admin does not render the new color SVG logo.");
  }
  const adminBrandDark = page.locator('img[src$="qa-toolbar-sandbox-logo-dark.svg"]').first();
  if (!await adminBrandDark.count() || !await adminBrandDark.evaluate((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)) {
    throw new Error("Admin is missing the dark-scheme SVG logo variant.");
  }
  if (await page.locator('input[type="email"]').count() !== 0 || await page.locator('input[type="password"]').count() !== 1) {
    throw new Error("Admin founder/password login form did not render.");
  }
  if (!(await page.locator("body").innerText()).includes("Código por e-mail")) {
    throw new Error("Admin login does not explain the second OTP step.");
  }
  if (!(await page.locator("body").innerText()).includes("matteusbonotto+admin@gmail.com")) {
    throw new Error("Admin login does not pin the authorized founder account.");
  }
  if (consoleErrors.length) throw new Error(`Browser console errors: ${consoleErrors.join(" | ")} resources=${failedResources.join(" | ")}`);
  console.log("Browser smoke passed: backend pricing and embedded admin artifact.");
} finally {
  await browser?.close();
  preview.kill();
}
