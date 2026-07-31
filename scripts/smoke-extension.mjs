import { createHash, webcrypto } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");

// Mints an access-status token the same way supabase/functions/_shared/access_token.ts does, so
// the mocked route below produces something apps/extension/src/background/auth.js's
// verifyAccessToken() will actually accept - without this the whole suite would fail closed the
// moment the signature-verification fix landed (a plain, unsigned mock response is now correctly
// rejected, same as a forged one). The private key is read from the gitignored .env, never
// committed - see that file's own comment for how to (re)provision it.
async function readEnvValue(path, key) {
  if (!existsSync(path)) return undefined;
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.startsWith(`${key}=`)) continue;
    return trimmed.slice(key.length + 1);
  }
  return undefined;
}
const accessTokenPrivateKeyJwk = process.env.ACCESS_TOKEN_PRIVATE_KEY_JWK
  || await readEnvValue(resolve(root, ".env"), "ACCESS_TOKEN_PRIVATE_KEY_JWK");
if (!accessTokenPrivateKeyJwk) throw new Error("Missing ACCESS_TOKEN_PRIVATE_KEY_JWK in .env - required to mint a mock access-status token the extension will accept.");
const accessTokenSigningKey = await webcrypto.subtle.importKey("jwk", JSON.parse(accessTokenPrivateKeyJwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
function base64UrlEncode(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
async function signMockAccessToken(payload) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1_000) + 600 };
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(body)));
  const signature = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, accessTokenSigningKey, new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}
const extensionPathArgument = process.argv.find((argument) => argument.startsWith("--extension-path="))?.slice("--extension-path=".length);
const extensionPath = resolve(root, extensionPathArgument || "apps/extension");
const profilePath = resolve(root, "artifacts/chrome-smoke-profile");
const evidencePath = resolve(root, "artifacts/runtime-evidence");
async function fingerprintDirectory(directory, base = directory, hash = createHash("sha256")) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await fingerprintDirectory(path, base, hash);
    else {
      hash.update(path.slice(base.length).replaceAll("\\", "/"));
      hash.update(await readFile(path));
    }
  }
  return hash;
}
const sourceFingerprint = (await fingerprintDirectory(extensionPath)).digest("hex");
console.log(`[chrome-smoke] source fingerprint ${sourceFingerprint}`);
console.log(`[chrome-smoke] extension path ${extensionPath}`);
let lastTrace = "startup";
let smokeWatchdog;
const armSmokeWatchdog = () => {
  if (smokeWatchdog) clearTimeout(smokeWatchdog);
  smokeWatchdog = setTimeout(() => { throw new Error(`Chrome smoke stalled after: ${lastTrace}`); }, 180_000);
};
const trace = (label) => { lastTrace = label; console.log(`[chrome-smoke] ${label}`); armSmokeWatchdog(); };
const assertElementContrast = async (page, selector, minimum = 4.5) => {
  const result = await page.locator(selector).first().evaluate((element) => {
    const parse = (value) => {
      const values = (value.match(/[\d.]+/g) || []).map(Number);
      if (value.startsWith("color(srgb")) return [values[0] * 255, values[1] * 255, values[2] * 255, values[3] ?? 1];
      return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const composite = (foreground, background) => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      return [0, 1, 2].map((index) => (foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])) / alpha).concat(alpha);
    };
    const resolvedBackground = (node) => {
      const layers = [];
      for (let current = node; current; current = current.parentElement || current.getRootNode?.().host || null) layers.push(parse(getComputedStyle(current).backgroundColor));
      return layers.reverse().reduce((background, foreground) => composite(foreground, background), [255, 255, 255, 1]);
    };
    const luminance = (channels) => {
      channels = channels.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
      });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const style = getComputedStyle(element);
    const background = resolvedBackground(element);
    const foregroundLum = luminance(parse(style.color));
    const backgroundLum = luminance(background);
    return {
      foreground: style.color,
      background: background.slice(0, 3).map(Math.round).join(","),
      ratio: (Math.max(foregroundLum, backgroundLum) + .05) / (Math.min(foregroundLum, backgroundLum) + .05),
      text: element.textContent?.trim().slice(0, 100),
    };
  });
  if (result.ratio < minimum) throw new Error(`Insufficient contrast for ${selector}: ${JSON.stringify(result)}`);
  return result;
};
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
armSmokeWatchdog();
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
  if (name === "access-status") {
    const plan = { key: "release-manager", name: "Release Manager" };
    const features = { "characterCounter.enabled": true, "multiClick.enabled": true, "inputLab.enabled": true, "fakerFill.enabled": true, "macroStudio.enabled": true, "keyView.enabled": true, "elementCapture.enabled": true, "stepsRecorder.enabled": true };
    const token = await signMockAccessToken({ active: true, plan, features });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ active: true, plan, source: "manual", expiresAt: null, features, token, checkedAt: new Date().toISOString() }) });
  }
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

  let installDemoTabs = [];
  for (let attempt = 0; attempt < 40 && installDemoTabs.length === 0; attempt += 1) {
    await new Promise((resolveInstallTab) => setTimeout(resolveInstallTab, 100));
    installDemoTabs = context.pages().filter((page) => {
      try { return ["matteusbonotto.github.io"].includes(new URL(page.url()).hostname); } catch { return false; }
    });
  }
  installDemoTabs = context.pages().filter((page) => {
    try { return ["matteusbonotto.github.io"].includes(new URL(page.url()).hostname); } catch { return false; }
  });
  if (installDemoTabs.length !== 1) throw new Error(`Fresh install should open exactly one demo-site tab, found ${installDemoTabs.length}`);
  const installDemo = installDemoTabs[0];
  await installDemo.locator("#qts-toolbar-host").waitFor({ state: "attached" });
  if (!(await installDemo.locator("#bar.isLoggedOut").count())) throw new Error("Fresh-install toolbar did not render its logged-out state");
  if (!(await installDemo.locator("#loggedOutLoginButton").count())) throw new Error("Fresh-install toolbar has no login action");
  if (await installDemo.locator("#toolsButton:visible").count()) throw new Error("Protected Tools action remained visible while logged out");
  if (await installDemo.locator(".qts-tour-balloon").count()) throw new Error("Live tour started while the user was logged out");
  let loggedOutTourOptions = null;
  for (let attempt = 0; attempt < 150 && !loggedOutTourOptions; attempt += 1) {
    loggedOutTourOptions = context.pages().find((page) => page.url().startsWith(`chrome-extension://${extensionId}/src/options/options.html?tab=account`)) || null;
    if (!loggedOutTourOptions) await new Promise((resolveOptions) => setTimeout(resolveOptions, 100));
  }
  if (!loggedOutTourOptions) throw new Error("Logged-out tutorial request did not redirect to Minha conta");
  await loggedOutTourOptions.waitForLoadState("domcontentloaded");
  if (!(await loggedOutTourOptions.locator('.panel[data-panel="account"].isActive').count())) throw new Error("Logged-out tutorial redirect did not activate Minha conta");
  await loggedOutTourOptions.close();
  const optionsOpened = context.waitForEvent("page", (page) => page.url().startsWith(`chrome-extension://${extensionId}/src/options/options.html`));
  await installDemo.locator("#loggedOutLoginButton").click();
  const options = await optionsOpened;
  await options.waitForLoadState("domcontentloaded");
  if (new URL(options.url()).searchParams.get("tab") !== "account") throw new Error(`Logged-out login action did not target Minha conta: ${options.url()}`);
  if (!(await options.locator('.panel[data-panel="account"].isActive').count())) throw new Error("Minha conta panel was not active after clicking Entrar");
  if (await options.locator("html").getAttribute("data-theme") !== "light") throw new Error("Fresh workspace did not default to light appearance");
  if (await options.locator('[data-color-family="blue"]').getAttribute("aria-checked") !== "true") throw new Error("Fresh workspace did not default to the blue family");
  await installDemoTabs[0].close();
  trace("fresh-install logged-out toolbar and Minha conta login handoff verified");

  const host = await context.newPage();
  const hostErrors = [];
  host.on("console", (message) => { if (message.type() === "error") hostErrors.push(message.text()); });
  host.on("pageerror", (error) => hostErrors.push(error.message));
  await host.goto("http://127.0.0.1:43117/");
  await host.waitForTimeout(500);
  if (await host.locator("#qts-toolbar-host").count()) throw new Error("Toolbar mounted without authentication");

  const optionsErrors = [];
  options.on("console", (message) => { if (message.type() === "error") optionsErrors.push(message.text()); });
  options.on("pageerror", (error) => optionsErrors.push(error.message));
  // Account deep links add search/hash state. Authentication must still reach the service worker;
  // an exact sender.url comparison used to silently drop these messages and yield
  // "Could not establish connection. Receiving end does not exist."
  await options.goto(`chrome-extension://${extensionId}/src/options/options.html?tab=account#login`);
  await options.locator("#loginEmail").fill("tester@example.com");
  await options.locator("#loginPassword").fill("safe-test-password");
  await options.locator("#loginForm button[type=submit]").click();
  try {
    await options.locator('.protectedNav[data-tab="workspace"]:not(:disabled)').waitFor({ timeout: 15_000 });
  } catch (error) {
    const authMessage = await options.locator("#authMessage").textContent().catch(() => "");
    throw new Error(`Authentication did not unlock options: ${authMessage || "no auth message"}; options console: ${optionsErrors.join(" | ") || "none"}; worker console: ${workerErrors.join(" | ") || "none"}`, { cause: error });
  }
  trace("authenticated");

  // Regression test for the paywall-bypass vulnerability: forging {active:true,...} directly into
  // chrome.storage.local (exactly what a real user did via "Inspect service worker" -> console)
  // must NOT grant access anymore, because getAccessState() now only trusts active/plan/features
  // that come from a signature-verified token (see auth.js's verifyAccessToken/
  // readVerifiedCachedAccess). Network is deliberately broken for this check so there's no way the
  // extension could quietly "fix itself" via a real re-fetch and mask a regression here.
  await context.route("https://xhusvkylbouwtpcevgri.supabase.co/functions/v1/access-status", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "simulated_outage_for_forgery_test" }) }));
  // chrome.* is only reachable from an extension page (like this options tab) or a content
  // script's isolated world - not from a plain page's own evaluate() context, which is why this
  // runs on `options` rather than `host`.
  const forgeryResult = await options.evaluate(async () => {
    const stored = await chrome.storage.local.get("qtsAuthSessionV1");
    const session = stored.qtsAuthSessionV1;
    await chrome.storage.local.set({ qtsAuthSessionV1: { ...session, user: { ...session.user, id: "00000000-0000-4000-8000-000000000001" } } });
    await chrome.storage.local.set({ qtsAccessStatusV1: { active: true, authenticated: true, plan: { key: "forged", name: "Forged Plan" }, features: { macroStudio: true, stepsRecorder: true }, cachedAt: Date.now() + 1e15, checkedAt: new Date().toISOString() } });
    return chrome.runtime.sendMessage({ type: "qts:get-access-state", force: false });
  });
  if (forgeryResult?.active === true) throw new Error(`SECURITY REGRESSION: a forged, unsigned chrome.storage.local entry was trusted as active access: ${JSON.stringify(forgeryResult)}`);
  await context.unroute("https://xhusvkylbouwtpcevgri.supabase.co/functions/v1/access-status");
  const recoveredResult = await options.evaluate(async () => {
    const stored = await chrome.storage.local.get("qtsAuthSessionV1");
    const session = stored.qtsAuthSessionV1;
    await chrome.storage.local.set({ qtsAuthSessionV1: { ...session, user: { ...session.user, id: "00000000-0000-4000-8000-000000000014" } } });
    return chrome.runtime.sendMessage({ type: "qts:get-access-state", force: true });
  });
  if (recoveredResult?.active !== true) throw new Error(`Access did not recover after the simulated outage cleared: ${JSON.stringify(recoveredResult)}`);
  trace("forged local access-status is rejected; only a signature-verified token grants access");

  let firstAccessTourTabs = [];
  for (let attempt = 0; attempt < 50 && firstAccessTourTabs.length === 0; attempt += 1) {
    await new Promise((resolveTourTab) => setTimeout(resolveTourTab, 100));
    firstAccessTourTabs = context.pages().filter((page) => {
      try { return ["matteusbonotto.github.io"].includes(new URL(page.url()).hostname); } catch { return false; }
    });
  }
  if (firstAccessTourTabs.length !== 1) throw new Error(`First successful login should open exactly one demo-site tour tab, found ${firstAccessTourTabs.length}`);
  try {
    await firstAccessTourTabs[0].locator("#qts-toolbar-host").waitFor({ state: "attached", timeout: 15_000 });
  } catch (error) {
    const diagnostics = await worker.evaluate(async () => {
      const [registered, stored] = await Promise.all([
        chrome.scripting.getRegisteredContentScripts(),
        chrome.storage.local.get(["qtsWorkspaceV1", "qtsSiteScopeV1", "qtsAccessStatusV1"]),
      ]);
      return {
        registered: registered.map(({ id, matches }) => ({ id, matches })),
        bindings: stored.qtsWorkspaceV1?.urlBindings,
        scope: stored.qtsSiteScopeV1,
        access: stored.qtsAccessStatusV1,
      };
    }).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
    throw new Error(`Demo site opened after login without the toolbar. URL=${firstAccessTourTabs[0].url()} diagnostics=${JSON.stringify(diagnostics)} worker=${workerErrors.join(" | ") || "none"}`, { cause: error });
  }
  trace("first-login demo toolbar injection verified");
  await firstAccessTourTabs[0].close();
  trace("first-login onboarding opens exactly one tour tab");
  // The onboarding assertion above intentionally seeds the demo workspace. Reset only this
  // isolated smoke profile so the remaining workspace CRUD checks start from their own fixture.
  await options.evaluate(async () => window.QTS_STORAGE.saveWorkspace(window.QTS_STORAGE.normalizeWorkspace({})));
  await options.locator('#langSwitch [data-locale="en"]').click();
  await options.getByRole("button", { name: "My account" }).waitFor();
  if (await options.locator("html").getAttribute("lang") !== "en") throw new Error("Options locale did not switch to English");
  if (!(await options.locator("label:has(#clientName)").innerText()).startsWith("Client name")) throw new Error("Options field labels were not translated to English");
  if (await options.locator("#keyViewEnabled").count()) throw new Error("Duplicated Key View settings card should live only in its sidebar");
  await options.locator('#langSwitch [data-locale="es"]').click();
  await options.getByRole("button", { name: "Mi cuenta" }).waitFor();
  if (await options.locator("#environmentName").getAttribute("placeholder") !== "Nombre del entorno (ej.: QA, Staging)") throw new Error("Options placeholders were not translated to Spanish");
  if (await options.locator("#keyViewEnabled").count()) throw new Error("Duplicated Key View settings card returned after locale change");
  await options.locator('#langSwitch [data-locale="pt-BR"]').evaluate((button) => button.click());
  await options.waitForFunction(() => document.documentElement.lang === "pt-BR");
  await options.getByRole("button", { name: "Minha conta" }).click();
  await options.locator("#signedInState").waitFor({ state: "visible" });
  await options.screenshot({ path: resolve(evidencePath, "extension-authenticated-account.png"), fullPage: true });

  // Theme is a platform preference, not a decorative preview: verify the real semantic surfaces,
  // storage persistence, and reload behavior before exercising the remaining settings screens.
  await options.locator('.protectedNav[data-tab="general"]').click();
  await options.locator('[data-theme-choice="light"]').click();
  await options.waitForFunction(() => document.documentElement.dataset.theme === "light");
  const storedLightTheme = await options.evaluate(async () => (await chrome.storage.local.get("qtsWorkspaceV1")).qtsWorkspaceV1?.preferences?.appearanceTheme);
  if (storedLightTheme !== "light") throw new Error(`Light theme was not persisted: ${storedLightTheme}`);
  await assertElementContrast(options, "main h2");
  await assertElementContrast(options, ".navItem.isActive");
  await assertElementContrast(options, ".panel.isActive fieldset legend");
  await options.screenshot({ path: resolve(evidencePath, "extension-options-theme-light.png"), fullPage: true });
  await options.reload();
  await options.locator("#signedInState").waitFor({ state: "visible" });
  if (await options.locator("html").getAttribute("data-theme") !== "light") throw new Error("Light theme did not survive options reload");
  if (await options.locator('[data-theme-choice="light"]').getAttribute("aria-checked") !== "true") throw new Error("Light theme toggle did not restore its selected state");
  await options.locator('.protectedNav[data-tab="general"]').click();
  await options.locator('[data-theme-choice="dark"]').click();
  await options.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await assertElementContrast(options, "main h2");
  await assertElementContrast(options, ".navItem.isActive");
  await assertElementContrast(options, ".panel.isActive fieldset legend");
  await options.screenshot({ path: resolve(evidencePath, "extension-options-theme-dark.png"), fullPage: true });
  await options.reload();
  await options.locator("#signedInState").waitFor({ state: "visible" });
  if (await options.locator("html").getAttribute("data-theme") !== "dark") throw new Error("Dark theme did not survive options reload");
  const mobilePreviewBounds = await options.evaluate(() => {
    const results = [];
    for (const id of ["mobileDrawerPositionPreview", "mobileToolbarPositionPreview"]) {
      const preview = document.getElementById(id);
      const browser = preview.querySelector(".previewBrowser");
      const dock = preview.querySelector(".previewDock");
      const browserBox = browser.getBBox();
      for (const position of ["top", "bottom", "left", "right"]) {
        preview.dataset.position = position;
        const dockBox = dock.getBBox();
        results.push({
          id,
          position,
          inside: dockBox.x >= browserBox.x
            && dockBox.y >= browserBox.y
            && dockBox.x + dockBox.width <= browserBox.x + browserBox.width
            && dockBox.y + dockBox.height <= browserBox.y + browserBox.height,
        });
      }
    }
    return results;
  });
  if (mobilePreviewBounds.some(({ inside }) => !inside)) throw new Error(`Mobile position preview overflowed its phone frame: ${JSON.stringify(mobilePreviewBounds)}`);
  trace("options light/dark theme persistence and contrast verified");

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
  await options.locator('[data-tree-create="project"]').click();
  await options.locator("#projectClient").selectOption({ label: "Cliente Demo" });
  await options.locator("#projectName").fill("Webapp Demo");
  await options.locator("#projectAbbreviation").fill("WEB");
  await options.locator("#projectForm button[type=submit]").click();
  await options.locator('[data-tree-create="product"]').click();
  await options.locator("#productProject").selectOption({ label: "Webapp Demo" });
  await options.locator("#productName").fill("Checkout");
  await options.locator("#productAbbreviation").fill("CHK");
  await options.locator("#productForm button[type=submit]").click();
  await options.locator('[data-workspace-nav="urls"]').click();
  await options.locator('.composerTrigger[data-open-composer="environmentComposer"]').click();
  await options.locator("#environmentName").fill("QA");
  await options.locator("#environmentColor").fill("#5b21b6");
  await options.locator("#environmentForm button[type=submit]").click();
  await options.locator('[data-workspace-nav="urls"]').click();
  await options.locator('[data-add-url-for-environment]').first().click();
  await options.locator('[data-url-product]', { hasText: "Checkout" }).click();
  await options.locator("#urlPatternInput").fill("http://127.0.0.1:43117/*");
  await options.locator("#urlRelationForm button[type=submit]").click();
  await options.waitForTimeout(600);
  trace("primary workspace created");

  // Environments are reusable tiers (no product of their own); the product association — and one
  // pattern belonging to multiple environments — lives entirely on the URL binding.
  await options.locator('[data-workspace-nav="urls"]').click();
  await options.locator('.composerTrigger[data-open-composer="environmentComposer"]').click();
  await options.locator("#environmentName").fill("Beta");
  await options.locator("#environmentColor").fill("#0f766e");
  await options.locator("#environmentForm button[type=submit]").click();
  await options.locator('[data-workspace-nav="urls"]').click();
  await options.locator('[data-add-url-for-environment]').last().click();
  await options.locator('[data-url-product]', { hasText: "Checkout" }).click();
  await options.locator("#urlPatternInput").fill("http://beta.example.invalid/*");
  await options.locator("#urlRelationForm button[type=submit]").click();
  await options.locator('[data-add-url-for-environment]').first().click();
  await options.locator('[data-url-product]', { hasText: "Checkout" }).click();
  await options.locator("#urlPatternInput").fill("https://shared.example.com/*");
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
  // once under EACH. The environment is already conveyed by the parent accordion, so each URL row
  // must not repeat those same badges.
  const sharedBindingRows = options.locator('#urlRelationList .listRow').filter({ hasText: "https://shared.example.com/*" });
  if (await sharedBindingRows.count() !== 2) throw new Error("Shared URL binding did not render once per linked environment accordion");
  if (await sharedBindingRows.first().locator(".relationBadge").count()) throw new Error("URL row repeated context already shown by its environment and product parents");
  await options.screenshot({ path: resolve(evidencePath, "extension-options-environments-urls-deduplicated.png"), fullPage: true });
  await options.locator('[data-workspace-nav="structure"]').click();
  if (await options.locator(".structureExplorer").count() !== 1) throw new Error("Workspace structure is missing the hierarchical explorer");
  const workspaceNavigationFits = await options.locator(".workspaceTabs").evaluate((navigation) => navigation.scrollWidth <= navigation.clientWidth + 1);
  if (!workspaceNavigationFits) throw new Error("Workspace navigation introduced horizontal overflow");
  const hierarchyAccordions = options.locator(".structureExplorer .relationshipNode");
  if (await hierarchyAccordions.count() !== 3) throw new Error("Workspace hierarchy must expose the actual client, project and product entities");
  const structureViewButtons = options.locator("[data-structure-view]");
  if (await structureViewButtons.count() !== 3) throw new Error("Workspace hierarchy view filters are incomplete");
  await options.locator('[data-structure-view="project"]').click();
  if (await options.locator(".structureExplorer").getAttribute("data-structure-view-mode") !== "project") throw new Error("Project-focused workspace view did not activate");
  if (await options.locator("#projectList .listRow").count() !== 1) throw new Error("Project-focused workspace view did not render projects independently");
  await options.locator('[data-structure-view="product"]').click();
  if (await options.locator(".structureExplorer").getAttribute("data-structure-view-mode") !== "product") throw new Error("Product-focused workspace view did not activate");
  if (!await options.locator("#productList .listRow").first().innerText().then((text) => text.includes("Cliente Demo") && text.includes("Webapp Demo"))) throw new Error("Product-focused workspace view is missing its client and project context");
  await options.locator('[data-structure-view="client"]').click();
  if (await options.locator(".structureExplorer").getAttribute("data-structure-view-mode") !== "client") throw new Error("Client-focused workspace view did not restore the hierarchy");
  const productAccordion = options.locator('.relationshipNode[data-entity-collection="products"]').first();
  await productAccordion.locator(":scope > summary").click();
  if (await productAccordion.getAttribute("open") !== null) throw new Error("Product hierarchy accordion did not collapse");
  await productAccordion.locator(":scope > summary").click();
  if (await productAccordion.getAttribute("open") === null) throw new Error("Product hierarchy accordion did not expand");
  await options.screenshot({ path: resolve(evidencePath, "extension-options-workspace-studio.png"), fullPage: true });
  await options.setViewportSize({ width: 390, height: 844 });
  const mobileWorkspaceLayout = await options.locator(".workspacePanel").evaluate((panel) => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    panelWidth: Math.round(panel.getBoundingClientRect().width),
    hierarchyLevels: panel.querySelectorAll(".structureExplorer .relationshipNode").length,
  }));
  if (
    mobileWorkspaceLayout.documentWidth > mobileWorkspaceLayout.viewportWidth + 1
    || mobileWorkspaceLayout.panelWidth > mobileWorkspaceLayout.viewportWidth
    || mobileWorkspaceLayout.hierarchyLevels !== 3
  ) {
    throw new Error(`Workspace mobile hierarchy overflowed or lost context: ${JSON.stringify(mobileWorkspaceLayout)}`);
  }
  await options.screenshot({ path: resolve(evidencePath, "extension-options-workspace-studio-mobile.png"), fullPage: true });
  await options.setViewportSize({ width: 1440, height: 960 });
  await options.locator('[data-workspace-nav="urls"]').click();
  const environmentCountBeforePreviews = Number(await options.locator("#environmentCount").textContent());
  await options.evaluate(async () => {
    const next = await window.QTS_STORAGE.getWorkspace();
    for (let index = 0; index < 3; index += 1) next.environments.push({ id: `env_picker_${index}`, name: `Preview ${index + 1}`, color: "#5b21b6", active: true });
    await window.QTS_STORAGE.saveWorkspace(next);
  });
  await options.waitForFunction((expected) => Number(document.querySelector("#environmentCount")?.textContent) === expected, environmentCountBeforePreviews + 3);
  await options.locator('[data-add-url-for-environment]').first().click();
  await options.locator("#urlEnvironmentPicker .environmentMultiSelect > summary").click();
  await options.locator("[data-environment-search]").waitFor();
  if (await options.locator("[data-url-environment]").count()) throw new Error("URL environment picker did not switch to searchable multiselect above four environments");
  await options.locator("[data-environment-search]").fill("Beta");
  if (await options.locator('.multiSelectOptions [data-environment-option]:not([hidden])').count() !== 1) throw new Error("URL environment multiselect search did not filter environments");
  const productPickerLabels = await options.locator("#urlProductPicker [data-url-product]").evaluateAll((buttons) => buttons.map((button) => ({
    text: button.textContent.trim(),
    avatarCount: button.querySelectorAll(".qts-badge-avatar").length,
    labelWidth: Math.round(button.querySelector(".environmentToggleLabel")?.getBoundingClientRect().width || 0),
  })));
  if (!productPickerLabels.length || productPickerLabels.some(({ text, avatarCount, labelWidth }) => !text || avatarCount !== 1 || labelWidth < 12)) {
    throw new Error(`URL product picker lost product names or avatars: ${JSON.stringify(productPickerLabels)}`);
  }
  await options.locator("#urlRelationComposer [data-close-composer]").click();
  const urlTreeEntityIdentities = await options.locator('#urlRelationList [data-tree-dimension="client"] > summary .urlTreeIdentity, #urlRelationList [data-tree-dimension="project"] > summary .urlTreeIdentity, #urlRelationList [data-tree-dimension="product"] > summary .urlTreeIdentity').evaluateAll((identities) => identities.map((identity) => ({
    text: identity.textContent.trim(),
    avatarCount: identity.querySelectorAll(".qts-badge-avatar").length,
  })));
  if (!urlTreeEntityIdentities.length || urlTreeEntityIdentities.some(({ text, avatarCount }) => !text || avatarCount !== 1)) {
    throw new Error(`URL hierarchy lost client, project or product identity: ${JSON.stringify(urlTreeEntityIdentities)}`);
  }
  trace("workspace relationships verified");

  // Exercise the popup with a controlled host-tab URL. In production the same sourceUrl variable
  // comes from chrome.tabs.query(active/currentWindow); the explicit parameter keeps this flow
  // deterministic because Playwright does not expose Chrome's native action popup as a Page.
  await host.goto("http://127.0.0.1:43117/popup-target?token=remove-me#section");
  await host.bringToFront();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html?sourceUrl=${encodeURIComponent(host.url())}`);
  await popup.locator("#urlForm").waitFor({ state: "visible" });
  if (await popup.locator("#activeUrl").inputValue() !== "http://127.0.0.1:43117/popup-target?token=remove-me#section") throw new Error("Extension popup did not capture the active tab URL");
  if (await popup.locator("#sensitiveWarning").isHidden()) throw new Error("Extension popup did not warn about query/hash data");
  await popup.locator("#client").selectOption({ index: 1 });
  await popup.locator("#project").selectOption({ index: 1 });
  await popup.locator("#product").selectOption({ index: 1 });
  await popup.locator('input[name="environment"]').first().check();
  const previewPattern = await popup.locator("#patternPreview").textContent();
  if (previewPattern.includes("token=") || previewPattern.includes("#section")) throw new Error(`Popup persisted sensitive URL data silently: ${previewPattern}`);
  await popup.locator("#save").click();
  await popup.getByText("URL salva.").waitFor();
  const popupBinding = await options.evaluate(async () => {
    const stored = await chrome.storage.local.get("qtsWorkspaceV1");
    return stored.qtsWorkspaceV1?.urlBindings?.find((binding) => binding.patterns?.some((pattern) => pattern.includes("/popup-target")));
  });
  if (!popupBinding?.patterns?.length) throw new Error("Popup URL was not saved in the official workspace binding collection");
  await popup.close();
  await host.waitForLoadState("domcontentloaded");
  await host.locator("#qts-toolbar-host").waitFor({ state: "attached" });
  trace("active-tab URL popup, sensitive-data warning and immediate toolbar recognition verified");

  // Deletion now goes through a themed <dialog> instead of window.confirm() — verify both the
  // Cancelar (no-op) and Excluir (removes) paths against one of the injected preview environments.
  await options.locator('[data-workspace-nav="urls"]').click();
  const previewRow = options.locator('#urlRelationList [data-tree-dimension="environment"][data-tree-entity-id="env_picker_0"]');
  if (await previewRow.locator(".relationshipType, .urlTreeIdentity").count()) throw new Error("URL environment accordion repeats its type or name outside the toolbar preview");
  await previewRow.locator('[data-action="remove"]').click();
  await options.locator("#deleteConfirmDialog[open]").waitFor();
  await options.locator("#deleteConfirmCancel").click();
  if (await options.locator("#deleteConfirmDialog[open]").count()) throw new Error("Delete confirmation dialog did not close on Cancelar");
  if (!(await previewRow.count())) throw new Error("Cancelar incorrectly deleted the item");
  const environmentCountBeforeDelete = Number(await options.locator("#environmentCount").textContent());
  await previewRow.locator('[data-action="remove"]').click();
  await options.locator("#deleteConfirmDialog[open]").waitFor();
  await options.locator("#deleteConfirmAccept").click();
  await options.waitForFunction((expected) => Number(document.querySelector("#environmentCount")?.textContent) === expected, environmentCountBeforeDelete - 1);
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
  const verifyToolbarTheme = async (theme) => {
    await host.waitForFunction((expected) => document.querySelector("#qts-toolbar-host")?.dataset.theme === expected, theme);
    await assertElementContrast(host, "#toolsButton");
    await host.locator("#toolsButton").click();
    await host.locator("#toolsMenu.isOpen").waitFor();
    await assertElementContrast(host, "#inputLabMenuItem");
    await host.locator("#inputLabMenuItem").click();
    await host.locator(".qts-drawer").waitFor();
    await assertElementContrast(host, ".qts-drawer-head h2");
    await host.screenshot({ path: resolve(evidencePath, `extension-toolbar-drawer-theme-${theme}.png`), fullPage: false });
    await host.locator("#drawerClose").click();
  };
  await verifyToolbarTheme("dark");
  await options.locator('.protectedNav[data-tab="general"]').click();
  await options.locator('.settingsAccordion:has([data-theme-choice="light"])').evaluate((accordion) => { accordion.open = true; });
  await options.locator('[data-theme-choice="light"]').click();
  await verifyToolbarTheme("light");
  await options.locator('.protectedNav[data-tab="general"]').click();
  await options.locator('.settingsAccordion:has([data-theme-choice="dark"])').evaluate((accordion) => { accordion.open = true; });
  await options.locator('[data-theme-choice="dark"]').click();
  await host.waitForFunction(() => document.querySelector("#qts-toolbar-host")?.dataset.theme === "dark");
  trace("toolbar menu/drawer light/dark contrast verified");

  // Eleven color families follow the independently selected light/dark appearance mode. Picking one writes CSS custom properties on
  // <html> (not the shadow host) so both the shadow-DOM toolbar/drawers/toasts and the light-DOM
  // Key View/mouse overlays -- which live directly in document.body -- read the same tokens.
  if (await options.locator("#colorThemeGrid .colorThemeSwatch").count() !== 11) throw new Error("Color theme grid does not expose the eleven supported families");
  await options.locator('[data-color-family="black"]').click();
  await host.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--qts-ui-primary").trim() === "#262626");
  await options.locator('[data-color-family="gray"]').click();
  await host.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--qts-ui-primary").trim() === "#94a3b8");
  await options.locator('[data-color-family="blue"]').click();
  await host.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--qts-ui-primary").trim() === "#3b82f6");
  await host.waitForFunction(() => document.querySelector("#qts-toolbar-host")?.dataset.theme === "dark");
  // The Settings page is the extension's own chrome.runtime page (not a content script), so it has
  // its own separate --accent token that needs the same preset applied to it directly -- otherwise
  // Settings keeps the fixed purple regardless of what the user picked (screenshotted as evidence
  // since it's easy for this specific surface to silently drift back out of sync with the rest).
  const optionsAccent = await options.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  if (optionsAccent !== "#3b82f6") throw new Error(`Settings page --accent did not follow the selected color theme: ${optionsAccent}`);
  await options.locator('.navItem[data-tab="workspace"]').click();
  const workspaceSearch = options.locator("#workspaceSearch");
  await workspaceSearch.evaluate((input) => {
    window.__qtsWorkspaceSearchLog = [];
    for (const type of ["focus", "input", "change", "search", "blur", "keydown", "keyup"]) {
      input.addEventListener(type, (event) => window.__qtsWorkspaceSearchLog.push({
        type,
        key: event.key || "",
        value: input.value,
        active: document.activeElement?.id || document.activeElement?.tagName || "",
        at: performance.now(),
      }), true);
    }
  });
  await workspaceSearch.focus();
  await workspaceSearch.pressSequentially("Sandbox", { delay: 35 });
  await options.waitForTimeout(250);
  const workspaceSearchState = await workspaceSearch.evaluate((input) => ({
    value: input.value,
    focused: document.activeElement === input,
    caret: input.selectionStart,
  }));
  if (workspaceSearchState.value !== "Sandbox" || !workspaceSearchState.focused || workspaceSearchState.caret !== 7) {
    const workspaceSearchLog = await options.evaluate(() => window.__qtsWorkspaceSearchLog);
    throw new Error(`Workspace search interrupted typing or lost focus: ${JSON.stringify(workspaceSearchState)} events=${JSON.stringify(workspaceSearchLog)}`);
  }
  await workspaceSearch.fill("");
  await options.locator('.navItem[data-tab="general"]').click();
  await options.screenshot({ path: resolve(evidencePath, "extension-theme-options-page.png"), fullPage: false });
  await host.locator("#toolsButton").click();
  await host.locator("#toolsMenu.isOpen").waitFor();
  await host.screenshot({ path: resolve(evidencePath, "extension-theme-tools-menu.png"), fullPage: false });
  const toolRowWidths = await host.locator("#toolsMenu > button").evaluateAll((buttons) => buttons
    .filter((button) => getComputedStyle(button).display !== "none" && button.getBoundingClientRect().width > 0)
    .slice(0, 8)
    .map((button) => button.getBoundingClientRect().width));
  if (!toolRowWidths.length || Math.max(...toolRowWidths) - Math.min(...toolRowWidths) > 1) {
    throw new Error(`Tools menu rows do not share a uniform width: ${toolRowWidths.join(",")}`);
  }
  await host.locator("#toolsButton").click();
  await host.locator("#qts-toolbar-host").evaluate((element) => { element.dataset.toolbarPosition = "left"; });
  const verticalAlignment = await host.locator("#qts-toolbar-host").evaluate((element) => {
    const shadow = element.shadowRoot;
    const bar = shadow.querySelector("#bar").getBoundingClientRect();
    const buttons = [...shadow.querySelectorAll("#right > button:not(.isHidden), #right > div > button:not(.isHidden)")]
      .filter((button) => getComputedStyle(button).display !== "none" && button.getBoundingClientRect().width > 0)
      .map((button) => ({ id: button.id, center: button.getBoundingClientRect().left + button.getBoundingClientRect().width / 2 }));
    return { center: bar.left + bar.width / 2, buttons };
  });
  for (const button of verticalAlignment.buttons) {
    if (Math.abs(button.center - verticalAlignment.center) > 1.5) throw new Error(`Vertical toolbar button is not centered: ${button.id}`);
  }
  await host.locator("#urlToggleButton").click();
  await host.locator("#verticalUrlPanel:not(.isHidden)").waitFor();
  if (await host.locator("#verticalUrlText").textContent() !== await host.locator("#currentUrl").textContent()) throw new Error("Expanded globe URL does not match the toolbar's sanitized active URL");
  if (await host.locator("#urlToggleButton").getAttribute("aria-expanded") !== "true") throw new Error("Globe URL button did not expose its expanded state");
  await host.locator("#urlToggleButton").click();
  await host.locator("#qts-toolbar-host").evaluate((element) => { element.dataset.toolbarPosition = "top"; });
  await host.locator("#toolsButton").click();
  await host.locator("#inputLabMenuItem").click();
  await host.locator(".qts-drawer").waitFor();
  for (const control of ["#drawerSearch", "#drawerPosition", "#drawerPin", "#drawerMinimize", "#drawerClose"]) {
    if (!(await host.locator(control).count())) throw new Error(`Shared sidebar control is missing: ${control}`);
  }
  const drawerSearch = host.locator("#drawerSearch");
  await drawerSearch.focus();
  await drawerSearch.pressSequentially("input", { delay: 35 });
  const drawerSearchState = await host.locator("#qts-toolbar-host").evaluate((element) => {
    const input = element.shadowRoot.querySelector("#drawerSearch");
    return { value: input.value, focused: element.shadowRoot.activeElement === input, caret: input.selectionStart };
  });
  if (drawerSearchState.value !== "input" || !drawerSearchState.focused || drawerSearchState.caret !== 5) {
    throw new Error(`Shared sidebar search interrupted typing or lost focus: ${JSON.stringify(drawerSearchState)}`);
  }
  await drawerSearch.fill("");
  if (!(await host.locator("#drawerDetach").count())) throw new Error("Sidebar is missing the open-in-new-window action");
  const finalDrawerControlIds = await host.locator(".qts-drawer-controls > button").evaluateAll((buttons) => buttons.slice(-2).map((button) => button.id));
  if (finalDrawerControlIds.join(",") !== "drawerDetach,drawerClose") throw new Error(`Maximize and close controls are not adjacent at the end of the sidebar header: ${finalDrawerControlIds}`);
  // The position <select> became a 4-button icon picker (right/left/top/bottom) - verify all four
  // render with a real, clickable size instead of the old single-select text-clipping check.
  const positionButtonSizes = await host.locator("#drawerPosition .qts-drawer-position-btn").evaluateAll(
    (buttons) => buttons.map((button) => button.getBoundingClientRect()),
  );
  if (positionButtonSizes.length !== 4 || positionButtonSizes.some((rect) => rect.width < 14 || rect.height < 14)) {
    throw new Error(`Sidebar position picker buttons are missing or too small: ${JSON.stringify(positionButtonSizes)}`);
  }
  const detachedPagePromise = context.waitForEvent("page");
  await host.locator("#drawerDetach").click();
  const detachedPage = await detachedPagePromise;
  await detachedPage.locator("#qts-toolbar-host").waitFor({ state: "attached" });
  await detachedPage.locator(".qts-drawer-backdrop.isDetached .qts-drawer").waitFor();
  await detachedPage.setViewportSize({ width: 360, height: 540 });
  const detachedChrome = await detachedPage.locator("#qts-toolbar-host").evaluate((element) => {
    const shadow = element.shadowRoot;
    const backdrop = shadow.querySelector(".qts-drawer-backdrop.isDetached");
    const drawer = backdrop?.querySelector(".qts-drawer");
    const body = backdrop?.querySelector(".qts-drawer-body");
    const rect = drawer?.getBoundingClientRect();
    return {
      barHidden: getComputedStyle(shadow.querySelector("#bar")).display === "none",
      view: shadow.querySelector("#drawerHost")?.dataset.view,
      viewport: { width: innerWidth, height: innerHeight },
      drawer: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      bodyOverflow: body ? body.scrollWidth - body.clientWidth : null,
    };
  });
  if (!detachedChrome.barHidden || detachedChrome.view !== "inputLab") throw new Error(`Detached tool window did not isolate the requested panel: ${JSON.stringify(detachedChrome)}`);
  if (!detachedChrome.drawer
      || Math.abs(detachedChrome.drawer.left) > 1
      || Math.abs(detachedChrome.drawer.top) > 1
      || Math.abs(detachedChrome.drawer.width - detachedChrome.viewport.width) > 1
      || Math.abs(detachedChrome.drawer.height - detachedChrome.viewport.height) > 1
      || detachedChrome.bodyOverflow > 1) {
    throw new Error(`Detached sidebar is not responsive to its own viewport: ${JSON.stringify(detachedChrome)}`);
  }
  const detachedClosePromise = detachedPage.waitForEvent("close");
  await detachedPage.locator("#drawerClose").evaluate((button) => button.click());
  await detachedClosePromise;

  // Modal tools use the same detached-window shell, but historically retained their centered
  // modal padding/size and overflowed a narrow popup. Verify both variants and the real red close
  // action instead of closing the Playwright page directly.
  await host.locator("#drawerClose").click();
  await host.locator("#toolsButton").click();
  await host.locator("#macroStudioMenuItem").click();
  await host.locator(".qts-drawer-backdrop.isModal .qts-drawer").waitFor();
  const detachedModalPromise = context.waitForEvent("page");
  await host.locator("#drawerDetach").click();
  const detachedModalPage = await detachedModalPromise;
  await detachedModalPage.locator(".qts-drawer-backdrop.isDetached.isModal .qts-drawer").waitFor();
  await detachedModalPage.setViewportSize({ width: 360, height: 540 });
  const detachedModalLayout = await detachedModalPage.locator("#qts-toolbar-host").evaluate((element) => {
    const shadow = element.shadowRoot;
    const drawer = shadow.querySelector(".qts-drawer-backdrop.isDetached.isModal .qts-drawer");
    const body = drawer?.querySelector(".qts-drawer-body");
    const rect = drawer?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      drawer: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      bodyOverflow: body ? body.scrollWidth - body.clientWidth : null,
    };
  });
  if (!detachedModalLayout.drawer
      || Math.abs(detachedModalLayout.drawer.left) > 1
      || Math.abs(detachedModalLayout.drawer.top) > 1
      || Math.abs(detachedModalLayout.drawer.width - detachedModalLayout.viewport.width) > 1
      || Math.abs(detachedModalLayout.drawer.height - detachedModalLayout.viewport.height) > 1
      || detachedModalLayout.bodyOverflow > 1) {
    throw new Error(`Detached modal is not responsive to its own viewport: ${JSON.stringify(detachedModalLayout)}`);
  }
  const detachedModalClosePromise = detachedModalPage.waitForEvent("close");
  await detachedModalPage.locator("#drawerClose").evaluate((button) => button.click());
  await detachedModalClosePromise;
  await host.locator("#drawerClose").click();
  await host.locator("#toolsButton").click();
  await host.locator("#inputLabMenuItem").click();
  await host.locator(".qts-drawer").waitFor();
  await host.locator('#drawerPosition .qts-drawer-position-btn[data-position="left"]').click();
  if (await host.locator("#drawerBackdrop").getAttribute("data-position") !== "left") throw new Error("Sidebar did not move to the left");
  await host.locator("#drawerPin").click();
  if (await host.locator("#drawerPin").getAttribute("aria-pressed") !== "true") throw new Error("Sidebar pin did not activate");
  await host.locator("#drawerMinimize").click();
  if (await host.locator(".qts-drawer").count()) throw new Error("Minimized sidebar remained visible");
  if (!(await host.locator("#minimizedDrawerButton.isActive").count())) throw new Error("Minimized sidebar did not create a highlighted toolbar shortcut");
  await host.locator("#minimizedDrawerButton").click();
  await host.locator(".qts-drawer").waitFor();
  const drawerCloseBg = await host.locator("#drawerClose").evaluate((node) => getComputedStyle(node).backgroundColor);
  if (drawerCloseBg !== "rgb(199, 14, 14)") throw new Error(`Drawer close button is not the allowed red exception: ${drawerCloseBg}`);
  await host.locator("#drawerClose").click();
  await host.locator("#toolsButton").click();
  await host.locator("#inspectorsMenuItem").click();
  await host.locator(".qts-drawer").waitFor();
  const allInspectorsTab = host.locator('[data-inspector-scope="all"]');
  if (await allInspectorsTab.count()) await allInspectorsTab.click();
  const inspectorsSearch = host.locator("#inspectorsSearch");
  await inspectorsSearch.focus();
  await inspectorsSearch.pressSequentially("checkout", { delay: 35 });
  await host.evaluate(() => {
    document.dispatchEvent(new CustomEvent("qts:network-captured", {
      detail: {
        id: "focus-regression-entry",
        url: `${location.origin}/api/checkout`,
        method: "GET",
        status: 200,
        source: "fetch",
        capturedAt: Date.now(),
        payload: { ok: true },
      },
    }));
  });
  await host.waitForTimeout(100);
  const inspectorsTypingState = await host.locator("#qts-toolbar-host").evaluate((element) => {
    const shadow = element.shadowRoot;
    const input = shadow.querySelector("#inspectorsSearch");
    return {
      value: input?.value,
      focused: shadow.activeElement === input,
      caret: input?.selectionStart,
      view: shadow.querySelector("#drawerHost")?.dataset.view,
      hasBack: shadow.querySelector("#drawerHost")?.dataset.drawerHasBack,
    };
  });
  if (inspectorsTypingState.value !== "checkout"
      || !inspectorsTypingState.focused
      || inspectorsTypingState.caret !== 8
      || inspectorsTypingState.view !== "inspectors"
      || inspectorsTypingState.hasBack !== "false") {
    throw new Error(`Inspector live refresh interrupted search or changed the open sidebar: ${JSON.stringify(inspectorsTypingState)}`);
  }
  await inspectorsSearch.blur();
  await host.locator('[data-id="focus-regression-entry"]').waitFor();
  if (!(await host.locator("#inspectorsExportHistory").isEnabled()) || !(await host.locator("#inspectorsClearHistory").isEnabled())) {
    throw new Error("Endpoint Observer history actions did not activate after a captured request.");
  }
  await host.locator('[data-id="focus-regression-entry"]').click();
  await host.locator("#drawerBack").waitFor();
  await host.evaluate(() => {
    document.dispatchEvent(new CustomEvent("qts:network-captured", {
      detail: {
        id: "detail-regression-entry",
        url: `${location.origin}/api/checkout/refresh`,
        method: "GET",
        status: 200,
        source: "fetch",
        capturedAt: Date.now(),
        payload: { refreshed: true },
      },
    }));
  });
  if (!(await host.locator("#drawerBack").count()) || await host.locator("#drawerHost").getAttribute("data-drawer-has-back") !== "true") {
    throw new Error("Inspector live refresh returned an open detail sidebar to its list.");
  }
  await host.locator("#drawerClose").click();
  await host.locator("#toolsButton").click();
  await host.locator("#keyViewMenuItem").click();
  const switchLayout = await host.locator(".qts-switch-row").first().evaluate((row) => {
    const input = row.querySelector('input[type="checkbox"]');
    const toggle = input.getBoundingClientRect();
    const copy = row.querySelector("span").getBoundingClientRect();
    const knob = getComputedStyle(input, "::after");
    return {
      toggleRight: toggle.right, copyLeft: copy.left, copyWidth: copy.width,
      rowWidth: row.getBoundingClientRect().width, toggleWidth: toggle.width,
      toggleHeight: toggle.height, knobWidth: parseFloat(knob.width), knobHeight: parseFloat(knob.height),
      borderRadius: getComputedStyle(input).borderRadius,
    };
  });
  if (
    switchLayout.toggleRight > switchLayout.copyLeft
    || switchLayout.copyWidth < switchLayout.rowWidth / 2
    || switchLayout.toggleWidth !== 38
    || switchLayout.toggleHeight !== 22
    || switchLayout.knobWidth !== 16
    || switchLayout.knobHeight !== 16
    || switchLayout.borderRadius !== "999px"
  ) {
    throw new Error(`Key View toggle overlaps or clips its text: ${JSON.stringify(switchLayout)}`);
  }
  const mouseSwitchBefore = await host.locator("#keyViewMouse").isChecked();
  await host.locator("#keyViewMouse").click();
  await host.getByText("Configurações salvas.").waitFor();
  const persistedMouseSwitch = await options.evaluate(async () => {
    const result = await chrome.storage.local.get("qtsWorkspaceV1");
    return result.qtsWorkspaceV1?.preferences?.keyView?.mouseEffects;
  });
  if (persistedMouseSwitch !== !mouseSwitchBefore) throw new Error("Key View mouse switch did not persist immediately");
  await host.locator("#keyViewMouse").click();
  await host.locator("#drawerHeaderToggle").click();
  await host.locator("#drawerClose").click();
  await host.locator("#toolsButton").click();
  await host.locator("#toolsMenu.isOpen").waitFor();
  if (!(await host.locator("#keyViewMenuItem.isActive").count())) throw new Error("Key View menu item did not show as active after enabling it");
  await host.screenshot({ path: resolve(evidencePath, "extension-theme-tools-menu-active-item.png"), fullPage: false });
  await host.locator("#toolsButton").click();
  await host.locator("main").dispatchEvent("mousedown", { button: 0, clientX: 300, clientY: 300 });
  const mouseFill = await host.locator("#qts-mouse-view-overlay .qts-mouse-left").evaluate((node) => getComputedStyle(node).fill);
  if (mouseFill !== "rgb(59, 130, 246)") throw new Error(`Color theme preset did not reach the Key View mouse overlay: ${mouseFill}`);
  await host.locator("main").dispatchEvent("mouseup", { button: 0, clientX: 300, clientY: 300 });
  await host.locator("main").dispatchEvent("wheel", { deltaY: 120, clientX: 300, clientY: 300 });
  const scrollFill = await host.locator("#qts-mouse-view-overlay .qts-mouse-wheel").evaluate((node) => getComputedStyle(node).fill);
  if (scrollFill !== "rgb(59, 130, 246)") throw new Error(`Color theme preset did not reach the Key View scroll indicator: ${scrollFill}`);
  await host.locator("#toolsButton").click();
  await host.locator("#keyViewMenuItem").click();
  await host.locator("#drawerHeaderToggle").click();
  await host.locator("#drawerClose").click();
  await options.locator('.protectedNav[data-tab="general"]').click();
  await options.locator('.settingsAccordion:has(#colorThemeReset)').evaluate((accordion) => { accordion.open = true; });
  if (await options.locator('[data-color-family="blue"]').getAttribute("aria-checked") !== "true") throw new Error("Selected color family did not stay marked as checked");
  await options.locator("#colorThemeReset").click();
  await host.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--qts-ui-primary").trim() === "#2563eb");
  await host.locator("#toolsButton").click();
  await host.locator("#inputLabMenuItem").click();
  await host.locator(".qts-drawer").waitFor();
  const resetDrawerCloseBg = await host.locator("#drawerClose").evaluate((node) => getComputedStyle(node).backgroundColor);
  if (resetDrawerCloseBg !== "rgb(199, 14, 14)") throw new Error(`Color theme reset did not preserve the red close-button exception: ${resetDrawerCloseBg}`);
  await host.locator("#drawerClose").click();
  trace("eleven color families verified in light and dark modes (selection reaches drawer chrome + Key View's mouse overlay, reset restores default)");
  const passSoundRequestPromise = host.waitForRequest((request) => request.url().endsWith("/src/assets/sounds/test-pass.mp3"));
  await host.locator("#toolsButton").click();
  await host.locator("#statusMenuItem").click();
  await host.locator('#qts-test-status-modal [data-status="pass"]').click();
  await passSoundRequestPromise;
  trace("toolbar hierarchy verified");

  // Sessão de Teste: starting it must show the visible, ticking indicator (never a silently
  // active mode); a status picked while it's running must show up in the finish summary;
  // Finalizar must open a drawer with the real duration/result, not a placeholder.
  await host.locator("#toolsButton").click();
  await host.locator("#testSessionMenuItem").click();
  await host.locator("#testSessionBar:not(.isHidden)").waitFor({ timeout: 5_000 });
  await host.waitForTimeout(2_100);
  const elapsedText = await host.locator("#testSessionElapsed").innerText();
  if (!/^00:0[1-3]$/.test(elapsedText)) throw new Error(`Sessão de Teste elapsed indicator did not tick: "${elapsedText}"`);
  await host.locator("#toolsButton").click();
  await host.locator("#statusMenuItem").click();
  await host.locator('#qts-test-status-modal [data-status="fail"]').click();
  await host.locator("#testSessionFinishButton").click();
  if (await host.locator("#testSessionBar:not(.isHidden)").count()) throw new Error("Sessão de Teste bar stayed visible after Finalizar");
  const sessionSummary = host.locator(".qts-drawer:has([data-session-scenario])");
  await sessionSummary.locator("[data-session-scenario]").waitFor();
  await sessionSummary.locator("[data-session-scenario]").fill("Fluxo de checkout com cupom expirado");
  if (!(await sessionSummary.locator("[data-session-device]").count())) throw new Error("Test session summary is missing the tested device selector");
  const summaryBody = await sessionSummary.innerText();
  if (!/\d{2}:\d{2}/.test(summaryBody)) throw new Error(`Sessão de Teste summary is missing a real duration: ${summaryBody}`);
  if (!/Fail|Falha/i.test(summaryBody)) throw new Error(`Sessão de Teste summary did not carry the status picked during the session: ${summaryBody}`);
  await sessionSummary.locator("[data-session-notes]").fill("Reproduzido em ambiente de QA.");
  await sessionSummary.locator("[data-session-save]").click();
  await host.getByText(/Sessão salva|Sesión guardada|Session saved/).waitFor({ timeout: 5_000 });
  trace("Sessão de Teste verified (visible ticking indicator, status carried into summary, save persisted)");

  // Report Builder: "Criar relatório" from a finished (Fail) session must open pre-filled with
  // the scenario as title and "bug" as kind - the whole point is not retyping what's already
  // known. Then verify save-as-template + copy actually work, and that a saved template really
  // round-trips back into the form on a fresh open (not just accepted without effect).
  await sessionSummary.locator("[data-session-report]").click();
  const reportDrawer = host.locator(".qts-drawer:has([data-report-title])");
  await reportDrawer.locator("[data-report-title]").waitFor();
  const prefilledTitle = await reportDrawer.locator("[data-report-title]").inputValue();
  if (prefilledTitle !== "Fluxo de checkout com cupom expirado") throw new Error(`Report Builder did not inherit the session scenario as title: "${prefilledTitle}"`);
  const prefilledKind = await reportDrawer.locator("[data-report-kind]").inputValue();
  if (prefilledKind !== "bug") throw new Error(`Report Builder did not map a Fail session to kind "bug": "${prefilledKind}"`);
  if (!(await reportDrawer.locator("[data-report-device]").count())) throw new Error("Report Builder is missing the tested device selector");
  if (!(await reportDrawer.locator("[data-report-export-pdf]").count())) throw new Error("Reports is missing the visual PDF export");
  await reportDrawer.locator(".qts-help-balloon").first().hover();
  const helpPopoverStyle = await host.locator(".qts-help-popover").evaluate((element) => {
    const style = getComputedStyle(element);
    return { position: style.position, zIndex: Number(style.zIndex), visible: element.getBoundingClientRect().width > 0 };
  });
  if (helpPopoverStyle.position !== "fixed" || helpPopoverStyle.zIndex !== 2147483647 || !helpPopoverStyle.visible) {
    throw new Error(`Help balloon is clipped or below the drawer stack: ${JSON.stringify(helpPopoverStyle)}`);
  }
  await reportDrawer.locator("[data-report-steps]").fill("1. Aplicar cupom expirado\n2. Finalizar compra");
  await reportDrawer.locator("[data-report-expected]").fill("Sistema recusa o cupom com mensagem clara.");
  host.once("dialog", (dialog) => dialog.accept("Bug de checkout"));
  await reportDrawer.locator("[data-report-save-template]").click();
  await host.getByText(/Template salvo|Template guardado|Template saved/).waitFor({ timeout: 5_000 });
  await reportDrawer.locator("[data-report-copy]").click();
  await host.getByText(/Relatório copiado|Informe copiado|Report copied/).waitFor({ timeout: 5_000 });
  await reportDrawer.locator("[data-report-copy-slack]").click();
  await host.locator("#qtsToastContainer").getByText(/Slack\/Teams/).waitFor({ timeout: 5_000 });
  await host.locator("#drawerClose").click();
  await host.locator("#toolsButton").click();
  await host.locator("#reportBuilderMenuItem").click();
  const freshReportDrawer = host.locator(".qts-drawer:has([data-report-title])");
  await freshReportDrawer.locator("[data-report-template]").waitFor({ timeout: 5_000 });
  await freshReportDrawer.locator("[data-report-template]").selectOption({ label: "Bug de checkout" });
  const loadedTitle = await freshReportDrawer.locator("[data-report-title]").inputValue();
  if (loadedTitle !== "Fluxo de checkout com cupom expirado") throw new Error(`Loading a saved Report Builder template did not restore its fields: title="${loadedTitle}"`);
  await host.locator("#drawerClose").click();
  trace("Report Builder verified (pre-filled from a finished session, template save/load round-trips real field values)");

  // The first-run callout moved from a popup card (which sat right where the tour balloon and
  // evidence recordings needed that space) into the notification bell.
  if (await host.locator("#firstRunIntro").count()) throw new Error("First-run intro still renders as a popup card instead of a bell notification");
  await host.locator("#notificationBellButton").click();
  await host.getByText("A barra está pronta").waitFor({ timeout: 5_000 });
  await host.locator('[data-dismiss-intro]').click();
  await host.locator("#notificationBellBadge.isVisible").waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  if (await host.locator("#notificationBellBadge.isVisible").count()) throw new Error("Notification bell badge stayed visible after dismissing the first-run entry");
  await host.locator("#notificationBellButton").click();
  trace("first-run notification moved to the bell");

  // Mode tools can be pinned as one-click toolbar actions and expose synchronized accessible
  // pressed state, while remaining available from Tools on narrow layouts.
  for (const required of ["#passButton", "#failButton", "#screenshotButton", "#recordToggleButton"]) {
    if (!(await host.locator(required).isVisible())) throw new Error(`Required fixed shortcut is missing: ${required}`);
  }
  if (await host.locator("#testStatusButton").isVisible()) throw new Error("Test Status should live in Tools, not in the four permanent shortcuts");
  if (await host.locator("#extraPinnedTools button").count()) throw new Error("Fresh workspace should allow zero optional fixed shortcuts");
  trace("required fixed shortcuts + zero optional state verified");

  await host.locator("#toolsButton").click();
  if (await host.locator("#disableAllToolsMenuItem:not(.isHidden)").count()) throw new Error("Global tool shutdown should stay hidden when no tool is active");
  await host.locator("#toolsButton").click();
  await host.locator("#passButton").click();
  if (!await host.locator("body").evaluate((body) => body.classList.contains("qts-placement-mode"))) throw new Error("Pass placement mode did not activate");
  await host.locator("#toolsButton").click();
  if (!await host.locator("#disableAllToolsMenuItem:not(.isHidden)").count()) throw new Error("Global tool shutdown did not appear while a tool was active");
  await host.locator("#disableAllToolsMenuItem").click();
  await host.locator("#activeToolsDisableAll").click();
  if (await host.locator("body").evaluate((body) => body.classList.contains("qts-placement-mode"))) throw new Error("Global tool shutdown left placement mode active");
  if (await host.locator("button.isActive").count()) throw new Error("Global tool shutdown left an active toolbar control");
  trace("global active-tool shutdown verified");

  const shortcutInput = options.locator('[data-shortcut-key="inspectors"]');
  await shortcutInput.dispatchEvent("keydown", { key: "I", code: "KeyI", altKey: true, shiftKey: true, bubbles: true, cancelable: true });
  if (await shortcutInput.inputValue() !== "Alt+Shift+I") throw new Error("Custom shortcut capture did not format the key combination");
  await options.locator('.protectedNav[data-tab="general"]').click();
  await options.locator("#saveGeneralSettings").click();
  await host.locator("h1").press("Alt+Shift+I");
  await host.locator(".qts-drawer").waitFor();
  if (!/Observador|Endpoint/i.test(await host.locator(".qts-drawer-head h2").textContent())) throw new Error("Custom shortcut did not open the configured tool");
  await host.locator("#drawerClose").click();
  trace("custom tool shortcut capture, persistence and execution verified");

  await host.locator("#toolsButton").click();
  await host.locator("#languageValidatorMenuItem").click();
  await host.locator("#languageFile").setInputFiles({ name: "pt-BR.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ title: "Ambiente de teste", missing: "Texto que não existe" })) });
  await host.getByText("1/2 textos encontrados").waitFor();
  const validationRows = await host.locator("#languageResults .qts-list-row").count();
  if (validationRows !== 2) throw new Error(`Language validator did not report every imported text: ${validationRows}`);
  await host.locator("#drawerClose").click();
  trace("JSON language-text validator verified against visible page content");

  await host.locator("#toolsButton").click();
  await host.locator("#qrCodeMenuItem").click();
  await host.locator("#qrCanvas").waitFor();
  const qrEvidence = await host.locator("#qrCanvas").evaluate((canvas) => ({ dataLength: canvas.toDataURL("image/png").length, status: canvas.closest(".qts-drawer-body").querySelector("#qrStatus")?.textContent || "" }));
  if (qrEvidence.dataLength < 1_000 || qrEvidence.status.includes("token=")) throw new Error(`Local QR generator failed or leaked sensitive URL data: ${JSON.stringify(qrEvidence)}`);
  const qrDownloadPromise = host.waitForEvent("download");
  await host.locator("#qrDownload").click();
  if ((await qrDownloadPromise).suggestedFilename() !== "qa-toolbar-qrcode.png") throw new Error("QR download did not produce the expected PNG");
  await host.locator("#drawerClose").click();
  trace("offline QR generation and PNG download verified");

  // Warning/Question join Pass/Fail as page markers, but Pass/Fail keep their own always-visible
  // one-click buttons (a tested, deliberate product decision -- see the fixed-shortcuts check right
  // above) instead of folding all four into one menu; Warning/Question live behind a small chevron
  // next to them so the toolbar doesn't grow two more permanent icons for less-common statuses.
  // Placed in the bottom-right corner, well clear of any field later tests interact with (a first
  // draft placed these mid-page and left them there, silently blocking a later click on #qaEmail).
  await host.locator("#passButton").click();
  if (!(await host.locator("#passButton").evaluate((button) => button.classList.contains("isActive")))) throw new Error("Pass placement did not activate");
  await host.locator("#passButton").click();
  if (await host.locator("#passButton").evaluate((button) => button.classList.contains("isActive"))) throw new Error("Second click on the active Pass shortcut did not cancel placement");
  if (await host.locator("body").evaluate((body) => body.classList.contains("qts-placement-mode"))) throw new Error("Placement cursor remained active after toggling Pass off");
  await host.locator("#markerMoreButton").click();
  await host.locator('[data-marker-pick="warning"]').click();
  await host.mouse.click(1320, 840);
  const warningMarker = host.locator(".qts-marker-body.isWarning");
  if (!(await warningMarker.isVisible())) throw new Error("Warning marker was not placed on click");
  await host.locator("#markerMoreButton").click();
  await host.locator('[data-marker-pick="question"]').click();
  await host.mouse.click(1360, 840);
  const questionMarker = host.locator(".qts-marker-body.isQuestion");
  if (!(await questionMarker.isVisible())) throw new Error("Question marker was not placed on click");
  const warningBg = await warningMarker.evaluate((node) => getComputedStyle(node).backgroundColor);
  const questionBg = await questionMarker.evaluate((node) => getComputedStyle(node).backgroundColor);
  if (warningBg === questionBg) throw new Error(`Warning and Question markers rendered with the same color: ${warningBg}`);
  trace("warning/question markers verified (placed via the new chevron menu, distinct colors)");

  // Forma agora abre um menu de escolha (Retângulo/Quadrado/Círculo/Linha) em vez de desenhar
  // direto um retângulo — o tipo escolhido já é aplicado na criação, sem precisar reabrir o editor.
  await host.locator("#toolsButton").click();
  await host.locator("#shapesMenuItem").click();
  trace("line: shape menu opened");
  await host.locator('#shapeTypeMenu:not(.isHidden)').waitFor({ timeout: 2_000 });
  // Regression guard: the shape-type flyout used to just get appended as the LAST child of the
  // whole Tools list (position:static), landing far below "Desenhar forma" instead of next to it.
  // It must now open flush against that exact row, vertically aligned within a few pixels.
  const shapesRowBox = await host.locator("#shapesMenuItem").boundingBox();
  const submenuBox = await host.locator("#shapeTypeMenu").boundingBox();
  if (Math.abs(submenuBox.y - shapesRowBox.y) > 6) throw new Error(`Shape-type flyout did not open aligned with "Desenhar forma": row at y=${shapesRowBox.y}, menu at y=${submenuBox.y}`);
  if (submenuBox.x > shapesRowBox.x && submenuBox.x < shapesRowBox.x + shapesRowBox.width) throw new Error("Shape-type flyout overlapped the Tools list instead of opening beside it");
  await host.locator('[data-shape-pick="rectangle"]').click();
  await host.mouse.move(300, 300);
  await host.mouse.down();
  await host.mouse.move(460, 420, { steps: 6 });
  await host.mouse.up();
  trace("line: drawn");
  if (await host.locator(".qts-shape").evaluate((shape) => shape.dataset.shapeType) !== "rectangle") throw new Error("Shape did not apply the Formato picked from the shape-type menu at creation");
  await host.locator(".qts-shape").evaluate((shape) => shape.classList.remove("isEyeAwake"));
  await host.mouse.move(900, 600);
  await host.waitForTimeout(260);
  const idleEyeOpacity = await host.locator(".qts-shape [data-visibility-toggle]").evaluate((button) => Number.parseFloat(getComputedStyle(button).opacity));
  if (idleEyeOpacity > 0.05) throw new Error(`Floating eye did not fade after inactivity: ${idleEyeOpacity}`);
  await host.locator(".qts-shape").hover();
  await host.waitForTimeout(260);
  const hoverEyeOpacity = await host.locator(".qts-shape [data-visibility-toggle]").evaluate((button) => Number.parseFloat(getComputedStyle(button).opacity));
  if (hoverEyeOpacity < 0.95) throw new Error(`Floating eye did not return on hover: ${hoverEyeOpacity}`);
  await host.locator(".qts-shape [data-visibility-toggle]").click();
  await host.locator(".qts-shape .qts-edit-btn").click();
  await host.locator("select[data-shape-type]").selectOption("circle");
  const circleRadius = await host.locator(".qts-shape-box").evaluate((box) => getComputedStyle(box).borderRadius);
  if (!circleRadius.includes("50%")) throw new Error(`Shape "Círculo" did not apply a 50% radius: ${circleRadius}`);
  const [circleWidth, circleHeight] = await host.locator(".qts-shape").evaluate((shape) => [shape.offsetWidth, shape.offsetHeight]);
  if (circleWidth !== circleHeight) throw new Error(`Shape "Círculo" did not constrain to equal width/height: ${circleWidth}x${circleHeight}`);
  await host.locator("[data-shape-effect]").selectOption("blur");
  if (await host.locator("[data-shape-blur-control]").isHidden()) throw new Error("Blur-strength slider did not appear after selecting the Borrão effect");
  const blurFilter = await host.locator(".qts-shape-box").evaluate((box) => getComputedStyle(box).backdropFilter || getComputedStyle(box).webkitBackdropFilter);
  if (!blurFilter.includes("blur")) throw new Error(`Shape "Borrão" effect did not apply a real backdrop-filter blur: ${blurFilter}`);
  await host.locator(".qts-shape .qts-shape-editor [data-save]").click();
  if (await host.locator(".qts-shape .qts-shape-editor").count()) throw new Error("Salvar did not close the shape's style editor popup");
  await host.locator(".qts-shape .qts-remove-btn").click();
  trace("shape formato/efeito (círculo + borrão) verified, Salvar closes the editor");

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

  // History list: shows one row per blurred element, with its own remove button (not just clear-all).
  await host.locator("#blurSelectElement").click();
  await host.locator("#qaName").click();
  await host.keyboard.press("Escape");
  await host.locator("#toolsButton").click();
  await host.locator("#blurElementsMenuItem").click();
  if (await host.locator('[data-blur-remove]').count() !== 1) throw new Error("Blur history list did not show a row for the blurred element");
  await host.locator('[data-blur-remove="0"]').click();
  if (await host.locator("#qaName").evaluate((element) => element.classList.contains("qts-blurred-element"))) throw new Error("Removing a row from the blur history did not unblur that element");
  if (await host.locator('[data-blur-remove]').count() !== 0) throw new Error("Blur history list did not update after removing its only row");
  await host.locator("#drawerClose").click();

  // Right-click "Borrar / desborrar este elemento" toggles blur without opening the drawer at all.
  // `chrome.tabs.sendMessage` only exists in a privileged extension context (the service worker),
  // not the page's own main world, so this drives it exactly the way background.js's
  // contextMenus.onClicked handler really does: a real contextmenu DOM event first (captures the
  // target the same way the real listener would), then the worker relays the action to that tab.
  await host.locator("#qaEmail").click({ button: "right" });
  await worker.evaluate(() => new Promise((resolve) => {
    chrome.tabs.query({ url: "http://127.0.0.1:43117/*" }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: "qts:context-action", action: "toggle-blur" }, () => resolve());
    });
  }));
  if (!(await host.locator("#qaEmail").evaluate((element) => element.classList.contains("qts-blurred-element")))) throw new Error("Context-menu toggle-blur did not blur the right-clicked element");
  await host.locator("#qaEmail").click({ button: "right" });
  await worker.evaluate(() => new Promise((resolve) => {
    chrome.tabs.query({ url: "http://127.0.0.1:43117/*" }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: "qts:context-action", action: "toggle-blur" }, () => resolve());
    });
  }));
  if (await host.locator("#qaEmail").evaluate((element) => element.classList.contains("qts-blurred-element"))) throw new Error("Context-menu toggle-blur did not undo the blur on a second trigger");
  trace("borrar elementos tool verified (select, toggle, re-arm, clear all, per-item history removal, context menu)");

  // Linha: drawn from two literal points (not a drag-to-size box), width matches the real
  // distance between them, the endpoint resize handle can redefine the length/angle after the
  // fact, enabling an endpoint style adds the matching CSS class, and Salvar closes the editor
  // popup without removing the line.
  await host.locator("#toolsButton").click();
  await host.locator("#shapesMenuItem").click();
  await host.locator('#shapeTypeMenu:not(.isHidden)').waitFor({ timeout: 2_000 });
  await host.locator('[data-shape-pick="line"]').click();
  await host.mouse.move(200, 200);
  await host.mouse.down();
  await host.mouse.move(400, 200, { steps: 6 });
  await host.mouse.up();
  const lineWidth = await host.locator(".qts-line").evaluate((line) => line.offsetWidth);
  if (Math.abs(lineWidth - 200) > 5) throw new Error(`Line width did not match the drawn distance: ${lineWidth}`);
  const resizeHandle = host.locator(".qts-line-resize-handle");
  const handleBox = await resizeHandle.boundingBox();
  if (!handleBox) throw new Error("Line resize handle has no bounding box");
  trace("line: resize handle found");
  await host.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await host.mouse.down();
  await host.mouse.move(500, 200, { steps: 6 });
  await host.mouse.up();
  trace("line: resized");
  const resizedWidth = await host.locator(".qts-line").evaluate((line) => line.offsetWidth);
  if (Math.abs(resizedWidth - 300) > 8) throw new Error(`Line resize handle did not redefine the length: ${resizedWidth}`);
  await host.locator(".qts-line [data-visibility-toggle]").click();
  trace("line: controls visible");
  await host.locator(".qts-line .qts-edit-btn").click();
  trace("line: editor opened");
  const endpointControls = await host.locator(".qts-line-endpoint-options").evaluateAll((groups) => groups.map((group) => ({
    buttons: group.querySelectorAll("label").length,
    icons: group.querySelectorAll("label svg.qts-line-endpoint-icon").length,
    visibleText: [...group.querySelectorAll("label span")].map((span) => span.textContent.trim()).filter(Boolean),
    accessibleNames: [...group.querySelectorAll('input[type="radio"]')].map((input) => input.getAttribute("aria-label")),
  })));
  if (endpointControls.length !== 2 || endpointControls.some((group) => group.buttons !== 5 || group.icons !== 5 || group.visibleText.length || new Set(group.accessibleNames).size !== 5)) {
    throw new Error(`Line endpoint choices must be five distinct icon buttons with accessible names: ${JSON.stringify(endpointControls)}`);
  }
  await host.locator('[name="line-start"][value="dotFilled"]').check({ force: true });
  await host.locator('[name="line-end"][value="arrow"]').check({ force: true });
  if (!(await host.locator(".qts-line").evaluate((line) => line.classList.contains("startHasDotFilled") && line.classList.contains("hasArrow")))) throw new Error("Independent line endpoints did not apply");
  await host.locator(".qts-line .qts-shape-editor [data-save]").click();
  trace("line: arrow saved");
  if (await host.locator(".qts-line .qts-shape-editor").count()) throw new Error("Salvar did not close the line's style editor popup");
  if (await host.locator(".qts-line").count() !== 1) throw new Error("Salvar on the line editor should not remove the line itself");
  await host.locator(".qts-line .qts-edit-btn").click();
  await host.locator('[name="line-start"][value="triangle"]').check({ force: true });
  await host.locator('[name="line-end"][value="dotHollow"]').check({ force: true });
  if (!(await host.locator(".qts-line").evaluate((line) => line.classList.contains("startHasTriangle") && line.classList.contains("hasDotHollow")))) throw new Error("Independent alternate line endpoints did not apply");
  await host.locator(".qts-line .qts-shape-editor [data-save]").click();
  await host.locator(".qts-line .qts-remove-btn").click();
  if (await host.locator(".qts-line").count()) throw new Error("Removing the line did not remove it from the page");
  trace("linha com redimensionamento pela ponta, novas pontas e botão Salvar verificados");

  // Holofote: never preventDefault's the real keyboard/mouse events (the page must keep working
  // while the mode is on), only shows the spotlight after a genuine 2s Ctrl hold, and fades back
  // out on release.
  await host.locator("#toolsButton").click();
  await host.locator("#holofoteMenuItem").click();
  await host.locator("#drawerHeaderToggle").click();
  await host.locator("#drawerClose").click();
  await host.mouse.move(320, 260);
  await host.keyboard.down("Control");
  if (await host.locator("#qts-holofote-overlay.isVisible").count()) throw new Error("Holofote appeared before the 2s Ctrl-hold threshold");
  await host.waitForTimeout(3_000);
  await host.locator("#qts-holofote-overlay.isVisible").waitFor({ timeout: 5_000 });
  await host.keyboard.up("Control");
  if (await host.locator("#qts-holofote-overlay.isVisible").count()) throw new Error("Holofote did not start fading out on release");
  if (!(await host.locator("h1").isVisible())) throw new Error("Holofote mode blocked normal page interaction");
  // Clicking the menu row again while a mode is already active turns it off directly instead of
  // reopening the drawer (same one-click toggle the quick pinned buttons already had).
  await host.locator("#toolsButton").click();
  await host.locator("#holofoteMenuItem").click();
  if (await host.locator("#drawerHost .qts-drawer").count()) throw new Error("Clicking the active Holofote menu row again reopened the drawer instead of toggling off");
  if (await host.locator("#qts-holofote-overlay.isVisible").count()) throw new Error("Clicking the active Holofote menu row again did not turn the mode off directly");
  if (await host.locator("#holofoteMenuItem.isActive").count()) throw new Error("Holofote menu row still shows isActive after being toggled off");
  trace("modo holofote verified (2s Ctrl hold, follows release fade, page stays interactive, one-click toggle-off)");

  // Pixel Perfect: crosshair lines track the real mouse position (read back off the overlay's own
  // CSS custom properties), a click anchors a smart-ruler measurement to the next mouse position,
  // and a second click releases it. Never preventDefault's real clicks, so the page stays usable.
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click();
  await host.locator("#drawerHeaderToggle").click();
  await host.locator("#drawerClose").click();
  await host.mouse.move(300, 260);
  const ppPos1 = await host.locator("#qts-pixelperfect-overlay").evaluate((el) => [el.style.getPropertyValue("--qts-pp-x"), el.style.getPropertyValue("--qts-pp-y")]);
  if (ppPos1[0] !== "300px" || ppPos1[1] !== "260px") throw new Error(`Pixel Perfect crosshair did not track the mouse position: ${ppPos1}`);
  if (await host.locator(".qts-pp-measure-line:not(.isHidden)").count()) throw new Error("Pixel Perfect showed a measurement line before any anchor was set");

  // "Somente horizontal"/"somente vertical" must actually hide the other line -- broken
  // previously because a plain element.style.display always lost to this file's blanket
  // `all: revert !important` reset (see toolbar.css's .isHidden rule next to .qts-pp-line-h/-v).
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click(); // already active -> toggles off
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click(); // now inactive -> opens the drawer
  const pixelPerfectModes = host.locator("[data-pp-mode]");
  if (await pixelPerfectModes.count() !== 4) throw new Error("Pixel Perfect must expose four icon-and-text mode choices");
  for (const mode of ["cross", "horizontal", "vertical", "bounds"]) {
    const option = host.locator(`[data-pp-mode="${mode}"]`);
    if (!(await option.locator(".qts-mode-icon").count()) || !(await option.locator(".qts-mode-copy b").textContent())?.trim()) {
      throw new Error(`Pixel Perfect mode ${mode} is missing its icon or visible label`);
    }
  }
  const defaultPixelPerfectColor = await host.locator("#pixelPerfectColor").inputValue();
  if (defaultPixelPerfectColor.toLowerCase() !== "#2563eb") {
    throw new Error(`Pixel Perfect did not inherit the default primary theme color: ${defaultPixelPerfectColor}`);
  }
  await host.locator("#pixelPerfectMode").selectOption("horizontal");
  await host.locator("#drawerHeaderToggle").click();
  await host.locator("#drawerClose").click();
  await host.mouse.move(320, 280);
  if (!(await host.locator(".qts-pp-line-h").isVisible())) throw new Error("Pixel Perfect horizontal-only mode did not show the horizontal line");
  if (await host.locator(".qts-pp-line-v:not(.isHidden)").count()) throw new Error("Pixel Perfect horizontal-only mode still showed the vertical line");
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click();
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click();
  await host.locator("#pixelPerfectMode").selectOption("vertical");
  await host.locator("#drawerHeaderToggle").click();
  await host.locator("#drawerClose").click();
  await host.mouse.move(320, 280);
  if (!(await host.locator(".qts-pp-line-v").isVisible())) throw new Error("Pixel Perfect vertical-only mode did not show the vertical line");
  if (await host.locator(".qts-pp-line-h:not(.isHidden)").count()) throw new Error("Pixel Perfect vertical-only mode still showed the horizontal line");
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click();
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click();
  await host.locator("#pixelPerfectMode").selectOption("cross");
  await host.locator("#drawerHeaderToggle").click();
  await host.locator("#drawerClose").click();
  trace("pixel perfect horizontal/vertical-only guide line modes verified");
  await host.mouse.click(300, 260);
  await host.mouse.move(500, 400, { steps: 8 });
  await host.locator(".qts-pp-measure-line:not(.isHidden)").waitFor({ timeout: 2_000 });
  const measureLabel = await host.locator(".qts-pp-measure-label").innerText();
  if (!/^\d+×\d+px · \d+px$/.test(measureLabel)) throw new Error(`Pixel Perfect measurement label had an unexpected format: ${measureLabel}`);
  await host.mouse.click(500, 400);
  if (await host.locator(".qts-pp-measure-line:not(.isHidden)").count()) throw new Error("Second click did not release the Pixel Perfect measurement");
  if (!(await host.locator("h1").isVisible())) throw new Error("Pixel Perfect mode blocked normal page interaction");
  trace("pixel perfect verified (crosshair tracks the mouse, click-anchor smart ruler measures and releases)");

  // Pixel Perfect "bounds" mode: hovering snaps a box to the real element under the cursor and
  // shows its exact pixel size, the wheel walks the box up the DOM ancestor chain (bigger
  // container per notch), and a click pins it without triggering the underlying element's own
  // click behavior (a link/button under the cursor must not activate).
  // Still active from the crosshair test above, so the menu row's one-click toggle turns it off
  // first; a second click (now inactive) reopens the drawer to pick "bounds" before reactivating.
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click();
  if (await host.locator("#qts-pixelperfect-overlay").count()) throw new Error("Clicking the active Pixel Perfect menu row again did not turn the mode off directly");
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click();
  await host.locator("#pixelPerfectMode").selectOption("bounds");
  await host.locator("#drawerHeaderToggle").click();
  await host.locator("#drawerClose").click();
  await host.locator("#qaName").hover();
  await host.locator(".qts-pp-bounds-box:not(.isHidden)").waitFor({ timeout: 2_000 });
  const boundsLabel1 = await host.locator(".qts-pp-bounds-label").innerText();
  if (!/^\S+ · \d+×\d+px$/.test(boundsLabel1)) throw new Error(`Pixel Perfect bounds label had an unexpected format: ${boundsLabel1}`);
  await host.mouse.wheel(0, 120);
  await host.waitForTimeout(150);
  const boundsLabel2 = await host.locator(".qts-pp-bounds-label").innerText();
  if (boundsLabel2 === boundsLabel1) throw new Error("Pixel Perfect bounds scroll did not move to a different DOM ancestor");
  await host.locator("#qaName").click();
  if (!(await host.locator(".qts-pp-bounds-box").evaluate((el) => el.classList.contains("isPinned")))) throw new Error("Pixel Perfect bounds click did not pin the box");
  await host.locator("#qaName").click();
  if (await host.locator(".qts-pp-bounds-box").evaluate((el) => el.classList.contains("isPinned"))) throw new Error("Second click did not unpin the Pixel Perfect bounds box");
  // Clicking the menu row again while active turns Pixel Perfect off directly, same as Holofote.
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click();
  if (await host.locator("#qts-pixelperfect-overlay").count()) throw new Error("Clicking the active Pixel Perfect menu row again did not turn the mode off directly");
  trace("pixel perfect bounds mode verified (hover shows real element size, scroll walks the ancestor chain, click pins without activating the element, one-click toggle-off)");

  // Right-click "Inspecionar com Pixel Perfect" pins the inspector on the clicked element in one
  // step, same relay mechanism as "Borrar / desborrar este elemento" above.
  await host.locator("#qaEmail").click({ button: "right" });
  await worker.evaluate(() => new Promise((resolve) => {
    chrome.tabs.query({ url: "http://127.0.0.1:43117/*" }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: "qts:context-action", action: "pixel-perfect-inspect" }, () => resolve());
    });
  }));
  await host.locator(".qts-pp-bounds-box.isPinned").waitFor({ timeout: 2_000 });
  await host.locator("#toolsButton").click();
  await host.locator("#pixelPerfectMenuItem").click();
  if (await host.locator("#qts-pixelperfect-overlay").count()) throw new Error("Clicking the active Pixel Perfect menu row again did not turn the mode off directly");
  trace("pixel perfect context-menu inspect verified (right-click pins the inspector on the clicked element immediately, one-click toggle-off)");

  // Recording type menu offers a normal seekable video and a real locally encoded GIF mode. GIF
  // recordings are split into independent 15-second files and zipped only when there is >1 part.
  // Actually invoking getDisplayMedia is not exercised here — it opens a real native OS picker
  // with no Chromium test flag that reliably auto-approves it (unlike camera/mic fake devices),
  // so clicking past this menu would hang or flake the suite. The menu wiring itself (open/close,
  // both options present, parts option disabled) is real coverage; the segmentation/zip-packaging
  // logic was verified separately via a Node harness against the already-proven window.QTS_ZIP writer.
  await host.locator("#recordToggleButton").click();
  await host.locator("#recordTypeMenu:not(.isHidden)").waitFor({ timeout: 2_000 });
  if (!(await host.locator("#recordTypeVideoItem").isVisible())) throw new Error("Record type menu missing the single-video option");
  if (!(await host.locator("#recordTypePartsItem").isVisible())) throw new Error("Record type menu missing the 15s GIF option");
  if (await host.locator("#recordTypePartsItem").isDisabled()) throw new Error("15s GIF recording option should be enabled");
  if (!(await host.locator("#recordTypePartsItem").getAttribute("data-record-mode"))?.includes("gif")) throw new Error("GIF option is not wired to GIF recording mode");
  await host.locator("#currentUrl").click();
  await host.locator("#recordTypeMenu:not(.isHidden)").waitFor({ state: "hidden", timeout: 2_000 });
  trace("record type menu verified (video + real 15s GIF options, opens/closes correctly)");

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

  // "Ver elementos": a live on-page overlay labeling captured elements with whichever locator
  // fields are checked, independent of the drawer staying open.
  await host.locator("#elementViewToggle").click();
  await host.locator(".qts-element-view-label").first().waitFor({ timeout: 2_000 });
  await host.locator("#drawerClose").click();
  if (!(await host.locator(".qts-element-view-label").first().isVisible())) throw new Error("Ver elementos overlay did not persist after closing the drawer");
  await host.locator("#toolsButton").click();
  await host.locator("#elementCaptureMenuItem").click();
  if (!(await host.locator("#elementViewToggle").evaluate((el) => el.classList.contains("primary")))) throw new Error("Ver elementos toggle did not reflect the still-running overlay on reopen");
  await host.locator("#elementViewToggle").click();
  if (await host.locator(".qts-element-view-label").count()) throw new Error("Ver elementos overlay did not clear when toggled off");
  trace("ver elementos overlay verified (persists across drawer close, reflects state on reopen)");
  await host.locator("#drawerClose").click();

  // Evidence filenames: evidencia_{status?}_{tela}_{yyyyMMddHHmmss} -- no status segment unless
  // one was actually just marked on this exact page (never a stale/unrelated one).
  await worker.evaluate(() => chrome.storage.local.remove("qtsTestStatusHistoryV1"));
  const plainShotPromise = host.waitForEvent("download");
  await host.locator("#screenshotButton").click();
  const plainShot = await plainShotPromise;
  if (!/^evidencia_[a-z0-9-]+_\d{14}\.png$/.test(plainShot.suggestedFilename())) throw new Error(`Screenshot filename did not match the evidencia_{tela}_{timestamp} pattern: ${plainShot.suggestedFilename()}`);
  await host.locator("#toolsButton").click();
  await host.locator("#statusMenuItem").click();
  await host.locator('#qts-test-status-modal [data-status="pass"]').click();
  await host.waitForTimeout(300);
  const taggedShotPromise = host.waitForEvent("download");
  await host.locator("#screenshotButton").click();
  const taggedShot = await taggedShotPromise;
  if (!taggedShot.suggestedFilename().startsWith("evidencia_pass_")) throw new Error(`Screenshot filename did not carry the just-marked status: ${taggedShot.suggestedFilename()}`);
  trace("evidence filenames verified (evidencia_{tela}_{timestamp}, tagged with a just-marked status)");
  await host.evaluate(() => document.getElementById('qa"name\'mixed')?.remove());
  trace("element capture verified");
  if (!await toolbar.isVisible()) throw new Error("Toolbar disappeared after using a tool");

  // Responsive View keeps the two differently sized devices centered as one visual group.
  await host.locator("#toolsButton").click();
  const settingsTools = await options.locator("#toolsMenuOrderList > li[data-order-key]").evaluateAll((rows) => rows.map((row) => {
    const feature = window.QTS_STORAGE.FEATURE_REGISTRY.find((entry) => entry.key === row.dataset.orderKey);
    return { key: row.dataset.orderKey, menuItemId: feature?.menuItemId, label: row.querySelector("strong")?.textContent.trim() };
  }));
  const toolbarToolLabels = await host.evaluate((tools) => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    return Object.fromEntries(tools.map((tool) => {
      const item = root?.getElementById(tool.menuItemId);
      const clone = item?.cloneNode(true);
      clone?.querySelectorAll(".qts-badge,.qts-lock-badge").forEach((badge) => badge.remove());
      return [tool.key, clone?.textContent.trim() || ""];
    }));
  }, settingsTools);
  for (const { key, label: settingsLabel } of settingsTools) {
    if (toolbarToolLabels[key] !== settingsLabel) throw new Error(`Tool label differs between Settings and Tools for ${key}: ${settingsLabel} != ${toolbarToolLabels[key]}`);
  }
  await host.screenshot({ path: resolve(evidencePath, "extension-tools-canonical-labels.png"), fullPage: false });
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
  if (await host.locator("[data-content-zoom]").count() !== 2) throw new Error("Responsive View does not expose independent internal zoom controls for both frames");
  const desktopWrapBeforeZoom = await host.locator('[data-pane="a"] [data-viewport-wrap]').evaluate((element) => ({ width: element.offsetWidth, height: element.offsetHeight }));
  await host.locator('[data-content-zoom="a"]').fill("150");
  await host.waitForFunction(() => {
    const iframe = document.querySelector("#qts-toolbar-host")?.shadowRoot?.querySelector('[data-pane="a"] iframe');
    return iframe?.contentWindow?.document?.documentElement?.style.zoom === "1.5";
  });
  const breakpointZoomResult = await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    const zoom = (pane) => root?.querySelector(`[data-pane="${pane}"] iframe`)?.contentWindow?.document?.documentElement?.style.zoom;
    const wrap = root?.querySelector('[data-pane="a"] [data-viewport-wrap]');
    return { desktop: zoom("a"), mobile: zoom("b"), width: wrap?.offsetWidth, height: wrap?.offsetHeight };
  });
  if (breakpointZoomResult.desktop !== "1.5" || !["", "1"].includes(breakpointZoomResult.mobile) || breakpointZoomResult.width !== desktopWrapBeforeZoom.width || breakpointZoomResult.height !== desktopWrapBeforeZoom.height) {
    throw new Error(`Internal Breakpoint zoom changed the frame instead of only its site: ${JSON.stringify({ before: desktopWrapBeforeZoom, after: breakpointZoomResult })}`);
  }
  await host.screenshot({ path: resolve(evidencePath, "extension-breakpoint-independent-internal-zoom.png"), fullPage: false });
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
  await host.locator("#drawerHeaderToggle").click();
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
  await host.keyboard.press("Space");
  const spaceKeycaps = await host.evaluate(() => [...(document.querySelector("#qts-key-view-overlay [data-key-view-shortcut]")?.querySelectorAll(".qts-keycap") || [])].map((keycap) => keycap.getAttribute("aria-label")));
  if (spaceKeycaps.join("+") !== "Space") throw new Error(`Key View did not show the Space keycap on its own: ${JSON.stringify(spaceKeycaps)}`);
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

  // Founder feedback: the mouse highlight used to fade on a fixed timer even while the button was
  // still physically down, and rapid repeated clicks/keys looked identical to one long press --
  // pressed state now tracks real mousedown/mouseup (and keydown/keyup), and a run of repeats shows
  // a ×N badge that lingers 3s after the run stops, then fades and resets to zero.
  await host.locator("main").dispatchEvent("mousedown", { button: 0, clientX: 420, clientY: 320 });
  if (!(await host.locator("#qts-mouse-view-overlay.isPressed").count())) throw new Error("Mouse view did not show a real pressed state on mousedown");
  await host.locator("main").dispatchEvent("mouseup", { button: 0, clientX: 420, clientY: 320 });
  if (await host.locator("#qts-mouse-view-overlay.isPressed").count()) throw new Error("Mouse view stayed pressed after mouseup");
  for (let i = 0; i < 2; i += 1) {
    await host.locator("main").dispatchEvent("mousedown", { button: 0, clientX: 420, clientY: 320 });
    await host.locator("main").dispatchEvent("mouseup", { button: 0, clientX: 420, clientY: 320 });
  }
  const mouseBadge = await host.locator("[data-mouse-count]").textContent();
  if (mouseBadge !== "×3") throw new Error(`Mouse repeat badge did not show ×3 after three rapid left clicks: ${mouseBadge}`);
  for (let i = 0; i < 3; i += 1) {
    await host.locator("main").dispatchEvent("keydown", { key: "j", code: "KeyJ", bubbles: true, cancelable: true });
    await host.locator("main").dispatchEvent("keyup", { key: "j", code: "KeyJ", bubbles: true, cancelable: true });
  }
  const keyBadge = await host.locator("[data-key-count]").textContent();
  if (keyBadge !== "×3") throw new Error(`Key repeat badge did not show ×3 after three rapid "j" presses: ${keyBadge}`);
  await host.waitForTimeout(3_600);
  if (await host.locator("[data-mouse-count].isVisible").count()) throw new Error("Mouse repeat badge did not reset after the 3s linger");
  await host.locator("[data-key-view-clear]").click();
  if (await host.locator("#qts-key-view-overlay").count()) throw new Error("Key View typing was not cleared on demand");
  await host.locator("#toolsButton").click();
  await host.locator("#keyViewMenuItem").click();
  await host.locator("#drawerHeaderToggle").click();
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

  // Auto preenchimento populates visible form fields locally and always protects passwords.
  await host.locator("#toolsButton").click();
  await host.locator("#fakerFillMenuItem").click();
  await host.locator("#fakerRun").click();
  const fakerResult = await host.evaluate(() => ({ name: document.querySelector("#qaName").value, email: document.querySelector("#qaEmail").value, password: document.querySelector("#qaPassword").value }));
  if (!fakerResult.name || !fakerResult.email.endsWith("@example.com") || fakerResult.password) throw new Error(`Auto preenchimento security mismatch: ${JSON.stringify(fakerResult)}`);
  const fakerReport = await host.locator("#fakerReport").innerText();
  if (!fakerReport.includes("Campos preenchidos") || !fakerReport.includes("Nome") || !fakerReport.includes(fakerResult.name) || fakerReport.toLowerCase().includes("senha")) throw new Error(`Auto preenchimento field report mismatch: ${fakerReport}`);
  await host.locator("#drawerClose").click();

  // Validador de campos inspects constraints, tests six data classes and restores the original value.
  await host.locator("#qaName").fill("Original");
  await host.locator("#toolsButton").click();
  await host.locator("#inputLabMenuItem").click();
  await host.locator("#inputSelect").click();
  await host.locator("#qaName").click();
  await host.locator("#inputRun").click();
  await host.locator("#inputHistory tbody tr").first().waitFor({ state: "attached" });
  if (await host.locator("#inputHistory tbody tr").count() !== 6 || !await host.locator("#inputResults").innerText().then((text) => text.includes("regras declaradas")) || await host.locator("#qaName").inputValue() !== "Original") throw new Error("Validador de campos did not explain the result, persist six cases, or restore the input");
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

  // Step Recorder documents the journey independently, protects sensitive values and exports
  // the expected result in a separate, spreadsheet-safe CSV column.
  await host.locator("#toolsButton").click();
  await host.locator("#stepsRecorderMenuItem").click();
  for (const selector of ["#startSteps", "#startStepsVideo", "#startStepsGif", "#newStepsDevice"]) {
    if (await host.locator(selector).count() !== 1) throw new Error(`Step Recorder is missing ${selector}`);
  }
  await host.locator("#newStepsName").fill("Fluxo de checkout");
  await host.locator("#startSteps").click();
  await host.locator("#macroTarget").click();
  await host.locator("#macroText").fill("produto 123");
  await host.locator("#qaPassword").fill("segredo-nao-exportar");
  await host.locator("#stepsRecPauseButton").click();
  const pausedCount = await host.locator("#stepsRecCount").textContent();
  await host.locator("#multiTarget").click();
  if (await host.locator("#stepsRecCount").textContent() !== pausedCount) throw new Error("Step Recorder captured actions while paused");
  await host.locator("#stepsRecPauseButton").click();
  await host.locator("#stepsRecDoneButton").click();
  // There's no upfront mode picker anymore (see openStepsRecorder's own comment) - numbered vs
  // Gherkin is now purely a view toggle here in the editor, on the exact same recorded steps.
  await host.locator("#stepsMode").selectOption("gherkin");
  await host.locator('[data-doc-step="0"] summary').click();
  await host.locator('[data-doc-step="0"] [data-step-expected]').fill("Tela inicial disponível");
  await host.locator("#stepsSave").click();
  await host.locator("#stepsList .qts-card").first().waitFor();
  const stepsDownloadPromise = host.waitForEvent("download");
  await host.locator("#stepsList .qts-card").first().locator('[data-action="export"]').click();
  const stepsDownload = await stepsDownloadPromise;
  const stepsCsv = await readFile(await stepsDownload.path(), "utf8");
  if (!stepsCsv.includes("resultado esperado") || !stepsCsv.includes("Tela inicial disponível") || stepsCsv.includes("segredo-nao-exportar")) throw new Error("Step Recorder CSV format/security mismatch");
  await host.locator("#macroText").fill("");
  await host.locator("#stepsList .qts-card").first().locator('[data-action="replay"]').click();
  await host.waitForFunction(() => document.querySelector("#macroText")?.value === "produto 123");
  await host.locator("#toolsButton").click();
  await host.locator("#stepsRecorderMenuItem").click();
  await host.locator("#stepsList .qts-card").first().locator('[data-action="report"]').click();
  if (!(await host.locator("[data-report-steps]").inputValue()).includes("produto 123")) throw new Error("Step Recorder did not prefill Report Builder");
  trace("step recorder capture, replay, Report Builder handoff, Gherkin edit and secure CSV verified");
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
  await host.locator("#pinnedMacrosMenu [data-pinned-macro]").waitFor({ state: "attached", timeout: 5_000 });
  const pinnedMacroCount = await host.locator("#pinnedMacrosMenu [data-pinned-macro]").count();
  if (pinnedMacroCount !== 1) throw new Error("Pinned macro was not added to the tools menu");
  await host.locator('#macroList .qts-card').first().locator('[data-macro-action="edit"]').click();
  const visibleMacroOptions = await host.locator("#macroVisibleElements option").count();
  if (visibleMacroOptions < 5) throw new Error(`Macro manual element list is incomplete: ${visibleMacroOptions}`);
  const macroTargetOption = host.locator('#macroVisibleElements option[value="#macroTarget"]');
  if (await macroTargetOption.count() !== 1 || !(await macroTargetOption.innerText()).includes("Ação da macro")) {
    throw new Error("Macro manual element list did not expose an accessible label and selector");
  }
  if (await host.locator('[data-field="selector"][list="macroVisibleElements"]').count() < 1) {
    throw new Error("Macro selector fields are not connected to the searchable visible-element list");
  }
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
  await host.locator("#macroList").getByText("Importada QA").waitFor();
  if (await host.locator("#macroList .qts-card").count() !== 2) throw new Error("Macro import did not merge the validated macro");
  await host.locator("#drawerClose").click();

  // Replaying the recorded macro performs the captured click and fill.
  await host.evaluate(() => { document.querySelector("#macroTarget").dataset.clicks = "0"; document.querySelector("#macroText").value = ""; });
  await host.locator("#toolsButton").click();
  await host.locator("#pinnedMacrosMenu [data-pinned-macro]").first().click();
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
  await host.waitForFunction(() => document.querySelector("#macroText")?.value === "após navegação", null, { timeout: 45_000 });
  await host.goto("http://127.0.0.1:43117/");
  await toolbar.waitFor({ timeout: 10_000 });

  // A live recording (Gravador de Passos / Macro Studio) used to be pure in-memory - a reload
  // silently lost everything captured so far. It should now resume, via the same tab-scoped
  // chrome.storage.session pattern macro *replay* already used (see qts:recording-run).
  await host.locator("#toolsButton").click();
  await host.locator("#stepsRecorderMenuItem").click();
  await host.locator("#newStepsName").fill("Sobrevive ao reload");
  await host.locator("#startSteps").click();
  await host.locator("#macroTarget").click();
  await host.reload();
  await host.locator("#qts-toolbar-host").waitFor({ state: "attached" });
  await host.locator("#stepsRecordingBar:not(.isHidden)").waitFor({ timeout: 10_000 });
  const stepsCountAfterReload = Number(await host.locator("#stepsRecCount").textContent());
  if (!(stepsCountAfterReload >= 2)) throw new Error(`Steps recording bar did not resume with its pre-reload steps: ${stepsCountAfterReload}`);
  await host.locator("#multiTarget").click();
  const stepsCountAfterResume = Number(await host.locator("#stepsRecCount").textContent());
  if (!(stepsCountAfterResume > stepsCountAfterReload)) throw new Error("Resumed steps recording did not keep capturing new actions");
  await host.locator("#stepsRecDoneButton").click();
  await host.locator("#stepsSave").click();
  await host.getByText("Sobrevive ao reload").waitFor();
  await host.locator("#drawerClose").click();
  trace("step recorder survives reload (pre-reload steps kept, capture continued)");

  await host.locator("#toolsButton").click();
  await host.locator("#macroStudioMenuItem").click();
  await host.locator("#startMacroRecording").click();
  await host.locator("#macroTarget").click();
  await host.reload();
  await host.locator("#qts-toolbar-host").waitFor({ state: "attached" });
  await host.locator("#macroRecordingBar:not(.isHidden)").waitFor({ timeout: 10_000 });
  const macroCountAfterReload = Number(await host.locator("#macroStepCount").textContent());
  if (!(macroCountAfterReload >= 1)) throw new Error(`Macro recording bar did not resume with its pre-reload steps: ${macroCountAfterReload}`);
  await host.locator("#multiTarget").click();
  const macroCountAfterResume = Number(await host.locator("#macroStepCount").textContent());
  if (!(macroCountAfterResume > macroCountAfterReload)) throw new Error("Resumed macro recording did not keep capturing new actions");
  await host.locator("#macroRecDoneButton").click();
  await host.locator("#macroBack").click();
  await host.locator("#drawerClose").click();
  trace("macro recording survives reload (pre-reload steps kept, capture continued)");

  // Compact mode hides project/product names, preserving their image/initial badges and environment.
  await options.getByRole("button", { name: "Barra e aparência" }).click();
  // "Barra e aparência" is a list of collapsible accordions now (all closed by default except
  // "Tema") - a checkbox inside a closed <details> isn't visible/interactable, same as a real
  // user would need to expand the section first. Open the two this block needs.
  await options.locator(".settingsAccordion:has(#toolsMenuOrderHint)").evaluate((accordion) => { accordion.open = true; });
  await options.locator(".settingsAccordion:has(#breadcrumbOrderList)").evaluate((accordion) => { accordion.open = true; });
  if (await options.locator("#keyViewEnabled").count()) throw new Error("Key View configuration should remain in its own sidebar");
  if (await options.locator('[data-tool="keyView"]').count() !== 1 || await options.locator('[data-tool="keyView"]').isChecked() !== true) throw new Error("Key View menu preference did not persist in options");
  if (await options.locator('[data-tool="testStatus"]').count() !== 1 || await options.locator('[data-pin-tool="testStatus"]').count() !== 1) throw new Error("Definir status do teste is missing from menu/pinned preferences");
  await options.locator('[data-tool="testStatus"]').uncheck();
  await options.locator("#saveGeneralSettings").click();
  await host.waitForFunction(() => document.querySelector("#qts-toolbar-host")?.shadowRoot?.getElementById("statusMenuItem")?.classList.contains("isPreferenceHidden"));
  await options.locator('[data-tool="testStatus"]').check();
  const testStatusPin = options.locator('[data-pin-tool="testStatus"]');
  if (await testStatusPin.getAttribute("aria-pressed") !== "true") await testStatusPin.click();
  await options.locator("#saveGeneralSettings").click();
  await host.waitForFunction(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    return !root?.getElementById("statusMenuItem")?.classList.contains("isPreferenceHidden")
      && Boolean(root?.querySelector('[data-pinned-tool="testStatus"]'));
  });
  await host.locator('[data-pinned-tool="testStatus"]').click();
  await host.locator("#qts-test-status-modal").waitFor();
  await host.locator('#qts-test-status-modal [data-close]').click();
  trace("Test Suite menu visibility + optional toolbar pinning verified");
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
  await options.locator('[data-workspace-nav="urls"]').click();
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
  await options.locator('[data-tab="workspace"]').click();
  await options.locator('[data-workspace-nav="accounts"]').click();
  await options.locator('[data-open-composer="accountTypeComposer"]').click();
  await options.locator("#accountTypeName").fill("Administrador");
  await options.locator("#accountTypeForm button[type=submit]").click();
  await options.locator('[data-open-composer="testAccountComposer"]').click();
  // Environment/product are now a floating multi-select combobox (four independent facets,
  // see options.js's renderScopePicker) instead of a plain <select> — open the Ambientes facet,
  // tick "QA", close it back.
  await options.locator('#testAccountScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator('#testAccountScopePicker [data-facet-panel="environmentIds"] label', { hasText: "QA" }).last().locator("input").check();
  await options.locator('#testAccountScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator("#testAccountLabel").fill("Conta sandbox");
  await options.locator("#testAccountTypeId").selectOption({ label: "Administrador" });
  await options.locator("#testAccountUsername").fill("sandbox@example.com");
  await options.locator("#testAccountPassword").fill("local-password-value");
  await options.locator("#testAccountForm button[type=submit]").click();
  const accountEnvironmentGroup = options.locator("#testAccountList .relationalDataNode", { hasText: "Conta sandbox" });
  if (await accountEnvironmentGroup.locator(":scope > summary .environmentToolbarPreview > span").allTextContents().then((labels) => labels.filter((label) => label.trim() === "QA").length) !== 1) {
    throw new Error("Test account environment heading does not identify QA exactly once");
  }
  if (await accountEnvironmentGroup.locator(":scope > summary .urlTreeIdentity small, :scope > .urlTreeChildren .relationBadge", { hasText: "QA" }).count()) {
    throw new Error("Test account card repeats the environment already shown by its parent heading");
  }
  const accountAccordionLayout = await accountEnvironmentGroup.evaluate((node) => {
    const body = node.querySelector(":scope > .urlTreeChildren");
    const row = body?.querySelector(".listRow");
    return {
      nodeHeight: Math.round(node.getBoundingClientRect().height),
      bodyHeight: Math.round(body?.getBoundingClientRect().height || 0),
      rowHeight: Math.round(row?.getBoundingClientRect().height || 0),
      overflowY: body ? getComputedStyle(body).overflowY : "",
    };
  });
  if (accountAccordionLayout.bodyHeight < accountAccordionLayout.rowHeight || !["auto", "visible"].includes(accountAccordionLayout.overflowY)) {
    throw new Error(`Relational accordion clipped its rows: ${JSON.stringify(accountAccordionLayout)}`);
  }
  await options.screenshot({ path: resolve(evidencePath, "extension-options-test-accounts-deduplicated.png"), fullPage: true });
  await options.locator('[data-workspace-nav="payments"]').click();
  await options.locator('[data-open-composer="paymentMethodTypeComposer"]').click();
  await options.locator("#paymentMethodTypeName").fill("Voucher");
  await options.locator("#paymentMethodTypeForm button[type=submit]").click();
  await options.locator('[data-open-composer="paymentMethodComposer"]').click();
  await options.locator('#paymentMethodScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator('#paymentMethodScopePicker [data-facet-panel="environmentIds"] label', { hasText: "QA" }).last().locator("input").check();
  await options.locator('#paymentMethodScopePicker [data-facet-trigger="environmentIds"]').click();
  await options.locator("#paymentMethodLabel").fill("Visa sandbox");
  await options.locator("#paymentMethodTypeId").selectOption({ label: "Voucher" });
  await options.locator("#paymentMethodValue").fill("4242424242424242");
  await options.locator("#paymentMethodForm button[type=submit]").click();
  const reusableCatalogResult = await options.evaluate(async () => {
    const ws = await window.QTS_STORAGE.getWorkspace();
    const accountType = ws.accountTypes.find((item) => item.name === "Administrador");
    const paymentType = ws.paymentMethodTypes.find((item) => item.name === "Voucher");
    return {
      accountLinked: Boolean(accountType) && ws.testAccounts.some((item) => item.label === "Conta sandbox" && item.accountTypeId === accountType.id),
      paymentLinked: Boolean(paymentType) && ws.paymentMethods.some((item) => item.label === "Visa sandbox" && item.typeId === paymentType.id),
    };
  });
  if (!reusableCatalogResult.accountLinked || !reusableCatalogResult.paymentLinked) throw new Error(`Reusable account/payment catalogs were not persisted and linked: ${JSON.stringify(reusableCatalogResult)}`);
  trace("account and payment type catalogs verified (CRUD, reusable relation, persisted)");

  // Dispositivo catalog: a device can pick freely from several operating systems AND several
  // browsers (checkboxes, not a single select) - exercise a quick-add mid-form plus a
  // pre-seeded default to confirm both paths land in the persisted record.
  await options.locator('[data-workspace-nav="devices"]').click();
  await options.locator('[data-open-composer="deviceComposer"]').click();
  await options.locator("#deviceLabel").fill("Notebook QA");
  await options.locator('[data-quick-add-type="operatingSystem"]').click();
  await options.locator("#operatingSystemComposer[open]").waitFor();
  await options.locator("#operatingSystemName").fill("ChromeOS");
  await options.locator("#operatingSystemForm button[type=submit]").click();
  if (await options.locator("#operatingSystemComposer[open]").count()) throw new Error("Operating system composer did not close after saving");
  if (!(await options.locator('#deviceOperatingSystems input[value^="operatingSystem_"]').evaluateAll((inputs) => inputs.some((input) => input.checked)))) throw new Error("Quick-added operating system was not checked back into the device form");
  await options.locator('#deviceBrowsers label', { hasText: "Chrome" }).locator("input").check();
  await options.locator("#deviceForm button[type=submit]").click();
  await options.screenshot({ path: resolve(evidencePath, "extension-options-device-catalog.png"), fullPage: true });
  const deviceResult = await options.evaluate(async () => {
    const ws = await window.QTS_STORAGE.getWorkspace();
    const device = ws.devices.find((item) => item.label === "Notebook QA");
    return {
      hasChromeOs: Boolean(device) && device.operatingSystemIds.some((id) => ws.operatingSystems.find((entry) => entry.id === id)?.name === "ChromeOS"),
      hasChromeBrowser: Boolean(device) && device.browserIds.includes("browser_chrome"),
    };
  });
  if (!deviceResult.hasChromeOs || !deviceResult.hasChromeBrowser) throw new Error(`Device did not persist its N:N system/browser picks: ${JSON.stringify(deviceResult)}`);
  await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    root?.getElementById("drawerClose")?.click();
    root?.getElementById("toolsButton")?.click();
    root?.getElementById("reportBuilderMenuItem")?.click();
  });
  const deviceReportOption = host.locator('[data-report-device] option', { hasText: "Notebook QA" });
  await deviceReportOption.waitFor({ state: "attached" });
  const deviceReportOptionText = await deviceReportOption.textContent();
  if (!deviceReportOptionText.includes("ChromeOS") || !deviceReportOptionText.includes("Chrome")) {
    throw new Error(`Report device option omitted its system/browser configuration: ${deviceReportOptionText}`);
  }
  await host.locator("#drawerClose").click();
  trace("device catalog verified (N:N operating systems + browsers, quick-add, persisted)");

  await options.locator('[data-workspace-nav="integrations"]').click();
  await options.locator('[data-open-composer="inspectorComposer"]').click();
  await options.locator("#inspectorLabel").fill("Checkout Inspector");
  await options.locator('[data-inspector-pattern="*/api/*"]').click();
  await options.locator('[data-inspector-pattern="*/checkout/*"]').click();
  if ((await options.locator("#inspectorPatterns").inputValue()).split("\n").filter(Boolean).length !== 2) throw new Error("Inspector quick patterns did not populate one pattern per line");
  await options.locator("#inspectorForm button[type=submit]").click();
  if (await options.locator("#inspectorList .inspectorPatternPill").count() !== 2) throw new Error("Inspector list did not render its endpoint patterns");
  await options.locator('[data-open-composer="apiComposer"]').click();
  await options.locator("#apiLabel").fill("API Demo");
  await options.locator("#apiBaseUrl").fill("https://api.example.com");
  await options.locator("#apiToken").fill("local-api-token-value");
  await options.locator("#apiForm button[type=submit]").click();
  await options.locator('[data-open-composer="resourceComposer"]').click();
  await options.locator("#resourceLabel").fill("Runbook QA");
  await options.locator("#resourceUrl").fill("https://example.com/runbook");
  await options.locator("#resourceForm button[type=submit]").click();
  await options.screenshot({ path: resolve(evidencePath, "extension-options-inspectors.png"), fullPage: true });

  const paymentDrawer = await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    root?.getElementById("toolsButton")?.click();
    root?.getElementById("paymentMethodsMenuItem")?.click();
    return root?.getElementById("drawerBody")?.textContent || "";
  });
  if (!paymentDrawer.includes("Visa sandbox") || !paymentDrawer.includes("4242") || paymentDrawer.includes("4242424242424242")) throw new Error(`Payment method drawer did not stay masked: ${paymentDrawer}`);
  const [paymentSettingsComposerPage] = await Promise.all([
    context.waitForEvent("page"),
    host.locator('[data-add-workspace-item="paymentMethod"]').click(),
  ]);
  await paymentSettingsComposerPage.waitForLoadState("domcontentloaded");
  await paymentSettingsComposerPage.locator('[data-panel="workspace"].isActive').waitFor({ timeout: 10_000 });
  await paymentSettingsComposerPage.locator('[data-workspace-pane="payments"].isActive').waitFor();
  await paymentSettingsComposerPage.locator("#paymentMethodComposer[open]").waitFor();
  if (!(await paymentSettingsComposerPage.locator("#paymentMethodScopePicker, #paymentMethodTypeId, #paymentMethodIcon").count() >= 3)) {
    throw new Error("Sidebar Add did not open the original complete payment form from Settings");
  }
  await paymentSettingsComposerPage.close();
  const resourcesDrawer = await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    root?.getElementById("drawerClose")?.click();
    root?.getElementById("toolsButton")?.click();
    root?.getElementById("resourcesMenuItem")?.click();
    return { text: root?.getElementById("drawerBody")?.textContent || "", href: root?.getElementById("drawerBody")?.querySelector("a")?.href || "" };
  });
  const resourceUrl = new URL(resourcesDrawer.href);
  if (!resourcesDrawer.text.includes("Runbook QA") || resourceUrl.protocol !== "https:" || resourceUrl.hostname !== "example.com" || resourceUrl.pathname !== "/runbook") throw new Error(`Resources drawer mismatch: ${JSON.stringify(resourcesDrawer)}`);
  await context.route("https://example.com/assets/workspace-icon.png", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XkWPWQAAAABJRU5ErkJggg==", "base64"),
  }));
  const imageRoundTripFixture = await options.evaluate(async () => {
    const ws = await window.QTS_STORAGE.getWorkspace();
    const uploadedImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XkWPWQAAAABJRU5ErkJggg==";
    const remoteImage = "https://example.com/assets/workspace-icon.png";
    const setFirst = (collection, field, value) => {
      if (ws[collection]?.[0]) ws[collection][0][field] = value;
    };
    setFirst("clients", "logoUrl", uploadedImage);
    setFirst("projects", "logoUrl", remoteImage);
    setFirst("products", "logoUrl", uploadedImage);
    setFirst("accountTypes", "icon", remoteImage);
    setFirst("paymentMethodTypes", "icon", uploadedImage);
    setFirst("operatingSystems", "icon", remoteImage);
    setFirst("browsers", "icon", uploadedImage);
    setFirst("paymentMethods", "icon", remoteImage);
    setFirst("resources", "icon", uploadedImage);
    for (const type of ws.accountTypes || []) type.icon = remoteImage;
    for (const type of ws.paymentMethodTypes || []) type.icon = uploadedImage;
    const accountType = ws.accountTypes?.[0];
    for (const account of ws.testAccounts || []) {
      account.accountTypeImage = remoteImage;
    }
    await window.QTS_STORAGE.saveWorkspace(ws);
    return { uploadedImage, remoteImage, accountTypeId: accountType?.id };
  });
  await options.locator('[data-tab="workspace"]').click();
  await options.locator('[data-workspace-nav="accounts"]').click();
  await options.locator('[data-relational-view="testAccounts"][data-relational-dimension="type"]').click();
  const accountTypeGroupImage = options.locator(`#testAccountList .relationalDataNode .urlTreeIdentity img[src="${imageRoundTripFixture.remoteImage}"]`);
  if (!await accountTypeGroupImage.count()) throw new Error("Test account grouping by type did not reuse the registered type image");
  const accountCatalogImageMetrics = await options.locator("#accountTypeList .catalogTypeName img").first().evaluate((image) => {
    const rect = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    return { width: Math.round(rect.width), height: Math.round(rect.height), marginRight: Number.parseFloat(style.marginRight) };
  });
  if (accountCatalogImageMetrics.width !== 44 || accountCatalogImageMetrics.height !== 44 || accountCatalogImageMetrics.marginRight < 8) {
    throw new Error(`Account type image is not 44px with comfortable spacing: ${JSON.stringify(accountCatalogImageMetrics)}`);
  }
  await options.locator('[data-workspace-nav="payments"]').click();
  const paymentSettingsImages = options.locator("#paymentMethodTypeList .catalogTypeName img, #paymentMethodList .catalogTypeIcon");
  if (await paymentSettingsImages.count() < 2) throw new Error("Payment type images are missing from the Settings catalog or payment list");
  const paymentSettingsImageSize = await paymentSettingsImages.first().evaluate((image) => Math.round(image.getBoundingClientRect().width));
  if (paymentSettingsImageSize !== 44) throw new Error(`Payment type image in Settings is not 44px: ${paymentSettingsImageSize}`);
  await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    root?.getElementById("drawerClose")?.click();
    root?.getElementById("toolsButton")?.click();
    root?.getElementById("testAccountsMenuItem")?.click();
  });
  await host.locator("#testAccountsListBody .qts-catalog-image").first().waitFor();
  const sidebarAccountImageMetrics = await host.locator("#testAccountsListBody .qts-catalog-image").first().evaluate((image) => {
    const rect = image.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  if (sidebarAccountImageMetrics.width !== 44 || sidebarAccountImageMetrics.height !== 44) {
    throw new Error(`Account type image is missing or incorrectly sized in the sidebar: ${JSON.stringify(sidebarAccountImageMetrics)}`);
  }
  await host.evaluate(() => {
    const root = document.querySelector("#qts-toolbar-host")?.shadowRoot;
    root?.getElementById("drawerClose")?.click();
    root?.getElementById("toolsButton")?.click();
    root?.getElementById("paymentMethodsMenuItem")?.click();
  });
  await host.locator("#drawerBody .qts-net-item .qts-catalog-image").first().waitFor();
  if (await host.locator("#drawerBody .qts-net-item .qts-catalog-image").first().evaluate((image) => Math.round(image.getBoundingClientRect().width)) !== 44) {
    throw new Error("Payment type image is missing or incorrectly sized in the sidebar");
  }
  await options.getByRole("button", { name: "Importar / Exportar" }).click();
  const downloadPromise = options.waitForEvent("download");
  await options.locator("#exportButton").click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), "utf8");
  for (const secret of ["local-password-value", "4242424242424242", "local-api-token-value"]) if (exported.includes(secret)) throw new Error("Secure export leaked a local secret");
  const exportedPayload = JSON.parse(exported);
  if (!/^sha256:[a-f0-9]{64}$/i.test(exportedPayload.checksum || "")) throw new Error("Secure export did not include an integrity checksum");
  const imageFields = [
    exportedPayload.workspace.clients?.[0]?.logoUrl,
    exportedPayload.workspace.projects?.[0]?.logoUrl,
    exportedPayload.workspace.products?.[0]?.logoUrl,
    exportedPayload.workspace.accountTypes?.[0]?.icon,
    exportedPayload.workspace.paymentMethodTypes?.[0]?.icon,
    exportedPayload.workspace.operatingSystems?.[0]?.icon,
    exportedPayload.workspace.browsers?.[0]?.icon,
    exportedPayload.workspace.paymentMethods?.[0]?.icon,
    exportedPayload.workspace.resources?.[0]?.icon,
  ];
  if (!imageFields.includes(imageRoundTripFixture.uploadedImage) || !imageFields.includes(imageRoundTripFixture.remoteImage) || imageFields.some((value) => !value)) {
    throw new Error("Workspace export did not preserve every uploaded and URL image field");
  }
  const normalizedImageFields = await options.evaluate((candidate) => {
    const normalized = window.QTS_STORAGE.normalizeWorkspace(candidate);
    return [
      normalized.clients?.[0]?.logoUrl,
      normalized.projects?.[0]?.logoUrl,
      normalized.products?.[0]?.logoUrl,
      normalized.accountTypes?.[0]?.icon,
      normalized.paymentMethodTypes?.[0]?.icon,
      normalized.operatingSystems?.[0]?.icon,
      normalized.browsers?.[0]?.icon,
      normalized.paymentMethods?.[0]?.icon,
      normalized.resources?.[0]?.icon,
    ];
  }, exportedPayload.workspace);
  if (!normalizedImageFields.includes(imageRoundTripFixture.uploadedImage) || !normalizedImageFields.includes(imageRoundTripFixture.remoteImage) || normalizedImageFields.some((value) => !value)) {
    throw new Error("Workspace import normalization did not restore every uploaded and URL image field");
  }
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
  if (!/workspace.*conclu/i.test(await options.locator("#tutorialStepDoneTitle").innerText())) throw new Error("Completion modal did not show the right Workspace step title");
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
  const faqText = await options.locator('[data-panel="faq"]').innerText();
  for (const expected of ["Workspace", "aparência", "Inspectors", "APIs", "recursos", "importar", "exportar"]) {
    if (!faqText.toLocaleLowerCase("pt-BR").includes(expected.toLocaleLowerCase("pt-BR"))) throw new Error(`FAQ is missing onboarding guidance for ${expected}`);
  }
  await options.locator(".faqGroupAccordion[open] .faqAccordion[open] .faqAnswer img").first().dispatchEvent("click");
  await options.locator("#imageLightbox:not([hidden])").waitFor();
  if (!(await options.locator("#imageLightboxImg").getAttribute("src"))) throw new Error("Image lightbox did not load the clicked screenshot");
  await options.locator("#imageLightboxClose").click();
  if (!(await options.locator("#imageLightbox").isHidden())) throw new Error("Image lightbox did not close");
  await options.locator("#faqCollapseAll").click();
  if (await options.locator(".faqAccordion[open]").count() !== 0) throw new Error("Recolher tudo did not close every FAQ entry");
  trace("FAQ accordions + image lightbox verified");

  // Live tutorial tour: same overlay code path as the real demo-site launch (background.js only
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
  const pagesBeforeSettingsHandoff = new Set(context.pages());
  const activeTourSkip = host.locator(".qts-tour-balloon:visible [data-tour-skip]");
  if (await activeTourSkip.count() !== 1) throw new Error("Expected exactly one visible live-tour skip action");
  // Dispatch on the resolved tour control itself. A coordinate click can race the pulsing overlay's
  // reflow and land on the Settings icon underneath, producing a plain options tab instead.
  await activeTourSkip.evaluate((button) => button.click());
  let workspaceTabAfterSkip = null;
  for (let attempt = 0; attempt < 100 && !workspaceTabAfterSkip; attempt += 1) {
    await host.waitForTimeout(100);
    for (const page of context.pages().filter((candidate) => !pagesBeforeSettingsHandoff.has(candidate))) {
      if (await page.locator('[data-panel="workspace"].isActive').count().catch(() => 0)) {
        workspaceTabAfterSkip = page;
        break;
      }
    }
  }
  if (!workspaceTabAfterSkip) {
    const opened = context.pages().filter((page) => !pagesBeforeSettingsHandoff.has(page)).map((page) => page.url());
    throw new Error(`Pular tutorial did not open the active Workspace settings tour: ${opened.join(", ") || "no new page"}`);
  }
  await workspaceTabAfterSkip.waitForLoadState("domcontentloaded");
  trace(`settings tour handoff opened ${workspaceTabAfterSkip.url()}`);
  trace(`settings tour handoff panels: ${await workspaceTabAfterSkip.locator("[data-panel]").evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("data-panel")}:${node.className}`).join(", "))}`);
  await workspaceTabAfterSkip.locator('[data-panel="workspace"].isActive').waitFor({ timeout: 10_000 });
  await workspaceTabAfterSkip.close();
  if (await host.locator(".qts-tour-balloon").count()) throw new Error("Pular tutorial did not close the live tour overlay");
  trace("live tutorial tour verified (spotlight, step advance, achievement sound, skip-to-workspace)");

  // Menu tools use a deliberate two-stage tour: the user first opens Tools, then the requested
  // item is highlighted. Use an item below the eight-row visible area to prove the compact menu
  // scrolls before spotlight geometry is measured. Opening its drawer must remove the page dim
  // and retain contextual help.
  await host.goto("http://127.0.0.1:43117/app?qtsTutorial=1&qtsTutorialStep=paymentMethods");
  await toolbar.waitFor({ timeout: 10_000 });
  await host.locator(".qts-tour-balloon b").filter({ hasText: /Ferramentas|Tools|Herramientas/ }).waitFor();
  if (await host.locator("#toolsMenu.isOpen").count()) throw new Error("Tool tour opened Tools before the user action");
  await host.locator("#toolsButton").click();
  await host.locator("#paymentMethodsMenuItem").waitFor({ state: "visible" });
  await host.locator(".qts-tour-balloon b").filter({ hasText: /Meios de pagamento|Payment methods|Medios de pago/ }).waitFor();
  const scrolledToolTourGeometry = await host.locator("#qts-toolbar-host").evaluate((element) => {
    const shadow = element.shadowRoot;
    const menu = shadow.querySelector("#toolsMenu");
    const target = shadow.querySelector("#paymentMethodsMenuItem");
    const spotlight = shadow.querySelector(".qts-tour-spotlight");
    const menuRect = menu.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const spotlightRect = spotlight.getBoundingClientRect();
    return {
      scrollTop: menu.scrollTop,
      targetInsideMenu: targetRect.top >= menuRect.top && targetRect.bottom <= menuRect.bottom,
      spotlightContainsTarget: spotlightRect.left <= targetRect.left
        && spotlightRect.top <= targetRect.top
        && spotlightRect.right >= targetRect.right
        && spotlightRect.bottom >= targetRect.bottom,
    };
  });
  if (scrolledToolTourGeometry.scrollTop <= 0 || !scrolledToolTourGeometry.targetInsideMenu || !scrolledToolTourGeometry.spotlightContainsTarget) {
    throw new Error(`Tour did not scroll and align a clipped Tools item before highlighting it: ${JSON.stringify(scrolledToolTourGeometry)}`);
  }
  await host.locator("#paymentMethodsMenuItem").click();
  await host.locator("#drawerHost .qts-drawer").waitFor();
  await host.locator(".qts-tour-balloon").filter({ hasText: /ferramenta está aberta|tool is open|herramienta está abierta/i }).waitFor();
  if (await host.locator(".qts-tour-spotlight").count()) throw new Error("Tour kept the dimming spotlight over an open tool drawer");
  await host.locator("[data-tour-skip]").click();
  trace("two-stage Tools tour + drawer contextual help verified");

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
  const allowedDemoHosts = new Set(["matteusbonotto.github.io"]);
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
  const settingsTourTitles = [];
  for (let guard = 0; guard < 30 && await options.locator(".settingsTourBalloon").count(); guard += 1) {
    settingsTourTitles.push(await options.locator(".settingsTourBalloon b").innerText());
    await options.locator("#settingsTourNext").click();
  }
  if (await options.locator(".settingsTourBalloon").count()) throw new Error("Settings tour did not finish");
  const settingsCoverage = settingsTourTitles.join(" | ");
  for (const expected of ["Tema", "cliente", "projeto", "produto", "ambiente", "URL", "Contas", "pagamento", "Dispositivos", "Inspectors", "APIs", "recursos", "Exportar", "Importar", "Tutorial", "FAQ"]) {
    if (!settingsCoverage.toLocaleLowerCase("pt-BR").includes(expected.toLocaleLowerCase("pt-BR"))) throw new Error(`Settings tour is missing ${expected}: ${settingsCoverage}`);
  }
  if (settingsTourTitles.length < 18) throw new Error(`Settings tour is too short: ${settingsTourTitles.length}`);
  trace("complete settings/workspace CRUD tour verified");

  // Onboarding wizard: a guided Cliente -> Projeto -> Produto -> Ambiente -> URLs flow (plus 3
  // skippable optional steps) that writes through the exact same workspace.X.push() +
  // persistWorkspace() path as every flat CRUD tab - verify it actually reaches storage, not just
  // that the dialog opens.
  await options.getByRole("button", { name: "Workspace", exact: true }).click();
  await options.locator("#openOnboardingWizard").click();
  await options.locator("#onboardingWizard[open]").waitFor();
  if (await options.locator("#onboardingWizard .wizardRail").count() !== 1) throw new Error("Onboarding wizard is missing its persistent navigation rail");
  await options.locator("#wizardEntityInput").fill("Cliente Smoke Wizard");
  await options.locator("#wizardEntityAdd").click();
  await options.locator("#wizardSuccessContinue").click();
  await options.locator("#wizardEntityInput").fill("Projeto Smoke Wizard");
  await options.locator("#wizardEntityAdd").click();
  await options.locator("#wizardSuccessContinue").click();
  await options.locator("#wizardEntityInput").fill("Produto Smoke Wizard");
  await options.locator("#wizardEntityAdd").click();
  await options.locator("#wizardSuccessContinue").click();
  await options.locator("#wizardEnvName").fill("QA Smoke Wizard");
  await options.locator("#wizardEnvColor").fill("#33d6b0");
  await options.locator("#wizardEnvAdd").click();
  await options.locator("#wizardSuccessContinue").click();
  await options.locator("#wizardUrlPattern").fill("https://app.smoke-wizard-teste.com/*");
  await options.locator("#wizardUrlAdd").click();
  await options.locator("#wizardSuccessContinue").click();
  if (await options.locator(".wizardOptionalFact").count() !== 3) throw new Error("Accounts step is missing its field and relation guidance");
  if (await options.locator('[data-wizard-open-composer="testAccountComposer"]').innerText() !== "Preencher formulário") throw new Error("Accounts step has no explicit form action");
  // Optional step: exercise the CSV import path, not just "Adicionar agora"/Pular.
  await options.locator('[data-wizard-csv="testAccounts"]').click();
  await options.locator("#wizardCsvInput-testAccounts").fill("label,username,password,notes\nConta Smoke CSV,csv-smoke@exemplo.com,SenhaCsv1,Importada via smoke test");
  await options.locator('[data-wizard-csv-submit="testAccounts"]').click();
  if (!(await options.locator("#wizardCsvMessage-testAccounts").innerText()).includes("1")) throw new Error("Wizard CSV import did not report 1 imported row");
  await options.locator("#onboardingWizardSkip").click();
  await options.locator("#onboardingWizardSkip").click();
  await options.locator("#onboardingWizardSkip").click();
  await options.locator("#onboardingWizardNext").click();
  if (await options.locator("#onboardingWizard[open]").count()) throw new Error("Onboarding wizard did not close after the last step");
  const wizardResult = await options.evaluate(async () => {
    const created = await window.QTS_STORAGE.getWorkspace();
    return {
      client: created.clients.some((item) => item.name === "Cliente Smoke Wizard"),
      project: created.projects.some((item) => item.name === "Projeto Smoke Wizard"),
      product: created.products.some((item) => item.name === "Produto Smoke Wizard"),
      environment: created.environments.some((item) => item.name === "QA Smoke Wizard" && item.color === "#33d6b0"),
      url: created.urlBindings.some((binding) => (binding.patterns || []).some((pattern) => pattern.includes("smoke-wizard-teste"))),
      csvAccount: created.testAccounts.some((account) => account.label === "Conta Smoke CSV" && account.username === "csv-smoke@exemplo.com"),
    };
  });
  if (Object.values(wizardResult).some((value) => value !== true)) throw new Error(`Onboarding wizard did not persist everything it created: ${JSON.stringify(wizardResult)}`);
  trace("onboarding wizard verified (Cliente->Projeto->Produto->Ambiente->URLs, optional step CSV import, all persisted)");

  await options.getByRole("button", { name: "Minha conta" }).click();
  await options.locator("#signOutButton").click();
  await host.locator("#qts-toolbar-host").waitFor({ state: "detached", timeout: 5_000 });
  await options.waitForFunction(() => document.querySelector('.protectedNav[data-tab="workspace"]')?.disabled === true);
  if (await host.locator("#qts-toolbar-host").count()) throw new Error("Toolbar remained after logout");
  if (!await options.locator('.protectedNav[data-tab="workspace"]').isDisabled()) throw new Error("Protected settings remained enabled after logout");

  if (hostErrors.length || optionsErrors.length || workerErrors.length) throw new Error(`Console errors:\n${[...hostErrors, ...optionsErrors, ...workerErrors].join("\n")}`);
  console.log(JSON.stringify({ extensionId, unauthenticatedBlocked: true, authenticatedWorkspace: true, optionsI18nPtEsEn: true, workspaceStudioTabs: true, relationalUrls: true, searchableEnvironmentMultiselect: true, imageEditor: true, hierarchyAndUrl: true, soundEffectsRequested: true, responsiveViewCentered: true, keyViewSvgShortcuts: true, keyViewSizes: true, keyViewTypingProtected: true, keyViewMouseEffects: true, characterCounter: true, elementCaptureCsvSafe: true, fakerFillProtected: true, inputLab: true, multiClick: true, stepsRecorderSecureCsv: true, stepsRecorderPauseAndGherkin: true, macroRecordReplay: true, macroVibeCoder: true, macroImportExportPin: true, macroNavigationResume: true, compactModePerEntity: true, environmentEditReactive: true, spaReactive: true, paymentMethodsMasked: true, resourcesVisible: true, secureExport: true, tutorialGamification: true, tutorialProgressPersisted: true, faqAccordions: true, liveTutorialTour: true, tutorialStartButton: true, logoutRemovesToolbar: true, consoleErrors: 0, workerErrors: 0 }));
} finally {
  clearTimeout(smokeWatchdog);
  await context.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
