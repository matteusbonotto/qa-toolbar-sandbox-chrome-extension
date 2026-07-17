import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ALLOWED_FILES = [/^manifest\.json$/, /^icons\/[a-z0-9._-]+\.png$/i, /^src\/[a-z0-9_./-]+\.(?:js|css|html)$/i];
const FORBIDDEN_NAMES = /(^|\/)(?:\.env(?:\..*)?|manifest\.key|node_modules|fixtures?|tests?|artifacts?|.*\.(?:map|pem|key|p12|pfx|sqlite|log))($|\/)/i;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
  /\bsb_secret_[A-Za-z0-9._-]{16,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/,
];

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(fullPath));
    else if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

export async function verifyExtensionSource(sourceDirectory) {
  const source = resolve(sourceDirectory);
  const allFiles = await walk(source);
  const packageCandidates = allFiles.map((file) => ({ file, entry: relative(source, file).split(sep).join("/") }))
    .filter(({ entry }) => entry === "manifest.json" || entry.startsWith("icons/") || entry.startsWith("src/"));
  const files = packageCandidates.map(({ file }) => file);
  const entries = packageCandidates.map(({ entry }) => entry);
  if (!entries.includes("manifest.json")) throw new Error("Extension package is missing manifest.json");
  if (entries.some((entry) => FORBIDDEN_NAMES.test(entry) || !ALLOWED_FILES.some((pattern) => pattern.test(entry)))) {
    throw new Error(`Extension package contains a non-whitelisted file: ${entries.find((entry) => FORBIDDEN_NAMES.test(entry) || !ALLOWED_FILES.some((pattern) => pattern.test(entry)))}`);
  }

  let totalBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const info = await stat(files[index]);
    totalBytes += info.size;
    if (info.size > 2_000_000) throw new Error(`Extension file is unexpectedly large: ${entries[index]}`);
    if (!/\.(?:js|css|html|json)$/i.test(entries[index])) continue;
    const text = await readFile(files[index], "utf8");
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) throw new Error(`Secret-like value found in extension source: ${entries[index]}`);
  }
  if (totalBytes > 8_000_000) throw new Error("Extension package exceeds the 8 MB source safety limit");

  const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3 || manifest.key) throw new Error("Manifest must be MV3 and must not contain manifest.key");
  return { files: entries.length, totalBytes, version: manifest.version };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const sourceArg = process.argv.find((argument) => argument.startsWith("--source="))?.slice("--source=".length);
  const report = await verifyExtensionSource(resolve(sourceArg || "apps/extension"));
  console.log(`Extension bundle security check passed (v${report.version}; ${report.files} files; ${(report.totalBytes / 1024).toFixed(1)} KB source).`);
}
