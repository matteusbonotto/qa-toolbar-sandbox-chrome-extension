import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = fileURLToPath(new URL("../apps/extension/.output/chrome-mv3/", import.meta.url));
const forbiddenPatterns = [
  /sk_(?:test|live)_[A-Za-z0-9]{12,}/,
  /sb_secret_[A-Za-z0-9_-]{12,}/,
  /service_role/i,
  /STRIPE_SECRET_KEY/,
  /APP_SUPABASE_SECRET_KEY/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:github_pat_|ghp_)[A-Za-z0-9_]{20,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
];

const forbiddenNames = /(^|[\\/])(?:\.env|\.git|docs?|scripts?|src|tests?)(?:[\\/]|$)|\.(?:map|ts|tsx|pem|key|p12|pfx|crx|log)$/i;

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }))).flat();
}

for (const path of await files(outputDirectory)) {
  if (forbiddenNames.test(path)) throw new Error(`Private, source, or debug file found in extension bundle: ${path}`);
  const content = await readFile(path, "utf8").catch(() => "");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) throw new Error(`Forbidden server secret marker found in extension bundle: ${path}`);
  }
}

const manifest = JSON.parse(await readFile(join(outputDirectory, "manifest.json"), "utf8"));
if ("key" in manifest) throw new Error("Chrome Web Store packages must not contain manifest.key; the store owns the item key");
if (manifest.host_permissions?.includes("<all_urls>")) throw new Error("Broad host permission is forbidden");
const forbiddenPermissions = ["debugger", "management", "nativeMessaging", "proxy", "downloads"];
for (const permission of forbiddenPermissions) {
  if (manifest.permissions?.includes(permission)) throw new Error(`Dangerous permission is forbidden: ${permission}`);
}
if (JSON.stringify(manifest).includes("unsafe-eval")) throw new Error("unsafe-eval is forbidden");
console.log("Extension bundle security check passed");
