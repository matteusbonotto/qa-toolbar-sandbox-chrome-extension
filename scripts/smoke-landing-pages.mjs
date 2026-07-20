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
    body: JSON.stringify([{ chrome_web_store_version: "1.1.2", status: "live" }]),
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

  const desktopWidth = await page.locator('[data-viewport="desktop"]').evaluate((element) => element.getBoundingClientRect().width);
  await page.locator(".qts-simulator-controls .qts-sim-field").nth(2).getByRole("tab", { name: "Mobile" }).click();
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
  await accountDialog.locator(".qts-auth-close").click();
  await page.locator(".qts-plan-cta").first().click();
  await page.getByRole("dialog").waitFor();
  await page.locator(".qts-auth-close").click();

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
