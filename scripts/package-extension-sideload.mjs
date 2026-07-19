// Builds a SEPARATE distributable zip meant for the landing page's "Baixar extensão" fallback
// (manual "Load unpacked" install, for people who don't want to wait for Chrome Web Store review).
//
// Deliberately does NOT reuse package-extension.mjs / verifyExtensionSource: the Web Store
// manifest.json intentionally forbids a "key" field (see check-extension-bundle.mjs) so the
// Store-published package stays exactly what Google's review approved. This script clones that
// manifest and adds a "key" field ONLY in this separate artifact, so every unpacked install of
// this zip gets the same deterministic extension ID (piiiagolpefgheemlppmnpoiniddibjd) — instead
// of Chrome hashing the install path into a random ID per machine, which is what made the
// backend's ALLOWED_EXTENSION_IDS allowlist unworkable for arbitrary end-user downloads.
// The Web Store item keeps its own, separately-assigned ID regardless of this key.
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const archiver = createRequire(import.meta.url)("archiver");

const SIDELOAD_MANIFEST_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqEIIMro27Dtb7Z7rrDe/ug6rEExXrkTFY+nO4ZjYc3xqe6vbQ01PyJv3jeBmEc8lkF//yKz6bSbiDVwVVTp+VrSoJfcrJvAelsV6jT2nMo0TaAcnDZjAs1ECFZsdrQBZPgIC3TuQkaAW6xOBO+eVaOrUViSxUdYjM6pYQ4YS8R3QddeAaSBprFlkttBLX/XbdAQea8k5L46gMoDh6bHDdhEmHSdyMnmTXJ8Cl/8KEXD1Ir2zLRlwmy4ahY2sVj40VGFkoU19iCSva0jaCE9T1cb40p7U+sE+VkcgdZ9Dbqt+zSaZwNwYFHjWO9BZmyFlb0cgtGztF6MK3E93ml8c1wIDAQAB";

const root = resolve(import.meta.dirname, "..");
const extensionDir = resolve(root, "apps/extension");
const manifest = JSON.parse(await readFile(resolve(extensionDir, "manifest.json"), "utf8"));
const sideloadManifest = { ...manifest, key: SIDELOAD_MANIFEST_KEY };

const outputArg = process.argv.find((argument) => argument.startsWith("--output="))?.slice("--output=".length);
if (!outputArg) throw new Error("Usage: package-extension-sideload.mjs --output=<path>.zip");
const outputPath = resolve(root, outputArg);
await mkdir(dirname(outputPath), { recursive: true });

const output = createWriteStream(outputPath);
const archive = archiver("zip", { zlib: { level: 9 } });
const done = new Promise((resolvePromise, rejectPromise) => {
  output.on("close", resolvePromise);
  archive.on("error", rejectPromise);
});

archive.pipe(output);
archive.append(JSON.stringify(sideloadManifest, null, 2), { name: "manifest.json" });
archive.directory(resolve(extensionDir, "icons"), "icons");
archive.directory(resolve(extensionDir, "src"), "src");
await archive.finalize();
await done;

console.log(`Sideload extension package built (v${manifest.version}, ${(archive.pointer() / 1024).toFixed(1)} KB):`);
console.log(outputPath);
