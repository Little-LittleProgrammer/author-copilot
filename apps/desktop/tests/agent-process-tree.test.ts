import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  AgentSdkProcessTree,
  windowsTaskkillCommand,
} from "../src/main/ai/agent/index.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("AgentSdkProcessTree", () => {
  it("builds an absolute Windows process-tree termination command", () => {
    expect(windowsTaskkillCommand(4321, "D:\\Windows")).toEqual({
      executable: "D:\\Windows\\System32\\taskkill.exe",
      arguments: ["/PID", "4321", "/T", "/F"],
    });
    expect(() => windowsTaskkillCommand(0)).toThrow("process id");
  });

  it("uses the Windows tree terminator without a shell", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      pid: number;
      killed: boolean;
      exitCode: number | null;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.pid = 4321;
    child.killed = false;
    child.exitCode = null;
    child.kill = vi.fn(() => true);
    const spawnProcess = vi.fn(() => child as never);
    const spawnTaskkill = vi.fn();
    const tree = new AgentSdkProcessTree({
      platform: "win32",
      createWatchdog: () => () => undefined,
      systemRoot: "D:\\Windows",
      spawnProcess,
      spawnTaskkill,
    });
    const spawned = tree.spawn({
      command: "C:\\app\\claude.exe",
      args: ["--version"],
      cwd: "C:\\project",
      env: {},
      signal: new AbortController().signal,
    });

    expect(spawned.kill("SIGKILL")).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\app\\claude.exe",
      ["--version"],
      expect.objectContaining({ detached: false, shell: false }),
    );
    expect(spawnTaskkill).toHaveBeenCalledWith(
      "D:\\Windows\\System32\\taskkill.exe",
      ["/PID", "4321", "/T", "/F"],
    );
    child.exitCode = 1;
    child.emit("exit", 1, null);
    await tree.terminate();
  });

  it.skipIf(process.platform === "win32")(
    "terminates the SDK root and its descendant process group",
    async () => {
      const tree = new AgentSdkProcessTree({
        gracefulExitMs: 10,
        forceExitMs: 2_000,
      });
      const descendantProgram = "setInterval(() => undefined, 1_000);";
      const rootProgram = [
        'const { spawn } = require("node:child_process");',
        `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantProgram)}], { stdio: "ignore" });`,
        "process.stdout.write(`${process.pid}:${child.pid}\\n`);",
        "setInterval(() => undefined, 1_000);",
      ].join("\n");
      const controller = new AbortController();
      const root = tree.spawn({
        command: process.execPath,
        args: ["-e", rootProgram],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH },
        signal: controller.signal,
      });
      const [chunk] = (await once(root.stdout, "data")) as [Buffer];
      const [rootText, descendantText] = chunk
        .toString("utf8")
        .trim()
        .split(":");
      const rootPid = Number(rootText);
      const descendantPid = Number(descendantText);
      expect(rootPid).toBeGreaterThan(1);
      expect(descendantPid).toBeGreaterThan(1);

      try {
        await tree.terminate();
        await expect.poll(() => isAlive(rootPid)).toBe(false);
        await expect.poll(() => isAlive(descendantPid)).toBe(false);
      } finally {
        if (isAlive(rootPid)) {
          try {
            process.kill(-rootPid, "SIGKILL");
          } catch {
            // The process group already exited between the checks.
          }
        }
      }
    },
  );
});
