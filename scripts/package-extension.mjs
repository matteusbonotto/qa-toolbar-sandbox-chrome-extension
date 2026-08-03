// Zips apps/extension/ into a .zip in the user's Downloads folder, so it's a one-command
// way to get a fresh build to drag into chrome://extensions ("Load unpacked" also works by
// pointing directly at apps/extension/ — this script exists for people who prefer/need a
// single portable file, e.g. to hand to someone else for manual testing).
//
// Only whitelisted paths are included (manifest.json, icons/, src/) rather than the whole
// directory tree, so stray local artifacts (node_modules/, .wxt/ left over from switching
// branches, editor files, etc.) never end up inside the package by accident.
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { verifyExtensionSource } from "./check-extension-bundle.mjs";
// archiver@8 is a full rewrite: CommonJS support is gone (package.json is now `"type": "module"`
// with a plain `"exports"` map, no `"main"`), and the old `archiver("zip", opts)` factory function
// is gone too — replaced by a `ZipArchive` class you construct directly. Everything else
// (.pipe/.append/.directory/.finalize/.pointer()) kept the same API.
import { ZipArchive } from "archiver";

const root = resolve(import.meta.dirname, "..");
const extensionDir = resolve(root, "apps/extension");
const manifest = JSON.parse(await readFile(resolve(extensionDir, "manifest.json"), "utf8"));
await verifyExtensionSource(extensionDir);

// manifest.json on disk keeps a localhost origin in externally_connectable so the Vite dev
// landing page (npm run dev:landing) can exercise the session-handoff flow during local
// development. That origin has no place in a package meant for real users - any page serving
// from that port on the user's machine could otherwise call chrome.runtime.sendMessage and
// overwrite the stored auth session - so it's stripped here, at packaging time, the same way
// package-extension-test.mjs already rewrites its own manifest before zipping.
const DEV_ORIGIN_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/)/i;
const productionManifest = JSON.parse(JSON.stringify(manifest));
if (Array.isArray(productionManifest.externally_connectable?.matches)) {
  productionManifest.externally_connectable.matches = productionManifest.externally_connectable.matches
    .filter((pattern) => !DEV_ORIGIN_PATTERN.test(pattern));
}
const manifestJson = `${JSON.stringify(productionManifest, null, 2)}\n`;

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outputArg = process.argv.find((argument) => argument.startsWith("--output="))?.slice("--output=".length);
const outputPath = outputArg
  ? resolve(root, outputArg)
  : resolve(homedir(), "Downloads", `qa-toolbar-sandbox-extension-v${manifest.version}-${timestamp}.zip`);
await mkdir(dirname(outputPath), { recursive: true });

const output = createWriteStream(outputPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

const done = new Promise((resolvePromise, rejectPromise) => {
  output.on("close", resolvePromise);
  archive.on("error", rejectPromise);
});

archive.pipe(output);
archive.append(manifestJson, { name: "manifest.json" });
archive.directory(resolve(extensionDir, "icons"), "icons");
archive.directory(resolve(extensionDir, "src"), "src");
await archive.finalize();
await done;

console.log(`Extension packaged (v${manifest.version}, ${(archive.pointer() / 1024).toFixed(1)} KB):`);
console.log(outputPath);
console.log("");
console.log("Como testar: descompacte o .zip, abra chrome://extensions, ative o Modo do desenvolvedor,");
console.log("clique em \"Carregar sem compactação\" e selecione a pasta descompactada.");
