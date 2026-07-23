import { chmodSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(new URL("../.git", import.meta.url))) {
  for (const hook of ["pre-commit", "post-merge"]) {
    const hookUrl = new URL(`../.githooks/${hook}`, import.meta.url);
    if (existsSync(hookUrl)) chmodSync(hookUrl, 0o755);
  }
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "inherit" });
  console.log("Git security and local post-merge automation hooks enabled.");
}
