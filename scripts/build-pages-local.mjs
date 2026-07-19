import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
for (const [workspace, base] of [["@qts/landing", "/qa-toolbar-sandbox-chrome-extension/"], ["@qts/admin", "/qa-toolbar-sandbox-chrome-extension/admin/"]]) {
  const result = spawnSync(process.execPath, [npmCli, "run", "build", "-w", workspace, "--", "--base", base], { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const zipResult = spawnSync(process.execPath, [npmCli, "run", "package:extension:sideload", "--", "--output=apps/landing/dist/qa-toolbar-sandbox-extension.zip"], { cwd: process.cwd(), env, stdio: "inherit" });
if (zipResult.error) throw zipResult.error;
if (zipResult.status !== 0) process.exit(zipResult.status || 1);
