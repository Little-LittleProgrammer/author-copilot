import { spawn } from "node:child_process";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  VersionDiff,
  VersionDiffFile,
  VersionSummary,
} from "@author-copilot/contracts";

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
  readonly runtimeEnvironment?: Readonly<Record<string, string>>;
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

function gitStatus(value: string): VersionDiffFile["status"] {
  switch (value) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "T":
      return "type_changed";
    default:
      return "modified";
  }
}

function parseNameStatus(value: string): ReadonlyMap<string, string> {
  const entries = outputLines(value);
  const statuses = new Map<string, string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    const separator = entry.indexOf("\t");
    if (separator >= 0) {
      statuses.set(entry.slice(separator + 1), entry.slice(0, separator));
      continue;
    }
    const path = entries[index + 1];
    if (path === undefined) break;
    statuses.set(path, entry);
    index += 1;
  }
  return statuses;
}

function parseNumstat(
  value: string,
  statuses: ReadonlyMap<string, string>,
): VersionDiffFile[] {
  return outputLines(value).flatMap((entry) => {
    const firstSeparator = entry.indexOf("\t");
    const secondSeparator = entry.indexOf("\t", firstSeparator + 1);
    if (firstSeparator < 0 || secondSeparator < 0) return [];
    const additionsValue = entry.slice(0, firstSeparator);
    const deletionsValue = entry.slice(firstSeparator + 1, secondSeparator);
    const path = entry.slice(secondSeparator + 1);
    if (path.length === 0) return [];
    const binary = additionsValue === "-" || deletionsValue === "-";
    return [
      {
        path,
        status: gitStatus(statuses.get(path) ?? "M"),
        additions: binary ? null : Number.parseInt(additionsValue, 10),
        deletions: binary ? null : Number.parseInt(deletionsValue, 10),
        binary,
      },
    ];
  });
}

function isolatedGitEnvironment(
  globalConfigPath: string,
  runtimeEnvironment: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
    ),
    ...runtimeEnvironment,
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
      const rootPath = await this.resolveProjectRoot(projectId);
      await this.prepareIsolationFiles();
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

  public async listVersions(
    projectId: string,
    limit: number,
  ): Promise<readonly VersionSummary[]> {
    return this.withProjectLock(projectId, async () => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new GitServiceError(
          "git_failed",
          "The version history limit is invalid.",
          false,
        );
      }
      const rootPath = await this.resolveProjectRoot(projectId);
      await this.prepareIsolationFiles();
      if (!(await this.hasRepositoryMetadata(rootPath))) return [];
      await this.assertRepositoryRoot(rootPath);
      const head = await this.run(
        rootPath,
        ["rev-parse", "--verify", "HEAD"],
        [0, 1, 128],
      );
      if (head.exitCode !== 0) return [];
      const result = await this.run(rootPath, [
        "log",
        "-z",
        "--abbrev=8",
        `--max-count=${limit}`,
        "--format=%H%x00%h%x00%cI%x00%s",
      ]);
      const fields = outputLines(result.stdout);
      if (fields.length % 4 !== 0) {
        throw new GitServiceError(
          "git_failed",
          "Git returned invalid version history.",
          true,
        );
      }
      const versions: VersionSummary[] = [];
      for (let index = 0; index < fields.length; index += 4) {
        const commitId = fields[index]?.trim() ?? "";
        const shortCommitId = fields[index + 1]?.trim() ?? "";
        const createdAtValue = fields[index + 2]?.trim() ?? "";
        const message = (fields[index + 3]?.trim() ?? "").slice(0, 500);
        const createdAt = new Date(createdAtValue);
        if (
          !/^[a-f0-9]{40,64}$/u.test(commitId) ||
          !/^[a-f0-9]{7,12}$/u.test(shortCommitId) ||
          Number.isNaN(createdAt.getTime())
        ) {
          throw new GitServiceError(
            "git_failed",
            "Git returned invalid version history.",
            true,
          );
        }
        versions.push({
          commitId,
          shortCommitId,
          message,
          createdAt: createdAt.toISOString(),
        });
      }
      return versions;
    });
  }

  public async getVersionDiff(
    projectId: string,
    commitId: string,
  ): Promise<VersionDiff> {
    return this.withProjectLock(projectId, async () => {
      if (!/^[a-f0-9]{40,64}$/u.test(commitId)) {
        throw new GitServiceError(
          "git_failed",
          "The requested version is invalid.",
          false,
        );
      }
      const rootPath = await this.resolveProjectRoot(projectId);
      await this.prepareIsolationFiles();
      if (!(await this.hasRepositoryMetadata(rootPath))) {
        throw new GitServiceError(
          "invalid_repository",
          "The project does not have version history.",
          false,
        );
      }
      await this.assertRepositoryRoot(rootPath);
      const revision = `${commitId}^{commit}`;
      await this.run(rootPath, ["cat-file", "-e", revision]);
      const canonicalCommitId = (
        await this.run(rootPath, ["rev-parse", revision])
      ).stdout.trim();
      const commonArguments = [
        "--root",
        "--first-parent",
        "--no-commit-id",
        "--no-renames",
        "-r",
        canonicalCommitId,
        "--",
        ".",
      ] as const;
      const [nameStatus, numstat, patch] = await Promise.all([
        this.run(rootPath, [
          "diff-tree",
          "--name-status",
          "-z",
          ...commonArguments,
        ]),
        this.run(rootPath, [
          "diff-tree",
          "--numstat",
          "-z",
          ...commonArguments,
        ]),
        this.run(rootPath, [
          "show",
          "--format=",
          "--first-parent",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--unified=3",
          canonicalCommitId,
          "--",
          ".",
        ]),
      ]);
      const statuses = parseNameStatus(nameStatus.stdout);
      return {
        commitId: canonicalCommitId,
        files: parseNumstat(numstat.stdout, statuses),
        patch: patch.stdout,
      };
    });
  }

  private async resolveProjectRoot(projectId: string): Promise<string> {
    return realpath(await this.options.resolveProjectRoot(projectId));
  }

  private async prepareIsolationFiles(): Promise<void> {
    await mkdir(this.options.hooksDirectory, {
      recursive: true,
      mode: 0o700,
    });
    await Promise.all([
      writeFile(this.globalConfigPath, "", {
        encoding: "utf8",
        flag: "w",
        mode: 0o600,
      }),
      writeFile(this.globalAttributesPath, "", {
        encoding: "utf8",
        flag: "w",
        mode: 0o600,
      }),
    ]);
  }

  private async ensureRepository(rootPath: string): Promise<void> {
    if (!(await this.hasRepositoryMetadata(rootPath))) {
      await this.run(rootPath, ["init", "--initial-branch=main"]);
    }
    await this.assertRepositoryRoot(rootPath);
  }

  private async hasRepositoryMetadata(rootPath: string): Promise<boolean> {
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
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  private async assertRepositoryRoot(rootPath: string): Promise<void> {
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
          "core.quotePath=false",
          "-c",
          `core.attributesFile=${this.globalAttributesPath}`,
          ...args,
        ],
        {
          cwd: rootPath,
          env: isolatedGitEnvironment(
            this.globalConfigPath,
            this.options.runtimeEnvironment,
          ),
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
