import { createAgentProcessWatchdog } from "./process-watchdog.js";
import {
  spawn,
  type ChildProcessByStdio,
  type SpawnOptions as NodeSpawnOptions,
} from "node:child_process";
import { win32 } from "node:path";
import type { Readable, Writable } from "node:stream";

import type {
  SpawnedProcess,
  SpawnOptions as SdkSpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";

const DEFAULT_GRACEFUL_EXIT_MS = 2_500;
const DEFAULT_FORCE_EXIT_MS = 5_000;

type ManagedChildProcess = ChildProcessByStdio<Writable, Readable, null>;

type SpawnProcess = (
  command: string,
  arguments_: readonly string[],
  options: NodeSpawnOptions,
) => ManagedChildProcess;

interface TrackedProcess {
  readonly child: ManagedChildProcess;
  readonly pid: number | undefined;
  readonly exited: Promise<void>;
  exitedNow: boolean;
  releaseWatchdog?: () => void;
}

export interface AgentSdkProcessTreeOptions {
  readonly createWatchdog?: typeof createAgentProcessWatchdog;
  readonly platform?: NodeJS.Platform;
  readonly systemRoot?: string;
  readonly gracefulExitMs?: number;
  readonly forceExitMs?: number;
  readonly spawnProcess?: SpawnProcess;
  readonly killProcessGroup?: (pid: number, signal: NodeJS.Signals) => void;
  readonly spawnTaskkill?: (
    executable: string,
    arguments_: readonly string[],
  ) => void;
}

export class AgentProcessTerminationError extends Error {
  readonly code = "process_tree_not_terminated";

  constructor() {
    super("The Agent SDK process tree did not terminate within the limit.");
    this.name = "AgentProcessTerminationError";
  }
}

function defaultSpawnProcess(
  command: string,
  arguments_: readonly string[],
  options: NodeSpawnOptions,
): ManagedChildProcess {
  return spawn(command, [...arguments_], {
    ...options,
    stdio: ["pipe", "pipe", "ignore"],
  });
}

export function windowsTaskkillCommand(
  pid: number,
  systemRoot: string = "C:\\Windows",
): { readonly executable: string; readonly arguments: readonly string[] } {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("The Agent SDK process id is invalid.");
  }
  return {
    executable: win32.join(systemRoot, "System32", "taskkill.exe"),
    arguments: ["/PID", String(pid), "/T", "/F"],
  };
}

function defaultSpawnTaskkill(
  executable: string,
  arguments_: readonly string[],
): void {
  const terminator = spawn(executable, [...arguments_], {
    windowsHide: true,
    stdio: "ignore",
    shell: false,
  });
  terminator.on("error", () => undefined);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref();
  });
}

export class AgentSdkProcessTree {
  private readonly createWatchdog: typeof createAgentProcessWatchdog;
  private readonly platform: NodeJS.Platform;
  private readonly systemRoot: string;
  private readonly gracefulExitMs: number;
  private readonly forceExitMs: number;
  private readonly spawnProcess: SpawnProcess;
  private readonly killProcessGroup: (
    pid: number,
    signal: NodeJS.Signals,
  ) => void;
  private readonly spawnTaskkill: (
    executable: string,
    arguments_: readonly string[],
  ) => void;
  private readonly tracked = new Set<TrackedProcess>();
  private termination: Promise<void> | undefined;

  constructor(options: AgentSdkProcessTreeOptions = {}) {
    this.createWatchdog = options.createWatchdog ?? createAgentProcessWatchdog;
    this.platform = options.platform ?? process.platform;
    this.systemRoot =
      options.systemRoot ?? process.env.SystemRoot ?? "C:\\Windows";
    this.gracefulExitMs = options.gracefulExitMs ?? DEFAULT_GRACEFUL_EXIT_MS;
    this.forceExitMs = options.forceExitMs ?? DEFAULT_FORCE_EXIT_MS;
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.killProcessGroup =
      options.killProcessGroup ??
      ((pid, signal) => {
        process.kill(-pid, signal);
      });
    this.spawnTaskkill = options.spawnTaskkill ?? defaultSpawnTaskkill;
  }

  readonly spawn = (options: SdkSpawnOptions): SpawnedProcess => {
    if (this.termination !== undefined) {
      throw new AgentProcessTerminationError();
    }
    const child = this.spawnProcess(options.command, options.args, {
      cwd: options.cwd,
      detached: this.platform !== "win32",
      env: options.env,
      shell: false,
      windowsHide: true,
    });
    let settle!: () => void;
    const exited = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const tracked: TrackedProcess = {
      child,
      pid: child.pid,
      exited,
      exitedNow: false,
    };
    const markExited = () => {
      if (tracked.exitedNow) return;
      tracked.exitedNow = true;
      options.signal.removeEventListener("abort", abortTree);
      settle();
    };
    const killTree = (signal: NodeJS.Signals): boolean =>
      this.killTrackedProcess(tracked, signal);
    const abortTree = () => killTree("SIGKILL");
    options.signal.addEventListener("abort", abortTree, { once: true });
    child.once("exit", markExited);
    child.once("error", markExited);
    this.tracked.add(tracked);
    if (child.pid !== undefined)
      tracked.releaseWatchdog = this.createWatchdog(
        child.pid,
        this.platform,
        this.systemRoot,
        () => {
          this.killTrackedProcess(tracked, "SIGKILL");
        },
      );

    return {
      stdin: child.stdin,
      stdout: child.stdout,
      get killed() {
        return child.killed || tracked.exitedNow;
      },
      get exitCode() {
        return child.exitCode;
      },
      kill: killTree,
      on: child.on.bind(child) as SpawnedProcess["on"],
      once: child.once.bind(child) as SpawnedProcess["once"],
      off: child.off.bind(child) as SpawnedProcess["off"],
    };
  };

  terminate(): Promise<void> {
    this.termination ??= this.terminateOnce();
    return this.termination;
  }

  private async terminateOnce(): Promise<void> {
    const processes = [...this.tracked];
    if (processes.some((tracked) => !tracked.exitedNow)) {
      await Promise.race([
        Promise.all(processes.map((tracked) => tracked.exited)),
        wait(this.gracefulExitMs),
      ]);
    }

    for (const tracked of processes) {
      this.killTrackedProcess(tracked, "SIGKILL");
    }
    if (processes.some((tracked) => !tracked.exitedNow)) {
      await Promise.race([
        Promise.all(processes.map((tracked) => tracked.exited)),
        wait(this.forceExitMs),
      ]);
    }
    for (const tracked of processes)
      if (tracked.exitedNow) tracked.releaseWatchdog?.();
    this.tracked.clear();
    if (processes.some((tracked) => !tracked.exitedNow)) {
      throw new AgentProcessTerminationError();
    }
  }

  private killTrackedProcess(
    tracked: TrackedProcess,
    signal: NodeJS.Signals,
  ): boolean {
    if (tracked.pid === undefined) return tracked.child.kill(signal);
    try {
      if (this.platform === "win32") {
        const command = windowsTaskkillCommand(tracked.pid, this.systemRoot);
        this.spawnTaskkill(command.executable, command.arguments);
      } else {
        this.killProcessGroup(tracked.pid, signal);
      }
      return true;
    } catch {
      return tracked.exitedNow ? false : tracked.child.kill(signal);
    }
  }
}
