import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Reads the extension's own manifest at build time (Node context, not constrained by this app's
// own tsconfig `include`) so the LP can show the real package version without duplicating it by
// hand — a `define` global instead of a cross-package JSON import, which would need
// `apps/extension` inside this app's TS project scope.
const extensionManifestPath = fileURLToPath(new URL("../extension/manifest.json", import.meta.url));
const extensionVersion = JSON.parse(readFileSync(extensionManifestPath, "utf8")).version as string;

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
  },
  define: {
    __EXTENSION_PACKAGE_VERSION__: JSON.stringify(extensionVersion),
  },
});
