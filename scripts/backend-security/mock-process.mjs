// Starts mock-edge-server.mjs as a CHILD process (so load numbers are not skewed by sharing an event
// loop with the load generator) and returns the JSON line it prints plus a stop() helper.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function startMockProcess(extraArgs = []) {
  const child = spawn(process.execPath, [resolve(HERE, "mock-edge-server.mjs"), ...extraArgs], { stdio: ["pipe", "pipe", "inherit"] });
  const info = await new Promise((resolvePromise, reject) => {
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline >= 0) resolvePromise(JSON.parse(buffer.slice(0, newline)));
    });
    child.on("exit", (code) => reject(new Error(`mock server exited early (${code})`)));
  });
  return {
    ...info,
    stop: () => new Promise((resolvePromise) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolvePromise();
      child.once("exit", () => resolvePromise());
      child.stdin.end(); // the mock exits when its stdin closes; kill() is the fallback for this child PID only
      setTimeout(() => child.kill(), 2_000).unref(); // 2 s grace for a clean close before killing our own child
    }),
  };
}
