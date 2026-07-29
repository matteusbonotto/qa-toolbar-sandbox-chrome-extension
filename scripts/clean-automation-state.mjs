import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";

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

for (const target of targets) {
  const insideRoot = relative(root, target);
  if (!insideRoot || insideRoot.startsWith("..") || resolve(root, insideRoot) !== target) {
    throw new Error(`Refusing to clean unsafe automation path: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
  console.log(`[automation-clean] removed ${insideRoot}`);
}

console.log("[automation-clean] temporary Chrome profiles, generated extension and web builds are clean");
