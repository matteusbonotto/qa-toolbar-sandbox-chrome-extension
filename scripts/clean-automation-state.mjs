import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const targets = [
  "artifacts/chrome-smoke-profile",
  "artifacts/chrome-test-profile",
  "artifacts/extension-test",
  "artifacts/runtime-evidence",
  "apps/landing/dist",
  "apps/admin/dist",
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
