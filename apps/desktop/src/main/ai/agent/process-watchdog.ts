import { spawn } from "node:child_process";

// The watchdog owns no tools or credentials. Loss of the Main-owned pipe means
// the SDK process group must die, including when Main is terminated by SIGKILL.
const WATCHDOG_PROGRAM = String.raw`
const { spawn } = await import("node:child_process");
const { win32 } = await import("node:path");
const [pidText, platform, systemRoot] = process.argv.slice(1);
const pid = Number(pidText);
let released = false;
function terminate() {
  if (released) return;
  released = true;
  if (platform === "win32") {
    const child = spawn(win32.join(systemRoot, "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
    child.once("error", () => process.exit(1));
    child.once("exit", () => process.exit(0));
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch {}
    process.exit(0);
  }
}
process.stdin.on("data", data => { if (data.toString().includes("release")) { released = true; process.exit(0); } });
process.stdin.once("end", terminate);
process.stdin.once("error", terminate);
process.stdin.resume();
`;

export function createAgentProcessWatchdog(
  pid: number,
  platform: NodeJS.Platform,
  systemRoot: string,
  onFailure: () => void,
): () => void {
  const watchdog = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      WATCHDOG_PROGRAM,
      String(pid),
      platform,
      systemRoot,
    ],
    {
      env: { ELECTRON_RUN_AS_NODE: "1", SystemRoot: systemRoot },
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
      shell: false,
    },
  );
  let released = false;
  watchdog.once("error", () => {
    if (!released) onFailure();
  });
  watchdog.once("exit", () => {
    if (!released) onFailure();
  });
  watchdog.stdin.on("error", () => {
    if (!released) onFailure();
  });
  return () => {
    if (released) return;
    released = true;
    watchdog.stdin.end("release");
  };
}
