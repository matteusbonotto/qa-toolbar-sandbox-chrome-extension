import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extensionPackage = JSON.parse(await readFile(join(root, "apps/extension/package.json"), "utf8"));
const source = join(root, "apps/extension/.output", `${extensionPackage.name.replace("@qts/", "qts")}-${extensionPackage.version}-chrome.zip`);
const artifacts = join(root, "artifacts");
const destination = join(artifacts, `qa-toolbar-sandbox-v${extensionPackage.version}-chrome-store.zip`);

await mkdir(artifacts, { recursive: true });
await copyFile(source, destination);
const digest = createHash("sha256").update(await readFile(destination)).digest("hex");
await writeFile(`${destination}.sha256`, `${digest}  ${basename(destination)}\n`, "utf8");

console.log(`Chrome Web Store package ready: ${destination}`);
console.log(`SHA-256: ${digest}`);
