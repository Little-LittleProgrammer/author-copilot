import { spawn } from "node:child_process";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GitServiceError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

interface GitCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface CreatedVersion {
  readonly changedFiles: number;
  readonly commitId: string;
  readonly createdAt: string;
  readonly shortCommitId: string;
}

export type CreateVersionResult =
  | { readonly created: false }
  | { readonly created: true; readonly version: CreatedVersion };

export interface GitServiceOptions {
  readonly gitExecutable: string;
  readonly hooksDirectory: string;
  readonly resolveProjectRoot: (projectId: string) => Promise<string>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function outputLines(value: string): readonly string[] {
  return value.split("\0").filter((entry) => entry.length > 0);
}

function isolatedGitEnvironment(globalConfigPath: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
    ),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalConfigPath,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export class GitService {
  private readonly queues = new Map<string, Promise<void>>();

  public constructor(private readonly options: GitServiceOptions) {}

  public async createVersion(
    projectId: string,
    message: string,
  ): Promise<CreateVersionResult> {
    return this.withProjectLock(projectId, async () => {
      const rootPath = await realpath(
        await this.options.resolveProjectRoot(projectId),
      );
      await mkdir(this.options.hooksDirectory, {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(this.globalConfigPath, "", {
        encoding: "utf8",
        flag: "w",
        mode: 0o600,
      });
      await writeFile(this.globalAttributesPath, "", {
        encoding: "utf8",
        flag: "w",
        mode: 0o600,
      });
      await this.ensureRepository(rootPath);
      await this.assertNoExternalFilters(rootPath);

      await this.run(rootPath, ["add", "--all", "--", "."]);
      const staged = await this.run(rootPath, [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--",
        ".",
      ]);
      const changedFiles = outputLines(staged.stdout).length;
      if (changedFiles === 0) return { created: false };

      await this.run(rootPath, [
        "-c",
        "commit.gpgSign=false",
        "-c",
        "user.name=Author Copilot",
        "-c",
        "user.email=author-copilot@local",
        "commit",
        "--no-verify",
        "-m",
        message,
      ]);

      const commitId = (
        await this.run(rootPath, ["rev-parse", "HEAD"])
      ).stdout.trim();
      const createdAtOutput = (
        await this.run(rootPath, ["show", "-s", "--format=%cI", "HEAD"])
      ).stdout.trim();
      const createdAt = new Date(createdAtOutput).toISOString();

      return {
        created: true,
        version: {
          changedFiles,
          commitId,
          shortCommitId: commitId.slice(0, 8),
          createdAt,
        },
      };
    });
  }

  private async ensureRepository(rootPath: string): Promise<void> {
    const gitPath = join(rootPath, ".git");
    try {
      const gitStats = await lstat(gitPath);
      if (gitStats.isSymbolicLink()) {
        throw new GitServiceError(
          "invalid_repository",
          "The project Git metadata cannot be a symbolic link.",
          false,
        );
      }
      if (!gitStats.isDirectory()) {
        throw new GitServiceError(
          "invalid_repository",
          "Linked Git metadata is not supported by this version.",
          false,
        );
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      await this.run(rootPath, ["init", "--initial-branch=main"]);
    }

    const repositoryRoot = (
      await this.run(rootPath, ["rev-parse", "--show-toplevel"])
    ).stdout.trim();
    let canonicalRepositoryRoot: string;
    try {
      canonicalRepositoryRoot = await realpath(repositoryRoot);
    } catch {
      throw new GitServiceError(
        "invalid_repository",
        "Git returned an invalid repository root.",
        false,
      );
    }
    if (!samePath(canonicalRepositoryRoot, rootPath)) {
      throw new GitServiceError(
        "invalid_repository",
        "The Git repository root must match the registered project root.",
        false,
      );
    }
  }

  private async assertNoExternalFilters(rootPath: string): Promise<void> {
    const filters = await this.run(
      rootPath,
      [
        "config",
        "--local",
        "--get-regexp",
        "^filter\\..*\\.(clean|smudge|process)$",
      ],
      [0, 1],
    );
    if (filters.stdout.trim().length > 0) {
      throw new GitServiceError(
        "invalid_repository",
        "Repositories with external content filters are not supported.",
        false,
      );
    }
  }

  private get globalConfigPath(): string {
    return join(this.options.hooksDirectory, "global.gitconfig");
  }

  private get globalAttributesPath(): string {
    return join(this.options.hooksDirectory, "global.gitattributes");
  }

  private run(
    rootPath: string,
    args: readonly string[],
    acceptedExitCodes: readonly number[] = [0],
  ): Promise<GitCommandResult> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes =
      this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    return new Promise((resolve, reject) => {
      const child = spawn(
        this.options.gitExecutable,
        [
          "--no-pager",
          "-c",
          `core.hooksPath=${this.options.hooksDirectory}`,
          "-c",
          "core.fsmonitor=false",
          "-c",
          "gc.auto=0",
          "-c",
          "maintenance.auto=false",
          "-c",
          `core.attributesFile=${this.globalAttributesPath}`,
          ...args,
        ],
        {
          cwd: rootPath,
          env: isolatedGitEnvironment(this.globalConfigPath),
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      let settled = false;
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;

      const finish = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        operation();
      };
      const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) {
          child.kill();
          finish(() =>
            reject(
              new GitServiceError(
                "git_failed",
                "Git produced more output than the operation allows.",
                true,
              ),
            ),
          );
          return;
        }
        if (target === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() =>
          reject(
            new GitServiceError(
              "timeout",
              "The Git operation timed out.",
              true,
            ),
          ),
        );
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", () => {
        finish(() =>
          reject(
            new GitServiceError(
              "git_unavailable",
              "The Git runtime could not be started.",
              true,
            ),
          ),
        );
      });
      child.once("close", (exitCode) => {
        finish(() => {
          if (exitCode !== null && acceptedExitCodes.includes(exitCode)) {
            resolve({ exitCode, stderr, stdout });
            return;
          }
          reject(
            new GitServiceError(
              "git_failed",
              "The Git operation failed.",
              true,
            ),
          );
        });
      });
    });
  }

  private async withProjectLock<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const predecessor = this.queues.get(projectId) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = predecessor.then(() => current);
    this.queues.set(projectId, queued);
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(projectId) === queued) this.queues.delete(projectId);
    }
  }
}
