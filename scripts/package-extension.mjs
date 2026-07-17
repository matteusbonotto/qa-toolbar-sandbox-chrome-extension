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
import { resolve } from "node:path";
import { createRequire } from "node:module";

const archiver = createRequire(import.meta.url)("archiver");

const root = resolve(import.meta.dirname, "..");
const extensionDir = resolve(root, "apps/extension");
const manifest = JSON.parse(await readFile(resolve(extensionDir, "manifest.json"), "utf8"));

const downloadsDir = resolve(homedir(), "Downloads");
await mkdir(downloadsDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outputPath = resolve(downloadsDir, `qa-toolbar-sandbox-extension-v${manifest.version}-${timestamp}.zip`);

const output = createWriteStream(outputPath);
const archive = archiver("zip", { zlib: { level: 9 } });

const done = new Promise((resolvePromise, rejectPromise) => {
  output.on("close", resolvePromise);
  archive.on("error", rejectPromise);
});

archive.pipe(output);
archive.file(resolve(extensionDir, "manifest.json"), { name: "manifest.json" });
archive.directory(resolve(extensionDir, "icons"), "icons");
archive.directory(resolve(extensionDir, "src"), "src");
await archive.finalize();
await done;

console.log(`Extension packaged (v${manifest.version}, ${(archive.pointer() / 1024).toFixed(1)} KB):`);
console.log(outputPath);
console.log("");
console.log("Como testar: descompacte o .zip, abra chrome://extensions, ative o Modo do desenvolvedor,");
console.log("clique em \"Carregar sem compactação\" e selecione a pasta descompactada.");
