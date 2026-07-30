import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import type {
  KnowledgeIndexStatus,
  KnowledgeIndexStatusResult,
  KnowledgeSearchHit,
  TaskCancelledEvent,
  TaskProgressEvent,
} from "@author-copilot/contracts";

import type { DocumentSavedEvent, ProjectService } from "../project/index.js";
import { atomicWriteFile } from "../project/file-utils.js";
import { authorizeExistingDocument } from "../project/path-policy.js";
import { chunkMarkdown, type KnowledgeChunk } from "./chunking.js";
import {
  KnowledgeServiceError,
  KnowledgeTaskCancelledError,
} from "./errors.js";
import {
  buildSqliteKnowledgeIndex,
  replaceSqliteKnowledgeSource,
  searchSqliteKnowledgeIndex,
  verifySqliteKnowledgeIndex,
} from "./sqlite-index.js";

interface IndexedDocument {
  readonly contentHash: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly chunks: readonly KnowledgeChunk[];
}

interface PersistedKnowledgeIndex {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly projectRootHash: string;
  readonly indexVersion: string;
  readonly updatedAt: string;
  readonly documents: Readonly<Record<string, IndexedDocument>>;
}

interface PersistedKnowledgeState {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly status: KnowledgeIndexStatus;
  readonly indexVersion: string | null;
  readonly updatedAt: string | null;
  readonly documentCount: number;
  readonly chunkCount: number;
  readonly activeTaskId: string | null;
  readonly lastError: string | null;
}

interface ActiveTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly controller: AbortController;
  completion: Promise<void>;
}

type KnowledgeTaskEvent = TaskProgressEvent | TaskCancelledEvent;

export interface KnowledgeServiceOptions {
  readonly storageRoot: string;
  readonly projectService: Pick<
    ProjectService,
    "getProjectRoot" | "getStructure" | "readDocument"
  >;
  readonly emitProgress?: (event: TaskProgressEvent) => void;
  readonly emitCancelled?: (event: TaskCancelledEvent) => void;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly yieldControl?: () => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectRootHash(rootPath: string): string {
  return createHash("sha256").update(rootPath).digest("hex");
}

function portableDocumentPaths(
  structure: Awaited<ReturnType<ProjectService["getStructure"]>>,
): readonly string[] {
  const paths: string[] = [];
  const visit = (
    nodes: readonly (
      | Awaited<ReturnType<ProjectService["getStructure"]>>["nodes"][number]
      | Awaited<
          ReturnType<ProjectService["getStructure"]>
        >["unclassified"][number]
    )[],
  ): void => {
    for (const node of nodes) {
      if (node.kind === "document") paths.push(node.relativePath);
      else visit(node.children);
    }
  };
  visit(structure.nodes);
  visit(structure.unclassified);
  return paths.sort((left, right) => left.localeCompare(right));
}

function stateFromIndex(
  index: PersistedKnowledgeIndex,
  overrides: Partial<PersistedKnowledgeState> = {},
): PersistedKnowledgeState {
  return {
    schemaVersion: 1,
    projectId: index.projectId,
    status: "ready",
    indexVersion: index.indexVersion,
    updatedAt: index.updatedAt,
    documentCount: Object.keys(index.documents).length,
    chunkCount: Object.values(index.documents).reduce(
      (count, document) => count + document.chunks.length,
      0,
    ),
    activeTaskId: null,
    lastError: null,
    ...overrides,
  };
}

function emptyState(projectId: string): PersistedKnowledgeState {
  return {
    schemaVersion: 1,
    projectId,
    status: "not_initialized",
    indexVersion: null,
    updatedAt: null,
    documentCount: 0,
    chunkCount: 0,
    activeTaskId: null,
    lastError: null,
  };
}

function publicState(
  state: PersistedKnowledgeState,
): KnowledgeIndexStatusResult {
  return {
    projectId: state.projectId,
    status: state.status,
    indexVersion: state.indexVersion,
    updatedAt: state.updatedAt,
    documentCount: state.documentCount,
    chunkCount: state.chunkCount,
    activeTaskId: state.activeTaskId,
    lastError: state.lastError,
  };
}

function parseState(
  value: unknown,
  projectId: string,
): PersistedKnowledgeState {
  const validStatus = [
    "not_initialized",
    "updating",
    "ready",
    "stale",
  ].includes(String(isRecord(value) ? value.status : ""));
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.projectId !== projectId ||
    !validStatus ||
    !Number.isInteger(value.documentCount) ||
    Number(value.documentCount) < 0 ||
    !Number.isInteger(value.chunkCount) ||
    Number(value.chunkCount) < 0 ||
    !(
      value.indexVersion === null ||
      (typeof value.indexVersion === "string" && value.indexVersion.length > 0)
    ) ||
    !(
      value.updatedAt === null ||
      (typeof value.updatedAt === "string" &&
        !Number.isNaN(Date.parse(value.updatedAt)))
    ) ||
    !(value.activeTaskId === null || typeof value.activeTaskId === "string") ||
    !(value.lastError === null || typeof value.lastError === "string")
  ) {
    throw new KnowledgeServiceError(
      "io_failed",
      "The knowledge index state is invalid.",
      true,
    );
  }
  return value as unknown as PersistedKnowledgeState;
}

function parseIndex(
  value: unknown,
  projectId: string,
): PersistedKnowledgeIndex {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.projectId !== projectId ||
    typeof value.projectRootHash !== "string" ||
    typeof value.indexVersion !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.documents)
  ) {
    throw new KnowledgeServiceError(
      "io_failed",
      "The knowledge index is invalid.",
      true,
    );
  }
  return value as unknown as PersistedKnowledgeIndex;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Knowledge indexing failed.";
}

export class KnowledgeService {
  private readonly options: Required<
    Pick<KnowledgeServiceOptions, "createId" | "now" | "yieldControl">
  > &
    KnowledgeServiceOptions;
  private readonly activeByProject = new Map<string, ActiveTask>();
  private readonly activeByTask = new Map<string, ActiveTask>();
  private readonly updateQueues = new Map<string, Promise<void>>();
  private readonly taskListeners = new Set<
    (event: KnowledgeTaskEvent) => void
  >();

  constructor(options: KnowledgeServiceOptions) {
    this.options = {
      ...options,
      createId: options.createId ?? randomUUID,
      now: options.now ?? (() => new Date()),
      yieldControl: options.yieldControl ?? (() => yieldToEventLoop()),
    };
  }

  async getStatus(projectId: string): Promise<KnowledgeIndexStatusResult> {
    await this.options.projectService.getProjectRoot(projectId);
    let state = await this.readRecoverableState(projectId);
    if (state.status === "updating" && !this.activeByProject.has(projectId)) {
      state = await this.fallbackState(
        projectId,
        "Indexing was interrupted before completion.",
      );
    }
    if (state.status === "ready") {
      state = await this.verifyIntegrity(projectId, state);
    }
    return publicState(state);
  }

  subscribe(listener: (event: KnowledgeTaskEvent) => void): () => void {
    this.taskListeners.add(listener);
    return () => this.taskListeners.delete(listener);
  }

  async initialize(projectId: string): Promise<KnowledgeIndexStatusResult> {
    return this.startFullIndex(projectId, false);
  }

  async rebuild(projectId: string): Promise<KnowledgeIndexStatusResult> {
    return this.startFullIndex(projectId, true);
  }

  cancel(taskId: string): boolean {
    const task = this.activeByTask.get(taskId);
    if (task === undefined || task.controller.signal.aborted) return false;
    task.controller.abort();
    return true;
  }

  async waitForIdle(projectId: string): Promise<void> {
    await this.activeByProject.get(projectId)?.completion;
    await this.updateQueues.get(projectId);
  }

  async search(
    projectId: string,
    query: string,
    limit: number,
  ): Promise<{
    readonly status: KnowledgeIndexStatusResult;
    readonly hits: readonly KnowledgeSearchHit[];
  }> {
    const status = await this.getStatus(projectId);
    if (status.status !== "ready" || status.indexVersion === null) {
      throw new KnowledgeServiceError(
        "unavailable",
        "The knowledge index is not ready.",
        true,
      );
    }
    const index = await this.readIndex(projectId);
    const candidates = searchSqliteKnowledgeIndex({
      databasePath: this.databasePath(projectId),
      projectId,
      indexVersion: index.indexVersion,
      query,
      limit,
    });

    const verifiedPaths = new Set<string>();
    for (const candidate of candidates) {
      if (verifiedPaths.has(candidate.relativePath)) continue;
      const current = await this.options.projectService.readDocument(
        projectId,
        candidate.relativePath,
      );
      if (
        current.hash !== index.documents[candidate.relativePath]?.contentHash
      ) {
        await this.writeState(
          stateFromIndex(index, {
            status: "stale",
            lastError: "A source document changed outside the index.",
          }),
        );
        throw new KnowledgeServiceError(
          "unavailable",
          "A source document changed. Rebuild the knowledge index.",
          true,
        );
      }
      verifiedPaths.add(candidate.relativePath);
    }

    return {
      status,
      hits: candidates.map((candidate) => ({
        relativePath: candidate.relativePath,
        titleContext: [...candidate.titleContext],
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        score: candidate.score,
        text: candidate.text,
        indexVersion: index.indexVersion,
      })),
    };
  }

  handleDocumentSaved = (event: DocumentSavedEvent): void => {
    const predecessor =
      this.updateQueues.get(event.projectId) ?? Promise.resolve();
    const update = predecessor
      .then(async () => {
        await this.activeByProject.get(event.projectId)?.completion;
        await this.incrementalUpdate(event);
      })
      .catch(async (error: unknown) => {
        const state = await this.readState(event.projectId).catch(
          () => undefined,
        );
        if (state?.status === "ready") {
          await this.writeState({
            ...state,
            status: "stale",
            activeTaskId: null,
            lastError: errorMessage(error),
          }).catch(() => undefined);
        }
      });
    this.updateQueues.set(event.projectId, update);
    void update.finally(() => {
      if (this.updateQueues.get(event.projectId) === update) {
        this.updateQueues.delete(event.projectId);
      }
    });
  };

  private async startFullIndex(
    projectId: string,
    rebuild: boolean,
  ): Promise<KnowledgeIndexStatusResult> {
    await this.options.projectService.getProjectRoot(projectId);
    if (this.activeByProject.has(projectId)) {
      throw new KnowledgeServiceError(
        "conflict",
        "A knowledge indexing task is already running for this project.",
        true,
      );
    }
    const previous = await this.readRecoverableState(projectId);
    if (!rebuild && previous.status === "ready") {
      throw new KnowledgeServiceError(
        "conflict",
        "The knowledge index is already initialized.",
        false,
      );
    }

    const task: ActiveTask = {
      projectId,
      taskId: this.options.createId(),
      controller: new AbortController(),
      completion: Promise.resolve(),
    };
    const updating: PersistedKnowledgeState = {
      ...previous,
      status: "updating",
      activeTaskId: task.taskId,
      lastError: null,
    };
    await this.writeState(updating);
    this.activeByProject.set(projectId, task);
    this.activeByTask.set(task.taskId, task);
    task.completion = new Promise<void>((resolve) => {
      setImmediate(() => resolve(this.runFullIndex(task, previous)));
    }).finally(() => {
      this.activeByProject.delete(projectId);
      this.activeByTask.delete(task.taskId);
    });
    void task.completion.catch(() => undefined);
    return publicState(updating);
  }

  private async runFullIndex(
    task: ActiveTask,
    previous: PersistedKnowledgeState,
  ): Promise<void> {
    try {
      const rootPath = await this.options.projectService.getProjectRoot(
        task.projectId,
      );
      const structure = await this.options.projectService.getStructure(
        task.projectId,
      );
      const paths = portableDocumentPaths(structure);
      const total = Math.max(1, paths.length);
      const documents: Record<string, IndexedDocument> = {};
      this.emitProgress(task, "scan", 0, total);
      for (const [index, relativePath] of paths.entries()) {
        this.throwIfCancelled(task);
        const document = await this.readIndexedDocument(
          task.projectId,
          rootPath,
          relativePath,
        );
        documents[relativePath] = document;
        this.emitProgress(task, "index", index + 1, total);
        await this.options.yieldControl();
      }
      this.throwIfCancelled(task);

      const persisted: PersistedKnowledgeIndex = {
        schemaVersion: 1,
        projectId: task.projectId,
        projectRootHash: projectRootHash(rootPath),
        indexVersion: this.options.createId(),
        updatedAt: this.options.now().toISOString(),
        documents,
      };
      await buildSqliteKnowledgeIndex({
        databasePath: this.databasePath(task.projectId),
        projectId: task.projectId,
        indexVersion: persisted.indexVersion,
        chunks: Object.values(documents).flatMap((document) => document.chunks),
        afterBatch: async () => {
          this.throwIfCancelled(task);
          await this.options.yieldControl();
        },
      });
      this.throwIfCancelled(task);
      await this.writeIndex(persisted);
      const ready = stateFromIndex(persisted);
      await this.writeState(ready);
      this.emitProgress(task, "complete", total, total);
    } catch (error) {
      if (
        error instanceof KnowledgeTaskCancelledError ||
        task.controller.signal.aborted
      ) {
        await this.restoreAfterFailedTask(previous, "Indexing was cancelled.");
        this.emitTaskEvent({
          type: "task.cancelled",
          taskId: task.taskId,
          taskKind: "index_initialize",
          reason: "user",
          timestamp: this.options.now().toISOString(),
        });
        return;
      }
      await this.restoreAfterFailedTask(previous, errorMessage(error));
    }
  }

  private async restoreAfterFailedTask(
    previous: PersistedKnowledgeState,
    message: string,
  ): Promise<void> {
    await this.writeState({
      ...previous,
      status: previous.indexVersion === null ? "not_initialized" : "stale",
      activeTaskId: null,
      lastError: message,
    });
  }

  private async incrementalUpdate(event: DocumentSavedEvent): Promise<void> {
    const state = await this.readState(event.projectId);
    if (state.status !== "ready") return;
    const index = await this.readIndex(event.projectId);
    const rootPath = await this.options.projectService.getProjectRoot(
      event.projectId,
    );
    if (index.projectRootHash !== projectRootHash(rootPath)) {
      await this.writeState({
        ...state,
        status: "stale",
        lastError: "The registered project path changed.",
      });
      return;
    }
    const document = await this.readIndexedDocument(
      event.projectId,
      rootPath,
      event.relativePath,
    );
    const updated: PersistedKnowledgeIndex = {
      ...index,
      indexVersion: this.options.createId(),
      updatedAt: this.options.now().toISOString(),
      documents: { ...index.documents, [event.relativePath]: document },
    };
    replaceSqliteKnowledgeSource({
      databasePath: this.databasePath(event.projectId),
      projectId: event.projectId,
      previousIndexVersion: index.indexVersion,
      nextIndexVersion: updated.indexVersion,
      relativePath: event.relativePath,
      chunks: document.chunks,
    });
    await this.writeIndex(updated);
    await this.writeState(stateFromIndex(updated));
  }

  private async readIndexedDocument(
    projectId: string,
    rootPath: string,
    relativePath: string,
  ): Promise<IndexedDocument> {
    const documentPath = await authorizeExistingDocument(
      rootPath,
      relativePath,
    );
    const [document, documentStats] = await Promise.all([
      this.options.projectService.readDocument(projectId, relativePath),
      lstat(documentPath),
    ]);
    return {
      contentHash: document.hash,
      mtimeMs: documentStats.mtimeMs,
      size: documentStats.size,
      chunks: chunkMarkdown(relativePath, document.content),
    };
  }

  private async verifyIntegrity(
    projectId: string,
    state: PersistedKnowledgeState,
  ): Promise<PersistedKnowledgeState> {
    try {
      const [rootPath, structure, index] = await Promise.all([
        this.options.projectService.getProjectRoot(projectId),
        this.options.projectService.getStructure(projectId),
        this.readIndex(projectId),
      ]);
      const paths = portableDocumentPaths(structure);
      verifySqliteKnowledgeIndex({
        databasePath: this.databasePath(projectId),
        projectId,
        indexVersion: index.indexVersion,
      });
      const indexedPaths = Object.keys(index.documents).sort((left, right) =>
        left.localeCompare(right),
      );
      if (
        index.projectRootHash !== projectRootHash(rootPath) ||
        paths.length !== indexedPaths.length ||
        paths.some((path, index) => path !== indexedPaths[index])
      ) {
        return this.markStale(state, "The project document set changed.");
      }
      for (const relativePath of paths) {
        const documentPath = await authorizeExistingDocument(
          rootPath,
          relativePath,
        );
        const documentStats = await lstat(documentPath);
        const indexed = index.documents[relativePath];
        if (
          indexed === undefined ||
          indexed.size !== documentStats.size ||
          indexed.mtimeMs !== documentStats.mtimeMs
        ) {
          return this.markStale(state, "A project document changed on disk.");
        }
      }
      return state;
    } catch (error) {
      return this.markStale(state, errorMessage(error));
    }
  }

  private async markStale(
    state: PersistedKnowledgeState,
    message: string,
  ): Promise<PersistedKnowledgeState> {
    const stale = { ...state, status: "stale" as const, lastError: message };
    await this.writeState(stale);
    return stale;
  }

  private async fallbackState(
    projectId: string,
    message: string,
  ): Promise<PersistedKnowledgeState> {
    try {
      const index = await this.readIndex(projectId);
      const stale = stateFromIndex(index, {
        status: "stale",
        activeTaskId: null,
        lastError: message,
      });
      await this.writeState(stale);
      return stale;
    } catch {
      const state = { ...emptyState(projectId), lastError: message };
      await this.writeState(state);
      return state;
    }
  }

  private emitProgress(
    task: ActiveTask,
    phase: string,
    completed: number,
    total: number,
  ): void {
    this.emitTaskEvent({
      type: "task.progress",
      taskId: task.taskId,
      taskKind: "index_initialize",
      phase,
      completed,
      total,
      timestamp: this.options.now().toISOString(),
    });
  }

  private emitTaskEvent(event: KnowledgeTaskEvent): void {
    try {
      if (event.type === "task.progress") this.options.emitProgress?.(event);
      else this.options.emitCancelled?.(event);
    } catch {
      // UI event delivery must not change the durable task result.
    }
    for (const listener of this.taskListeners) {
      try {
        listener(event);
      } catch {
        // A closed renderer cannot fail an index task that already completed.
      }
    }
  }

  private throwIfCancelled(task: ActiveTask): void {
    if (task.controller.signal.aborted) {
      throw new KnowledgeTaskCancelledError();
    }
  }

  private projectDirectory(projectId: string): string {
    return join(this.options.storageRoot, projectId);
  }

  private databasePath(projectId: string): string {
    return join(this.projectDirectory(projectId), "search.db");
  }

  private async readState(projectId: string): Promise<PersistedKnowledgeState> {
    try {
      return parseState(
        JSON.parse(
          await readFile(
            join(this.projectDirectory(projectId), "state.json"),
            "utf8",
          ),
        ),
        projectId,
      );
    } catch (error) {
      if (isMissingFile(error)) return emptyState(projectId);
      throw error;
    }
  }

  private async readRecoverableState(
    projectId: string,
  ): Promise<PersistedKnowledgeState> {
    try {
      return await this.readState(projectId);
    } catch (error) {
      return this.fallbackState(
        projectId,
        `The knowledge index state could not be read: ${errorMessage(error)}`,
      );
    }
  }

  private async readIndex(projectId: string): Promise<PersistedKnowledgeIndex> {
    try {
      return parseIndex(
        JSON.parse(
          await readFile(
            join(this.projectDirectory(projectId), "index.json"),
            "utf8",
          ),
        ),
        projectId,
      );
    } catch (error) {
      if (isMissingFile(error)) {
        throw new KnowledgeServiceError(
          "not_found",
          "The knowledge index does not exist.",
          true,
        );
      }
      throw error;
    }
  }

  private async writeState(state: PersistedKnowledgeState): Promise<void> {
    const directory = this.projectDirectory(state.projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await atomicWriteFile(
      join(directory, "state.json"),
      `${JSON.stringify(state, undefined, 2)}\n`,
      0o600,
    );
  }

  private async writeIndex(index: PersistedKnowledgeIndex): Promise<void> {
    const directory = this.projectDirectory(index.projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await atomicWriteFile(
      join(directory, "index.json"),
      `${JSON.stringify(index)}\n`,
      0o600,
    );
  }
}
