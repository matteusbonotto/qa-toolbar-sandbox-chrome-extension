import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(new URL("../.git", import.meta.url))) {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "inherit" });
  console.log("Git security hooks enabled.");
}
