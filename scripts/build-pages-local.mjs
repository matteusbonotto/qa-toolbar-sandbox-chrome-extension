import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.edge.local");
const local = Object.fromEntries(readFileSync(envPath, "utf8").split(/\r?\n/)
  .map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => { const separator = line.indexOf("="); return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]; }));
const supabaseUrl = process.env.VITE_SUPABASE_URL || local.VITE_SUPABASE_URL || local.SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || local.VITE_SUPABASE_PUBLISHABLE_KEY || local.APP_SUPABASE_PUBLIC_KEY;
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(supabaseUrl || "") || !publishableKey) {
  throw new Error("Public Pages configuration is unavailable in .env.edge.local.");
}
const env = { ...process.env, VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey };
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm executable path is unavailable.");
// `--base=/` builds for Firebase Hosting (https://qatoolbarsandbox.web.app, site at the root); the
// default keeps the GitHub Pages project path while that host is still live.
const baseArgument = process.argv.find((argument) => argument.startsWith("--base="))?.slice("--base=".length);
const siteBase = baseArgument === "/" ? "/" : "/qa-toolbar-sandbox-chrome-extension/";
for (const [workspace, base] of [["@qts/landing", siteBase], ["@qts/admin", `${siteBase}admin/`]]) {
  const result = spawnSync(process.execPath, [npmCli, "run", "build", "-w", workspace, "--", "--base", base], { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const zipResult = spawnSync(process.execPath, [npmCli, "run", "package:extension:sideload", "--", "--output=apps/landing/dist/qa-toolbar-sandbox-extension.zip"], { cwd: process.cwd(), env, stdio: "inherit" });
if (zipResult.error) throw zipResult.error;
if (zipResult.status !== 0) process.exit(zipResult.status || 1);

// Firebase Hosting serves one directory: the founder admin goes under /admin of the landing build
// (the Pages workflow does the same copy itself).
if (siteBase === "/") {
  mkdirSync(resolve(process.cwd(), "apps/landing/dist/admin"), { recursive: true });
  cpSync(resolve(process.cwd(), "apps/admin/dist"), resolve(process.cwd(), "apps/landing/dist/admin"), { recursive: true });
}
