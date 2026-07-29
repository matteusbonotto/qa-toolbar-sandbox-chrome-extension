import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const targets = [
  "artifacts/chrome-smoke-profile",
  "artifacts/chrome-test-profile",
  "artifacts/visual-audit-profile",
  "artifacts/extension-test",
  "artifacts/runtime-evidence",
  "apps/landing/dist",
  "apps/admin/dist",
  // A previous Windows automation command concatenated the absolute workspace path after
  // stripping its separators and created a second artifacts tree inside the repository root.
  // Keep this explicit target until every existing checkout has been cleaned.
  "Usersmatheus.bonottoDocumentsgithubqa-toolbar-sandbox-chrome-extension",
].map((path) => resolve(root, path));

const disposableChromeProfiles = targets.slice(0, 3);
if (process.platform === "win32") {
  const command = [
    "$qtsProfiles = $env:QTS_AUTOMATION_PROFILE_PATHS -split '\\|';",
    "Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" |",
    "Where-Object { $qtsCommand = $_.CommandLine; $qtsProfiles | Where-Object { $qtsCommand -like ('*' + $_ + '*') } } |",
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join(" ");
  const stopped = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...process.env, QTS_AUTOMATION_PROFILE_PATHS: disposableChromeProfiles.join("|") },
    encoding: "utf8",
  });
  if (stopped.status !== 0) throw new Error(`Failed to stop disposable Chrome profiles: ${stopped.stderr || stopped.stdout}`);
}

async function removeTarget(target) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 120 * (attempt + 1)));
    }
  }
  throw lastError;
}

for (const target of targets) {
  const insideRoot = relative(root, target);
  if (!insideRoot || insideRoot.startsWith("..") || resolve(root, insideRoot) !== target) {
    throw new Error(`Refusing to clean unsafe automation path: ${target}`);
  }
  await removeTarget(target);
  console.log(`[automation-clean] removed ${insideRoot}`);
}

console.log("[automation-clean] temporary Chrome profiles, generated extension and web builds are clean");
