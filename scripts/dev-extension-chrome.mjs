// Opens a real, visible Chrome window with apps/extension/ loaded unpacked — the same
// launch mechanism scripts/smoke-extension.mjs uses (chromium.launchPersistentContext with
// --load-extension), minus the scripted test steps. Unlike the smoke test, this profile is
// NOT wiped between runs, so a login session and workspace you set up here survive across
// `npm run dev:extension` calls, and no network route is faked: the extension talks to the
// real backend, exactly like an end user's Chrome would.
//
// Exits automatically when you close the Chrome window.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const profilePath = resolve(root, argument("profile-path") || "artifacts/chrome-dev-profile");
await mkdir(profilePath, { recursive: true });

// The production Edge Functions only accept calls from allowlisted extension IDs (store item and the
// manual-install package; ALLOWED_EXTENSION_IDS). A plain unpacked load gets a path-derived ID that
// the server rejects ("instalação local não autorizada"), which made manual testing against the real
// backend impossible. So, unless an explicit --extension-path is given, this loads a SNAPSHOT copy
// of apps/extension carrying the manual-install package's manifest key, i.e. the same allowlisted ID
// (piiiagolpefgheemlppmnpoiniddibjd). The snapshot also means editing the source while testing
// never changes the running extension; rerun the command to pick up new code.
let extensionPath = argument("extension-path") ? resolve(root, argument("extension-path")) : "";
if (!extensionPath) {
  extensionPath = resolve(root, "artifacts/extension-dev");
  await rm(extensionPath, { recursive: true, force: true });
  await cp(resolve(root, "apps/extension"), extensionPath, { recursive: true });
  const sideloadSource = await readFile(resolve(root, "scripts/package-extension-sideload.mjs"), "utf8");
  const sideloadKey = /const SIDELOAD_MANIFEST_KEY = "([^"]+)";/.exec(sideloadSource)?.[1];
  if (!sideloadKey) throw new Error("Could not read SIDELOAD_MANIFEST_KEY from scripts/package-extension-sideload.mjs");
  const manifestPath = resolve(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, key: sideloadKey }, null, 2)}
`);
}

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
