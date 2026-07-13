import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { execFileSync } from "node:child_process";

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
const paths = listed.split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
const failures = [];

const forbiddenPaths = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.chrome-extension-id-profile(?:\/|$)/i,
  /(^|\/)(?:backup|export)(?:[-_.]|$)/i,
  /\.(?:pem|key|p12|pfx|crx|sqlite|sqlite3)$/i,
  /(^|\/)artifacts(?:\/|$)/i,
];

const allowedExamples = /(^|\/)\.env\.example$/i;
for (const path of paths) {
  if (!allowedExamples.test(path) && forbiddenPaths.some((pattern) => pattern.test(path))) {
    failures.push(`${path}: private or generated file must not be committed`);
  }
}

const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".zip"]);
const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[opsu]_[A-Za-z0-9]{30,})\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Stripe secret", /\b(?:sk_(?:live|test)|rk_live)_[A-Za-z0-9]{16,}\b/],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{16,}\b/],
  ["Supabase server secret", /\bsb_secret_[A-Za-z0-9_-]{16,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
];

const credentialAssignment = /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']([^"'\n]{8,})["']/gi;
const placeholder = /^(?:\[REDACTED\]|safe-|test-|example|placeholder|your-|random-|<|\$\(|Qts!\$\()/i;

for (const path of paths) {
  if (path === "scripts/check-repository.mjs" || binaryExtensions.has(extname(path).toLowerCase())) continue;
  const content = await readFile(path, "utf8").catch(() => "");
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) failures.push(`${path}: possible ${label}`);
  }
  if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path)) {
    for (const match of content.matchAll(credentialAssignment)) {
      if (!placeholder.test(match[1])) failures.push(`${path}: possible hard-coded credential`);
    }
  }
}

if (failures.length) {
  console.error("Repository security check failed:\n" + [...new Set(failures)].map((item) => `- ${item}`).join("\n"));
  console.error("Keep the value local, remove it from Git history, and rotate it if it was ever published.");
  process.exit(1);
}

console.log(`Repository security check passed (${paths.length} files inspected; ignored local files excluded).`);
