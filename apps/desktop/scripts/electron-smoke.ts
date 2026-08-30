import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const marker = "AUTHOR_COPILOT_ELECTRON_SMOKE_READY";
const timeoutMs = 60_000;
const cliArguments = process.argv.slice(2);
const require = createRequire(import.meta.url);

function resolveElectronExecutable(): string {
  const executable: unknown = require("electron");
  if (typeof executable !== "string") {
    throw new TypeError(
      "The Electron package did not resolve to an executable path",
    );
  }
  return executable;
}

function resolveLaunchTarget(): { command: string; args: string[] } {
  if (cliArguments.length === 0) {
    return { command: resolveElectronExecutable(), args: ["."] };
  }

  if (
    cliArguments.length === 2 &&
    cliArguments[0] === "--executable" &&
    cliArguments[1] !== undefined &&
    cliArguments[1].length > 0
  ) {
    return { command: resolve(cliArguments[1]), args: [] };
  }

  throw new Error("Usage: electron-smoke.ts [--executable <path>]");
}

const launchTarget = resolveLaunchTarget();

const child = spawn(launchTarget.command, launchTarget.args, {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    AUTHOR_COPILOT_ELECTRON_SMOKE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let settled = false;

function finish(error?: Error): void {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);

  if (error !== undefined) {
    child.kill("SIGTERM");
    process.stderr.write(`${output}\n`);
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

function capture(chunk: Buffer): void {
  output += chunk.toString();
  if (output.includes(marker)) {
    process.stdout.write(`${marker}\n`);
  }
}

child.stdout.on("data", capture);
child.stderr.on("data", capture);
child.on("error", (error) => finish(error));
child.on("exit", (code) => {
  if (!output.includes(marker)) {
    finish(
      new Error(`Electron exited with code ${String(code)} before readiness`),
    );
    return;
  }
  finish();
});

const timeout = setTimeout(() => {
  finish(new Error(`Electron did not become ready within ${timeoutMs}ms`));
}, timeoutMs);
