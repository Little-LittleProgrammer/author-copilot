import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

import { ProjectOperationQueue } from "./project-operation-queue.js";

const SNAPSHOT_SCHEMA_VERSION = 1;
const MANIFEST_FILE = "snapshot.json";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_TASK_BYTES = 50 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMMIT_ID_PATTERN = /^[a-f0-9]{40,64}$/u;

type SnapshotState =
  "active" | "restoring" | "restore_partial" | "restore_blocked" | "restored";

type MutationState = "prepared" | "applied" | "restored";

interface MissingFileState {
  readonly kind: "missing";
}

interface PresentFileState {
  readonly kind: "file";
  readonly hash: string;
  readonly mode: number;
  readonly size: number;
}

type FileState = MissingFileState | PresentFileState;

interface SnapshotMutation {
  readonly id: string;
  readonly sequence: number;
  readonly path: string;
  readonly before: FileState;
  readonly after: FileState;
  readonly indexEntryBefore: string;
  readonly createdDirectories: readonly string[];
  state: MutationState;
}

interface BaselineStatus {
  readonly porcelain: string;
  readonly staged: readonly string[];
  readonly unstaged: readonly string[];
  readonly untracked: readonly string[];
}

interface SnapshotManifest {
  readonly schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  readonly taskId: string;
  readonly projectId: string;
  readonly repoRoot: string;
  readonly head: string | null;
  readonly baselineStatus: BaselineStatus;
  readonly createdAt: string;
  readonly mutations: SnapshotMutation[];
  state: SnapshotState;
  totalBlobBytes: number;
}

interface GitCommandResult {
  readonly exitCode: number;
  readonly stderr: Buffer;
  readonly stdout: Buffer;
}

export type TaskRestoreConflictReason =
  | "head_changed"
  | "index_entry_changed"
  | "overlapping_user_edit"
  | "binary_concurrent_change"
  | "create_delete_concurrent_change";

export interface TaskRestoreConflict {
  readonly path: string | null;
  readonly reason: TaskRestoreConflictReason;
}

export interface TaskRestoreFailure {
  readonly path: string;
  readonly message: string;
}

export interface TaskRestoreResult {
  readonly status: "complete" | "partial" | "blocked";
  readonly restoredPaths: readonly string[];
  readonly alreadyRestoredPaths: readonly string[];
  readonly conflicts: readonly TaskRestoreConflict[];
  readonly failures: readonly TaskRestoreFailure[];
}

export interface TaskRecoverySummary {
  readonly taskId: string;
  readonly createdAt: string;
  readonly affectedPaths: readonly string[];
  readonly status: "active" | "partial" | "blocked";
}

export type TaskSnapshotErrorCode =
  | "not_found"
  | "invalid_repository"
  | "invalid_snapshot"
  | "unsafe_path"
  | "task_conflict"
  | "git_unavailable"
  | "timeout"
  | "budget_exceeded"
  | "io_failed";

export class TaskSnapshotError extends Error {
  public constructor(
    public readonly code: TaskSnapshotErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TaskSnapshotError";
  }
}

export interface TaskSnapshotServiceOptions {
  readonly gitExecutable: string;
  readonly isolationDirectory: string;
  readonly snapshotsRoot: string;
  readonly resolveProjectRoot: (projectId: string) => Promise<string>;
  readonly runtimeEnvironment?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxFileBytes?: number;
  readonly maxTaskBytes?: number;
  readonly operationQueue?: ProjectOperationQueue;
}

interface AuthorizedPath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

interface PreparedMutation {
  readonly manifest: SnapshotManifest;
  readonly mutation: SnapshotMutation;
  readonly resolved: AuthorizedPath;
  readonly snapshotDirectory: string;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown filesystem error.";
}

function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    (error: unknown) => {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    },
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isInside(parent: string, child: string): boolean {
  const result = relative(parent, child);
  return (
    result === "" ||
    (result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result))
  );
}

function splitNul(value: Buffer): readonly string[] {
  return value.toString("utf8").split("\0").filter(Boolean);
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function sameState(left: FileState, right: FileState): boolean {
  if (left.kind !== right.kind) return false;
  return (
    left.kind === "missing" ||
    (right.kind === "file" &&
      left.hash === right.hash &&
      left.mode === right.mode)
  );
}

function isUtf8Text(content: Buffer): boolean {
  return (
    !content.includes(0) &&
    Buffer.from(content.toString("utf8"), "utf8").equals(content)
  );
}

function assertUuid(value: string, name: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new TaskSnapshotError(
      "invalid_snapshot",
      `${name} must be a UUID.`,
      false,
    );
  }
}

function isUnsafeWindowsSegment(segment: string): boolean {
  const normalized = segment.replace(/[. ]+$/u, "").toLowerCase();
  const deviceName = normalized.split(".", 1)[0] ?? "";
  return (
    normalized !== segment.toLowerCase() ||
    segment.includes(":") ||
    normalized === ".git" ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(deviceName)
  );
}

function assertStringArray(
  value: unknown,
  name: string,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string")
  ) {
    throw new TaskSnapshotError(
      "invalid_snapshot",
      `The snapshot ${name} is invalid.`,
      false,
    );
  }
}

function parseFileState(value: unknown): FileState {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    throw new TaskSnapshotError(
      "invalid_snapshot",
      "The snapshot file state is invalid.",
      false,
    );
  }
  if (value.kind === "missing") return { kind: "missing" };
  if (
    value.kind !== "file" ||
    !("hash" in value) ||
    typeof value.hash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.hash) ||
    !("mode" in value) ||
    typeof value.mode !== "number" ||
    !Number.isInteger(value.mode) ||
    !("size" in value) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0
  ) {
    throw new TaskSnapshotError(
      "invalid_snapshot",
      "The snapshot file state is invalid.",
      false,
    );
  }
  return { kind: "file", hash: value.hash, mode: value.mode, size: value.size };
}

function parseManifest(value: unknown): SnapshotManifest {
  if (typeof value !== "object" || value === null) {
    throw new TaskSnapshotError(
      "invalid_snapshot",
      "The task snapshot is invalid.",
      false,
    );
  }
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    typeof input.taskId !== "string" ||
    typeof input.projectId !== "string" ||
    typeof input.repoRoot !== "string" ||
    !isAbsolute(input.repoRoot) ||
    (input.head !== null &&
      (typeof input.head !== "string" ||
        !COMMIT_ID_PATTERN.test(input.head))) ||
    typeof input.createdAt !== "string" ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    typeof input.totalBlobBytes !== "number" ||
    !Number.isSafeInteger(input.totalBlobBytes) ||
    input.totalBlobBytes < 0 ||
    ![
      "active",
      "restoring",
      "restore_partial",
      "restore_blocked",
      "restored",
    ].includes(String(input.state)) ||
    typeof input.baselineStatus !== "object" ||
    input.baselineStatus === null ||
    !Array.isArray(input.mutations)
  ) {
    throw new TaskSnapshotError(
      "invalid_snapshot",
      "The task snapshot is invalid.",
      false,
    );
  }
  assertUuid(input.taskId, "taskId");
  assertUuid(input.projectId, "projectId");
  const baseline = input.baselineStatus as Record<string, unknown>;
  if (typeof baseline.porcelain !== "string") {
    throw new TaskSnapshotError(
      "invalid_snapshot",
      "The snapshot status is invalid.",
      false,
    );
  }
  assertStringArray(baseline.staged, "staged paths");
  assertStringArray(baseline.unstaged, "unstaged paths");
  assertStringArray(baseline.untracked, "untracked paths");

  const mutations = input.mutations.map((entry, index): SnapshotMutation => {
    if (typeof entry !== "object" || entry === null) {
      throw new TaskSnapshotError(
        "invalid_snapshot",
        "A snapshot mutation is invalid.",
        false,
      );
    }
    const mutation = entry as Record<string, unknown>;
    if (
      typeof mutation.id !== "string" ||
      !UUID_PATTERN.test(mutation.id) ||
      mutation.sequence !== index + 1 ||
      typeof mutation.path !== "string" ||
      typeof mutation.indexEntryBefore !== "string" ||
      !["prepared", "applied", "restored"].includes(String(mutation.state))
    ) {
      throw new TaskSnapshotError(
        "invalid_snapshot",
        "A snapshot mutation is invalid.",
        false,
      );
    }
    assertStringArray(mutation.createdDirectories, "created directories");
    return {
      id: mutation.id,
      sequence: mutation.sequence,
      path: mutation.path,
      before: parseFileState(mutation.before),
      after: parseFileState(mutation.after),
      indexEntryBefore: mutation.indexEntryBefore,
      createdDirectories: mutation.createdDirectories,
      state: mutation.state as MutationState,
    };
  });

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    taskId: input.taskId,
    projectId: input.projectId,
    repoRoot: input.repoRoot,
    head: input.head as string | null,
    baselineStatus: {
      porcelain: baseline.porcelain,
      staged: baseline.staged,
      unstaged: baseline.unstaged,
      untracked: baseline.untracked,
    },
    createdAt: input.createdAt,
    mutations,
    state: input.state as SnapshotState,
    totalBlobBytes: input.totalBlobBytes,
  };
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

export class TaskSnapshotService {
  private readonly operationQueue: ProjectOperationQueue;

  public constructor(private readonly options: TaskSnapshotServiceOptions) {
    this.operationQueue = options.operationQueue ?? new ProjectOperationQueue();
  }

  public async createTaskSnapshot(
    projectId: string,
    taskId: string,
  ): Promise<TaskRecoverySummary> {
    assertUuid(projectId, "projectId");
    assertUuid(taskId, "taskId");
    return this.withProjectLock(projectId, async () => {
      const repoRoot = await this.resolveProjectRoot(projectId);
      await this.prepareStorage();
      await this.assertRepositoryRoot(repoRoot);
      const existing = await this.listRecoveriesUnlocked(projectId, repoRoot);
      if (existing.length > 0) {
        throw new TaskSnapshotError(
          "task_conflict",
          "The project already has a recoverable Agent task.",
          false,
        );
      }

      const snapshotDirectory = this.snapshotDirectory(projectId, taskId);
      if (await pathExists(snapshotDirectory)) {
        throw new TaskSnapshotError(
          "task_conflict",
          "The task snapshot already exists.",
          false,
        );
      }
      await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
      await this.assertSnapshotDirectory(snapshotDirectory);
      await chmod(snapshotDirectory, 0o700);
      const manifest: SnapshotManifest = {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        taskId,
        projectId,
        repoRoot,
        head: await this.currentHead(repoRoot),
        baselineStatus: await this.captureGitStatus(repoRoot),
        mutations: [],
        createdAt: new Date().toISOString(),
        state: "active",
        totalBlobBytes: 0,
      };
      await this.saveManifest(snapshotDirectory, manifest);
      return this.toRecoverySummary(manifest);
    });
  }

  public async writeTaskFile(
    projectId: string,
    taskId: string,
    relativePath: string,
    content: Buffer | string,
  ): Promise<void> {
    await this.withProjectLock(projectId, async () => {
      const manifest = await this.loadAuthorizedManifest(projectId, taskId);
      this.assertTaskWritable(manifest);
      await this.assertHeadUnchanged(manifest);
      const buffer = Buffer.isBuffer(content)
        ? content
        : Buffer.from(content, "utf8");
      this.assertFileBudget(buffer.length);
      const snapshotDirectory = this.snapshotDirectory(projectId, taskId);
      const resolved = await this.resolveAuthorizedPath(
        manifest.repoRoot,
        relativePath,
      );
      const createdDirectories = await this.createdParentDirectories(
        manifest.repoRoot,
        resolved.absolutePath,
      );
      const after = await this.saveBlob(
        snapshotDirectory,
        manifest,
        buffer,
        0o644,
      );
      await this.saveManifest(snapshotDirectory, manifest);
      const prepared = await this.prepareMutation({
        manifest,
        snapshotDirectory,
        relativePath: resolved.relativePath,
        after,
        createdDirectories,
      });
      await this.atomicWrite(
        prepared.resolved.absolutePath,
        buffer,
        prepared.mutation.after.kind === "file"
          ? prepared.mutation.after.mode
          : 0o644,
      );
      prepared.mutation.state = "applied";
      await this.saveManifest(snapshotDirectory, manifest);
    });
  }

  public async deleteTaskFile(
    projectId: string,
    taskId: string,
    relativePath: string,
  ): Promise<void> {
    await this.withProjectLock(projectId, async () => {
      const manifest = await this.loadAuthorizedManifest(projectId, taskId);
      this.assertTaskWritable(manifest);
      await this.assertHeadUnchanged(manifest);
      const snapshotDirectory = this.snapshotDirectory(projectId, taskId);
      const prepared = await this.prepareMutation({
        manifest,
        snapshotDirectory,
        relativePath,
        after: { kind: "missing" },
        createdDirectories: [],
        requireExistingFile: true,
      });
      await unlink(prepared.resolved.absolutePath);
      prepared.mutation.state = "applied";
      await this.saveManifest(snapshotDirectory, manifest);
    });
  }

  public async listRecoveries(
    projectId: string,
  ): Promise<readonly TaskRecoverySummary[]> {
    assertUuid(projectId, "projectId");
    return this.withProjectLock(projectId, async () => {
      const repoRoot = await this.resolveProjectRoot(projectId);
      await this.prepareStorage();
      return this.listRecoveriesUnlocked(projectId, repoRoot);
    });
  }

  // The caller must hold the shared project queue lock to keep this check atomic.
  public async hasRecoverableTaskWhileProjectLocked(
    projectId: string,
  ): Promise<boolean> {
    assertUuid(projectId, "projectId");
    const repoRoot = await this.resolveProjectRoot(projectId);
    await this.prepareStorage();
    return (await this.listRecoveriesUnlocked(projectId, repoRoot)).length > 0;
  }

  public async restoreTaskSnapshot(
    projectId: string,
    taskId: string,
  ): Promise<TaskRestoreResult> {
    assertUuid(projectId, "projectId");
    assertUuid(taskId, "taskId");
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.loadAuthorizedManifest(projectId, taskId);
      const snapshotDirectory = this.snapshotDirectory(projectId, taskId);
      const result: {
        status: TaskRestoreResult["status"];
        restoredPaths: string[];
        alreadyRestoredPaths: string[];
        conflicts: TaskRestoreConflict[];
        failures: TaskRestoreFailure[];
      } = {
        status: "complete",
        restoredPaths: [],
        alreadyRestoredPaths: [],
        conflicts: [],
        failures: [],
      };

      if ((await this.currentHead(manifest.repoRoot)) !== manifest.head) {
        manifest.state = "restore_blocked";
        await this.saveManifest(snapshotDirectory, manifest);
        return {
          ...result,
          status: "blocked",
          conflicts: [{ path: null, reason: "head_changed" }],
        };
      }

      manifest.state = "restoring";
      await this.saveManifest(snapshotDirectory, manifest);
      const blockedPaths = new Set<string>();
      const mutations = [...manifest.mutations].sort(
        (left, right) => right.sequence - left.sequence,
      );
      for (const mutation of mutations) {
        if (mutation.state === "restored" || blockedPaths.has(mutation.path)) {
          continue;
        }
        try {
          const resolved = await this.resolveAuthorizedPath(
            manifest.repoRoot,
            mutation.path,
          );
          if (
            (await this.indexEntry(manifest.repoRoot, mutation.path)) !==
            mutation.indexEntryBefore
          ) {
            result.conflicts.push({
              path: mutation.path,
              reason: "index_entry_changed",
            });
            blockedPaths.add(mutation.path);
            continue;
          }

          const current = await this.captureFileState(
            snapshotDirectory,
            manifest,
            resolved.absolutePath,
          );
          if (sameState(current, mutation.before)) {
            mutation.state = "restored";
            result.alreadyRestoredPaths.push(mutation.path);
            await this.saveManifest(snapshotDirectory, manifest);
            continue;
          }

          let targetState = mutation.before;
          if (!sameState(current, mutation.after)) {
            const merged = await this.reverseMerge(
              snapshotDirectory,
              manifest,
              mutation.before,
              mutation.after,
              current,
            );
            if ("reason" in merged) {
              result.conflicts.push({
                path: mutation.path,
                reason: merged.reason,
              });
              blockedPaths.add(mutation.path);
              continue;
            }
            targetState = merged.state;
          }

          await this.applyState(
            snapshotDirectory,
            manifest.repoRoot,
            resolved.absolutePath,
            targetState,
            mutation.createdDirectories,
          );
          mutation.state = "restored";
          result.restoredPaths.push(mutation.path);
          await this.saveManifest(snapshotDirectory, manifest);
        } catch (error) {
          result.failures.push({
            path: mutation.path,
            message: errorMessage(error),
          });
          blockedPaths.add(mutation.path);
        }
      }

      if (result.conflicts.length > 0 || result.failures.length > 0) {
        result.status = "partial";
        manifest.state = "restore_partial";
      } else {
        manifest.state = "restored";
      }
      await this.saveManifest(snapshotDirectory, manifest);
      return result;
    });
  }

  public async closeTaskSnapshot(
    projectId: string,
    taskId: string,
  ): Promise<void> {
    assertUuid(projectId, "projectId");
    assertUuid(taskId, "taskId");
    await this.withProjectLock(projectId, async () => {
      await this.loadAuthorizedManifest(projectId, taskId);
      await rm(this.snapshotDirectory(projectId, taskId), {
        recursive: true,
        force: true,
      });
    });
  }

  private async prepareMutation(options: {
    readonly manifest: SnapshotManifest;
    readonly snapshotDirectory: string;
    readonly relativePath: string;
    readonly after: FileState;
    readonly createdDirectories: readonly string[];
    readonly requireExistingFile?: boolean;
  }): Promise<PreparedMutation> {
    const resolved = await this.resolveAuthorizedPath(
      options.manifest.repoRoot,
      options.relativePath,
    );
    const before = await this.captureFileState(
      options.snapshotDirectory,
      options.manifest,
      resolved.absolutePath,
    );
    if (options.requireExistingFile === true && before.kind !== "file") {
      throw new TaskSnapshotError(
        "unsafe_path",
        "The requested file does not exist.",
        false,
      );
    }
    const after =
      options.after.kind === "file"
        ? {
            ...options.after,
            mode: before.kind === "file" ? before.mode : options.after.mode,
          }
        : options.after;
    const mutation: SnapshotMutation = {
      id: randomUUID(),
      sequence: options.manifest.mutations.length + 1,
      path: resolved.relativePath,
      before,
      after,
      indexEntryBefore: await this.indexEntry(
        options.manifest.repoRoot,
        resolved.relativePath,
      ),
      createdDirectories: options.createdDirectories,
      state: "prepared",
    };
    options.manifest.mutations.push(mutation);
    await this.saveManifest(options.snapshotDirectory, options.manifest);
    return {
      manifest: options.manifest,
      mutation,
      resolved,
      snapshotDirectory: options.snapshotDirectory,
    };
  }

  private async loadAuthorizedManifest(
    projectId: string,
    taskId: string,
  ): Promise<SnapshotManifest> {
    await this.prepareStorage();
    const manifest = await this.loadManifest(
      this.snapshotDirectory(projectId, taskId),
    );
    const repoRoot = await this.resolveProjectRoot(projectId);
    if (
      manifest.projectId !== projectId ||
      manifest.taskId !== taskId ||
      !samePath(manifest.repoRoot, repoRoot)
    ) {
      throw new TaskSnapshotError(
        "invalid_snapshot",
        "The task snapshot does not belong to this project.",
        false,
      );
    }
    return manifest;
  }

  private async listRecoveriesUnlocked(
    projectId: string,
    repoRoot: string,
  ): Promise<readonly TaskRecoverySummary[]> {
    const projectDirectory = join(this.options.snapshotsRoot, projectId);
    let entries;
    try {
      entries = await readdir(projectDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    }
    const summaries: TaskRecoverySummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue;
      const manifest = await this.loadManifest(
        join(projectDirectory, entry.name),
      );
      if (
        manifest.projectId !== projectId ||
        !samePath(manifest.repoRoot, repoRoot)
      ) {
        continue;
      }
      if (manifest.state === "restored") {
        await rm(join(projectDirectory, entry.name), {
          recursive: true,
          force: true,
        });
        continue;
      }
      summaries.push(this.toRecoverySummary(manifest));
    }
    return summaries.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  private toRecoverySummary(manifest: SnapshotManifest): TaskRecoverySummary {
    const affectedPaths = [
      ...new Set(
        manifest.mutations
          .filter((mutation) => mutation.state !== "restored")
          .map((mutation) => mutation.path),
      ),
    ].sort();
    return {
      taskId: manifest.taskId,
      createdAt: manifest.createdAt,
      affectedPaths,
      status:
        manifest.state === "restore_partial"
          ? "partial"
          : manifest.state === "restore_blocked"
            ? "blocked"
            : "active",
    };
  }

  private snapshotDirectory(projectId: string, taskId: string): string {
    assertUuid(projectId, "projectId");
    assertUuid(taskId, "taskId");
    return join(this.options.snapshotsRoot, projectId, taskId);
  }

  private async prepareStorage(): Promise<void> {
    await mkdir(this.options.snapshotsRoot, { recursive: true, mode: 0o700 });
    await this.assertPrivateDirectory(this.options.snapshotsRoot);
    await chmod(this.options.snapshotsRoot, 0o700);
    await mkdir(this.options.isolationDirectory, {
      recursive: true,
      mode: 0o700,
    });
    await this.assertPrivateDirectory(this.options.isolationDirectory);
    await writeFile(join(this.options.isolationDirectory, "config"), "", {
      flag: "a",
      mode: 0o600,
    });
  }

  private async assertPrivateDirectory(path: string): Promise<void> {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new TaskSnapshotError(
        "invalid_snapshot",
        "Task snapshot storage is not a private directory.",
        false,
      );
    }
  }

  private async assertSnapshotDirectory(path: string): Promise<void> {
    await this.assertPrivateDirectory(path);
    const [root, directory] = await Promise.all([
      realpath(this.options.snapshotsRoot),
      realpath(path),
    ]);
    if (!isInside(root, directory) || samePath(root, directory)) {
      throw new TaskSnapshotError(
        "invalid_snapshot",
        "The task snapshot directory escapes private storage.",
        false,
      );
    }
  }

  private async resolveProjectRoot(projectId: string): Promise<string> {
    const registeredRoot = await this.options.resolveProjectRoot(projectId);
    let rootEntry;
    let resolvedRoot;
    try {
      [rootEntry, resolvedRoot] = await Promise.all([
        lstat(registeredRoot),
        realpath(registeredRoot),
      ]);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        throw new TaskSnapshotError(
          "invalid_repository",
          "The registered project directory no longer exists.",
          false,
        );
      }
      throw error;
    }
    if (
      rootEntry.isSymbolicLink() ||
      !rootEntry.isDirectory() ||
      !samePath(resolve(registeredRoot), resolvedRoot)
    ) {
      throw new TaskSnapshotError(
        "invalid_repository",
        "The registered project directory is not a stable real path.",
        false,
      );
    }
    if (isInside(resolvedRoot, resolve(this.options.snapshotsRoot))) {
      throw new TaskSnapshotError(
        "invalid_repository",
        "Task snapshots must be stored outside the project.",
        false,
      );
    }
    return resolvedRoot;
  }

  private async assertRepositoryRoot(repoRoot: string): Promise<void> {
    const result = await this.runGit(repoRoot, [
      "rev-parse",
      "--show-toplevel",
    ]);
    let reportedRoot: string;
    try {
      reportedRoot = await realpath(result.stdout.toString("utf8").trim());
    } catch {
      throw new TaskSnapshotError(
        "invalid_repository",
        "Git did not return a valid repository root.",
        false,
      );
    }
    if (!samePath(repoRoot, reportedRoot)) {
      throw new TaskSnapshotError(
        "invalid_repository",
        "The project must be the repository root.",
        false,
      );
    }
  }

  private async currentHead(repoRoot: string): Promise<string | null> {
    const result = await this.runGit(
      repoRoot,
      ["rev-parse", "--verify", "HEAD"],
      [0, 1, 128],
    );
    if (result.exitCode !== 0) return null;
    const head = result.stdout.toString("utf8").trim();
    if (!COMMIT_ID_PATTERN.test(head)) {
      throw new TaskSnapshotError(
        "invalid_repository",
        "Git returned an invalid HEAD commit.",
        false,
      );
    }
    return head;
  }

  private async assertHeadUnchanged(manifest: SnapshotManifest): Promise<void> {
    if ((await this.currentHead(manifest.repoRoot)) !== manifest.head) {
      throw new TaskSnapshotError(
        "task_conflict",
        "HEAD changed after the task snapshot; Agent writes are blocked.",
        false,
      );
    }
  }

  private assertTaskWritable(manifest: SnapshotManifest): void {
    if (manifest.state !== "active") {
      throw new TaskSnapshotError(
        "task_conflict",
        "The task snapshot no longer accepts file changes.",
        false,
      );
    }
  }

  private async captureGitStatus(repoRoot: string): Promise<BaselineStatus> {
    const [staged, unstaged, untracked, porcelain] = await Promise.all([
      this.runGit(repoRoot, [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--diff-filter=ACDMRTUXB",
      ]),
      this.runGit(repoRoot, [
        "diff",
        "--name-only",
        "-z",
        "--diff-filter=ACDMRTUXB",
      ]),
      this.runGit(repoRoot, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
      this.runGit(repoRoot, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
    ]);
    return {
      staged: splitNul(staged.stdout),
      unstaged: splitNul(unstaged.stdout),
      untracked: splitNul(untracked.stdout),
      porcelain: porcelain.stdout.toString("base64"),
    };
  }

  private async indexEntry(
    repoRoot: string,
    relativePath: string,
  ): Promise<string> {
    return (
      await this.runGit(repoRoot, [
        "ls-files",
        "--stage",
        "-z",
        "--",
        relativePath,
      ])
    ).stdout.toString("base64");
  }

  private async resolveAuthorizedPath(
    repoRoot: string,
    relativePath: string,
  ): Promise<AuthorizedPath> {
    if (
      relativePath.length === 0 ||
      relativePath.includes("\0") ||
      isAbsolute(relativePath) ||
      win32.isAbsolute(relativePath)
    ) {
      throw new TaskSnapshotError(
        "unsafe_path",
        "The file path must be project-relative.",
        false,
      );
    }
    const normalized = relativePath.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      ) ||
      segments.some(isUnsafeWindowsSegment)
    ) {
      throw new TaskSnapshotError(
        "unsafe_path",
        "The file path is outside the task capability.",
        false,
      );
    }
    let cursor = repoRoot;
    for (const segment of segments.slice(0, -1)) {
      cursor = join(cursor, segment);
      if (!(await pathExists(cursor))) continue;
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new TaskSnapshotError(
          "unsafe_path",
          "The file path has an unsafe parent.",
          false,
        );
      }
    }
    const absolutePath = resolve(repoRoot, ...segments);
    if (!isInside(repoRoot, absolutePath) || samePath(repoRoot, absolutePath)) {
      throw new TaskSnapshotError(
        "unsafe_path",
        "The file path escapes the project.",
        false,
      );
    }
    if (await pathExists(absolutePath)) {
      const entry = await lstat(absolutePath);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new TaskSnapshotError(
          "unsafe_path",
          "Only regular files are supported.",
          false,
        );
      }
    }
    return { absolutePath, relativePath: segments.join("/") };
  }

  private async createdParentDirectories(
    repoRoot: string,
    absolutePath: string,
  ): Promise<readonly string[]> {
    const created: string[] = [];
    let cursor = dirname(absolutePath);
    while (!samePath(cursor, repoRoot) && !(await pathExists(cursor))) {
      created.push(relative(repoRoot, cursor).split(sep).join("/"));
      cursor = dirname(cursor);
    }
    return created;
  }

  private async captureFileState(
    snapshotDirectory: string,
    manifest: SnapshotManifest,
    absolutePath: string,
  ): Promise<FileState> {
    if (!(await pathExists(absolutePath))) return { kind: "missing" };
    const entry = await lstat(absolutePath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new TaskSnapshotError(
        "unsafe_path",
        "Only regular files can be captured.",
        false,
      );
    }
    this.assertFileBudget(entry.size);
    const content = await readFile(absolutePath);
    return this.saveBlob(
      snapshotDirectory,
      manifest,
      content,
      entry.mode & 0o777,
    );
  }

  private assertFileBudget(size: number): void {
    if (size > (this.options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)) {
      throw new TaskSnapshotError(
        "budget_exceeded",
        "The file exceeds the task snapshot size limit.",
        false,
      );
    }
  }

  private async saveBlob(
    snapshotDirectory: string,
    manifest: SnapshotManifest,
    content: Buffer,
    mode: number,
  ): Promise<PresentFileState> {
    this.assertFileBudget(content.length);
    const hash = sha256(content);
    const blobsDirectory = join(snapshotDirectory, "blobs");
    await mkdir(blobsDirectory, { recursive: true, mode: 0o700 });
    await this.assertPrivateDirectory(blobsDirectory);
    const blobPath = join(blobsDirectory, hash);
    if (await pathExists(blobPath)) {
      const entry = await lstat(blobPath);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new TaskSnapshotError(
          "invalid_snapshot",
          "A task snapshot blob is invalid.",
          false,
        );
      }
    } else {
      const nextTotal = manifest.totalBlobBytes + content.length;
      if (nextTotal > (this.options.maxTaskBytes ?? DEFAULT_MAX_TASK_BYTES)) {
        throw new TaskSnapshotError(
          "budget_exceeded",
          "The task exceeds the snapshot storage limit.",
          false,
        );
      }
      await writeFile(blobPath, content, { flag: "wx", mode: 0o600 });
      manifest.totalBlobBytes = nextTotal;
    }
    return { kind: "file", hash, mode, size: content.length };
  }

  private async readStateContent(
    snapshotDirectory: string,
    state: PresentFileState,
  ): Promise<Buffer> {
    const blobPath = join(snapshotDirectory, "blobs", state.hash);
    const entry = await lstat(blobPath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new TaskSnapshotError(
        "invalid_snapshot",
        "A task snapshot blob is invalid.",
        false,
      );
    }
    const content = await readFile(blobPath);
    if (content.length !== state.size || sha256(content) !== state.hash) {
      throw new TaskSnapshotError(
        "invalid_snapshot",
        "A task snapshot blob is missing or corrupt.",
        false,
      );
    }
    return content;
  }

  private async reverseMerge(
    snapshotDirectory: string,
    manifest: SnapshotManifest,
    before: FileState,
    after: FileState,
    current: FileState,
  ): Promise<
    | { readonly state: PresentFileState }
    | {
        readonly reason: Exclude<
          TaskRestoreConflictReason,
          "head_changed" | "index_entry_changed"
        >;
      }
  > {
    if (
      before.kind !== "file" ||
      after.kind !== "file" ||
      current.kind !== "file"
    ) {
      return { reason: "create_delete_concurrent_change" };
    }
    const [beforeContent, afterContent, currentContent] = await Promise.all([
      this.readStateContent(snapshotDirectory, before),
      this.readStateContent(snapshotDirectory, after),
      this.readStateContent(snapshotDirectory, current),
    ]);
    if (![beforeContent, afterContent, currentContent].every(isUtf8Text)) {
      return { reason: "binary_concurrent_change" };
    }

    const mergeDirectory = await mkdtemp(
      join(tmpdir(), "author-copilot-reverse-merge-"),
    );
    const beforePath = join(mergeDirectory, "before");
    const afterPath = join(mergeDirectory, "after");
    const currentPath = join(mergeDirectory, "current");
    try {
      await Promise.all([
        writeFile(beforePath, beforeContent, { mode: 0o600 }),
        writeFile(afterPath, afterContent, { mode: 0o600 }),
        writeFile(currentPath, currentContent, { mode: 0o600 }),
      ]);
      const result = await this.runGit(
        manifest.repoRoot,
        ["merge-file", "-p", beforePath, afterPath, currentPath],
        [0, 1],
      );
      if (result.exitCode === 1) return { reason: "overlapping_user_edit" };
      return {
        state: await this.saveBlob(
          snapshotDirectory,
          manifest,
          result.stdout,
          current.mode,
        ),
      };
    } finally {
      await rm(mergeDirectory, { recursive: true, force: true });
    }
  }

  private async applyState(
    snapshotDirectory: string,
    repoRoot: string,
    absolutePath: string,
    state: FileState,
    createdDirectories: readonly string[],
  ): Promise<void> {
    if (state.kind === "missing") {
      await rm(absolutePath, { force: true });
      for (const relativeDirectory of createdDirectories) {
        try {
          await rmdir(join(repoRoot, relativeDirectory));
        } catch (error) {
          if (
            !isNodeError(error, "ENOENT") &&
            !isNodeError(error, "ENOTEMPTY")
          ) {
            throw error;
          }
        }
      }
      return;
    }
    await this.atomicWrite(
      absolutePath,
      await this.readStateContent(snapshotDirectory, state),
      state.mode,
    );
  }

  private async atomicWrite(
    absolutePath: string,
    content: Buffer,
    mode: number,
  ): Promise<void> {
    await mkdir(dirname(absolutePath), { recursive: true });
    const temporaryPath = join(
      dirname(absolutePath),
      `.${absolutePath.slice(dirname(absolutePath).length + 1)}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, content, { mode });
      await rename(temporaryPath, absolutePath);
      await chmod(absolutePath, mode);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async loadManifest(
    snapshotDirectory: string,
  ): Promise<SnapshotManifest> {
    let content: string;
    try {
      await this.assertSnapshotDirectory(snapshotDirectory);
      const manifestPath = join(snapshotDirectory, MANIFEST_FILE);
      const entry = await lstat(manifestPath);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new TaskSnapshotError(
          "invalid_snapshot",
          "The task snapshot manifest is invalid.",
          false,
        );
      }
      content = await readFile(manifestPath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        throw new TaskSnapshotError(
          "not_found",
          "The task snapshot was not found.",
          false,
        );
      }
      throw error;
    }
    try {
      const manifest = parseManifest(JSON.parse(content) as unknown);
      manifest.totalBlobBytes = await this.countBlobBytes(snapshotDirectory);
      return manifest;
    } catch (error) {
      if (error instanceof TaskSnapshotError) throw error;
      throw new TaskSnapshotError(
        "invalid_snapshot",
        "The task snapshot is corrupt.",
        false,
      );
    }
  }

  private async countBlobBytes(snapshotDirectory: string): Promise<number> {
    const blobsDirectory = join(snapshotDirectory, "blobs");
    let entries;
    try {
      await this.assertPrivateDirectory(blobsDirectory);
      entries = await readdir(blobsDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return 0;
      throw error;
    }
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}$/u.test(entry.name)) {
        throw new TaskSnapshotError(
          "invalid_snapshot",
          "The task snapshot blob store is invalid.",
          false,
        );
      }
      total += (await lstat(join(blobsDirectory, entry.name))).size;
      if (total > (this.options.maxTaskBytes ?? DEFAULT_MAX_TASK_BYTES)) {
        throw new TaskSnapshotError(
          "invalid_snapshot",
          "The task snapshot exceeds its storage limit.",
          false,
        );
      }
    }
    return total;
  }

  private async saveManifest(
    snapshotDirectory: string,
    manifest: SnapshotManifest,
  ): Promise<void> {
    const target = join(snapshotDirectory, MANIFEST_FILE);
    const temporaryPath = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporaryPath, target);
      await chmod(target, 0o600);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async runGit(
    cwd: string,
    args: readonly string[],
    allowedExitCodes: readonly number[] = [0],
  ): Promise<GitCommandResult> {
    await this.prepareStorage();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes =
      this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.options.gitExecutable, ["-C", cwd, ...args], {
        cwd,
        env: isolatedGitEnvironment(
          join(this.options.isolationDirectory, "config"),
          this.options.runtimeEnvironment,
        ),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(error);
      };
      const collect = (chunks: Buffer[], chunk: Buffer): void => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          fail(
            new TaskSnapshotError(
              "io_failed",
              "Git output exceeded the safety limit.",
              false,
            ),
          );
          return;
        }
        chunks.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.once("error", (error) => {
        fail(
          new TaskSnapshotError(
            "git_unavailable",
            `Git could not start: ${error.message}`,
            true,
          ),
        );
      });
      const timer = setTimeout(() => {
        fail(new TaskSnapshotError("timeout", "Git timed out.", true));
      }, timeoutMs);
      child.once("close", (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const normalizedExitCode = exitCode ?? -1;
        const result = {
          exitCode: normalizedExitCode,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        };
        if (!allowedExitCodes.includes(normalizedExitCode)) {
          reject(
            new TaskSnapshotError(
              "invalid_repository",
              "The repository operation could not be completed.",
              false,
            ),
          );
          return;
        }
        resolvePromise(result);
      });
    });
  }

  private async withProjectLock<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.operationQueue.run(projectId, operation);
  }
}
