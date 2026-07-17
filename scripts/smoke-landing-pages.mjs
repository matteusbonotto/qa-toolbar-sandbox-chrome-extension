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

  await page.goto(`${origin}${basePath}admin/`, { waitUntil: "networkidle" });
  if (!(await page.title()).includes("Admin")) throw new Error("Admin artifact did not load.");
  if (await page.locator('input[type="email"]').count() !== 1 || await page.locator('input[type="password"]').count() !== 1) {
    throw new Error("Admin email/password login form did not render.");
  }
  if (consoleErrors.length) throw new Error(`Browser console errors: ${consoleErrors.join(" | ")}`);
  console.log("Browser smoke passed: backend pricing and embedded admin artifact.");
} finally {
  await browser?.close();
  preview.kill();
}
