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
  await page.locator(".qts-luck-cta .qts-btn").click();
  const wheelDialog = page.getByRole("dialog", { name: "Pronto para testar a sorte?" });
  await wheelDialog.waitFor();
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
  if ((await page.locator(".qts-site-toolbar-cta").innerText()).trim() !== "Create account and install") throw new Error("Logged-out install CTA is not transparent in English");
  if (!(await page.getByRole("navigation", { name: "Page navigation" }).count())) throw new Error("Navigation accessible name was not translated");
  await page.getByRole("button", { name: "Switch language to PT" }).click();

  const desktopWidth = await page.locator('[data-viewport="desktop"]').evaluate((element) => element.getBoundingClientRect().width);
  await page.locator(".qts-simulator-controls .qts-sim-field").nth(2).getByRole("radio", { name: "Mobile" }).click();
  const mobileFrame = page.locator('[data-viewport="mobile"]');
  await mobileFrame.waitFor();
  const mobileWidth = await mobileFrame.evaluate((element) => element.getBoundingClientRect().width);
  if (mobileWidth >= desktopWidth || mobileWidth > 410) {
    throw new Error(`Mobile simulator did not switch to a phone viewport. desktop=${desktopWidth} mobile=${mobileWidth}`);
  }

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

  await page.goto(`${origin}${basePath}admin/`, { waitUntil: "networkidle" });
  if (!(await page.title()).includes("Admin")) throw new Error("Admin artifact did not load.");
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
