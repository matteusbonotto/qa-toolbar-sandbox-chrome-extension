// Opens a real, visible Chrome window with apps/extension/ loaded unpacked — the same
// launch mechanism scripts/smoke-extension.mjs uses (chromium.launchPersistentContext with
// --load-extension), minus the scripted test steps. Unlike the smoke test, this profile is
// NOT wiped between runs, so a login session and workspace you set up here survive across
// `npm run dev:extension` calls, and no network route is faked: the extension talks to the
// real backend, exactly like an end user's Chrome would.
//
// Exits automatically when you close the Chrome window.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "apps/extension");
const profilePath = resolve(root, "artifacts/chrome-dev-profile");
await mkdir(profilePath, { recursive: true });

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

let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
const extensionId = new URL(worker.url()).host;

console.log(`Extensão carregada a partir de ${extensionPath}`);
console.log(`ID local da extensão: ${extensionId}`);
console.log(`Inspecionar service worker: chrome://inspect/#service-workers (ou chrome://extensions com "service worker" clicável)`);
console.log(`Perfil persistente em: ${profilePath} (login e workspace sobrevivem entre execuções; apague a pasta para recomeçar do zero)`);
console.log("Feche a janela do Chrome para encerrar este comando.");

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(`chrome://extensions/?id=${extensionId}`).catch(() => {});

await new Promise((resolveClosed) => context.on("close", resolveClosed));
