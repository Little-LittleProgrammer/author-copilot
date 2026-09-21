import { AiRouteError } from "../provider-service.js";
import type { AiRoute, ProviderService } from "../provider-service.js";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentStartRequestSchema,
  type AgentStartRequest,
  type AgentState,
  type AgentTaskCapability,
  type AgentTaskEvent,
  type AppError,
} from "@author-copilot/contracts";
import type { SecureCredentialStore } from "../../credentials/index.js";
import {
  TaskSnapshotError,
  type TaskSnapshotService,
} from "../../git/index.js";
import type { ProjectService } from "../../project/index.js";
import type { AgentCapabilityService } from "./capability-service.js";
import type { AgentTaskRuntimeService } from "./task-runtime-service.js";
import type { AgentTaskStartService } from "./task-start-service.js";

export class AgentServiceError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
  }
}
export function agentFailure(error: unknown): AppError {
  if (error instanceof AgentServiceError) return error.appError;
  if (error instanceof AiRouteError)
    return { code: "AI_UNAVAILABLE", message: error.message, retryable: false };
  if (error instanceof TaskSnapshotError)
    return {
      code:
        error.code === "task_conflict"
          ? "CONFLICT"
          : error.code === "unsafe_path"
            ? "PATH_NOT_AUTHORIZED"
            : "GIT_FAILED",
      message: error.message,
      retryable: error.retryable,
    };
  return {
    code: "IO_FAILED",
    message:
      "The Agent operation could not be completed. Your task snapshot is preserved.",
    retryable: true,
  };
}
interface ActiveTask {
  ownerId: number;
  taskId?: string;
  cancelled: boolean;
  event?: AgentTaskEvent;
  done: Promise<void>;
  finish: () => void;
}
export interface AgentTaskServiceOptions {
  providers?: ProviderService;
  startService: Pick<AgentTaskStartService, "start">;
  runtime: Pick<AgentTaskRuntimeService, "execute" | "cancel" | "shutdown">;
  capabilities: Pick<AgentCapabilityService, "revoke" | "revokeAll">;
  snapshots: TaskSnapshotService;
  projects: Pick<ProjectService, "getProjectRoot">;
  credentials: Pick<SecureCredentialStore, "getApiKey">;
  configRoot: string;
  onFilesChanged?: (projectId: string) => Promise<void>;
}
export class AgentTaskService {
  private readonly active = new Map<string, ActiveTask>();
  private readonly settling = new Map<string, Promise<void>>();
  private stopping = false;
  constructor(private readonly options: AgentTaskServiceOptions) {}

  assertIdle(projectId: string): void {
    if (this.active.has(projectId) || this.settling.has(projectId))
      throw new AgentServiceError({
        code: "CONFLICT",
        message: "Wait for the Agent task operation to finish.",
        retryable: false,
      });
  }

  async start(
    input: AgentStartRequest,
    ownerId: number,
    emit: (event: AgentTaskEvent) => void,
  ): Promise<AgentTaskCapability> {
    const request = AgentStartRequestSchema.parse(input);
    this.assertIdle(request.projectId);
    if (this.stopping)
      throw new AgentServiceError({
        code: "CANCELLED",
        message: "The application is shutting down.",
        retryable: false,
      });
    let finish = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const active: ActiveTask = { ownerId, cancelled: false, done, finish };
    this.active.set(request.projectId, active);
    let route: AiRoute | undefined;
    try {
      const snapshot = await this.options.providers?.snapshot();
      const apiKey = snapshot
        ? (snapshot.apiKey ?? "platform-pending")
        : await this.options.credentials.getApiKey("anthropic");
      if (apiKey === null)
        throw new AgentServiceError({
          code: "AI_UNAVAILABLE",
          message:
            "Configure your Anthropic API key before starting an Agent task.",
          retryable: false,
        });
      const projectRoot = await this.options.projects.getProjectRoot(
        request.projectId,
      );
      if (active.cancelled)
        throw new AgentServiceError({
          code: "CANCELLED",
          message: "The task was cancelled before it started.",
          retryable: false,
        });
      const { prompt, ...grant } = request;
      const { capability } = await this.options.startService.start(grant);
      active.taskId = capability.taskId;
      if (snapshot && this.options.providers)
        route = await this.options.providers.resolve(snapshot, {
          taskId: capability.taskId,
          durationMs: Math.max(1000, Math.min(900000, capability.timeoutMs)),
        });
      const configDirectory = join(this.options.configRoot, capability.taskId);
      await mkdir(configDirectory, { recursive: true, mode: 0o700 });
      // Dispatch on the next turn so the IPC response can establish the task UI.
      setImmediate(() => {
        void this.execute(
          active,
          capability,
          {
            prompt,
            projectRoot,
            configDirectory,
            apiKey: route?.apiKey ?? apiKey,
            ...(route
              ? {
                  baseURL: route.baseURL,
                  model: route.model,
                  release: route.release,
                }
              : {}),
          },
          emit,
        );
      });
      return capability;
    } catch (error) {
      await route?.release?.().catch(() => undefined);
      if (active.taskId !== undefined)
        this.options.capabilities.revoke(active.taskId);
      this.active.delete(request.projectId);
      active.finish();
      throw error;
    }
  }

  private async execute(
    active: ActiveTask,
    capability: AgentTaskCapability,
    input: {
      prompt: string;
      projectRoot: string;
      configDirectory: string;
      apiKey: string;
      baseURL?: string;
      model?: string;
      release?: (() => Promise<void>) | undefined;
    },
    emit: (event: AgentTaskEvent) => void,
  ): Promise<void> {
    let terminal: AgentTaskEvent;
    const publish = (event: AgentTaskEvent): void => {
      active.event = event;
      try {
        emit(event);
      } catch {
        /* A closed renderer cannot interrupt cleanup. */
      }
    };
    try {
      if (active.cancelled) {
        this.options.capabilities.revoke(capability.taskId);
        terminal = {
          type: "agent.task.cancelled",
          taskId: capability.taskId,
          projectId: capability.projectId,
          sequence: 0,
          timestamp: new Date().toISOString(),
          reason: "shutdown",
        };
      } else {
        terminal = await this.options.runtime.execute(
          {
            ...input,
            taskId: capability.taskId,
            projectId: capability.projectId,
          },
          (event) => {
            // Terminal events are delivered only once their journal is durable.
            if (
              event.type === "agent.task.started" ||
              event.type === "agent.task.progress"
            )
              publish(event);
          },
        );
      }
    } catch (error) {
      terminal = {
        type: "agent.task.failed",
        taskId: capability.taskId,
        projectId: capability.projectId,
        sequence: (active.event?.sequence ?? 0) + 1,
        timestamp: new Date().toISOString(),
        error: agentFailure(error),
      };
    }
    try {
      this.options.capabilities.revoke(capability.taskId);
      await this.options.snapshots.saveTaskEvent(
        capability.projectId,
        capability.taskId,
        terminal,
      );
      await this.options.onFilesChanged?.(capability.projectId);
    } catch {
      terminal = {
        type: "agent.task.failed",
        taskId: capability.taskId,
        projectId: capability.projectId,
        sequence: terminal.sequence + 1,
        timestamp: new Date().toISOString(),
        error: {
          code: "IO_FAILED",
          message:
            "The task stopped, but its result could not be finalized. Review the recovery snapshot.",
          retryable: true,
        },
      };
    } finally {
      await input.release?.().catch(() => undefined);
      await rm(input.configDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      this.active.delete(capability.projectId);
      active.finish();
      publish(terminal);
    }
  }

  cancel(projectId: string, taskId: string, ownerId: number): boolean {
    const active = this.active.get(projectId);
    if (
      active === undefined ||
      active.ownerId !== ownerId ||
      active.taskId !== taskId
    )
      return false;
    active.cancelled = true;
    this.options.runtime.cancel(taskId);
    return true;
  }
  cancelOwner(ownerId: number): void {
    for (const active of this.active.values()) {
      if (active.ownerId !== ownerId) continue;
      active.cancelled = true;
      if (active.taskId !== undefined)
        this.options.runtime.cancel(active.taskId);
    }
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const active of this.active.values()) active.cancelled = true;
    this.options.capabilities.revokeAll();
    this.options.runtime.shutdown();
    await Promise.all([...this.active.values()].map((active) => active.done));
    await Promise.all(this.settling.values());
  }
  async getState(projectId: string): Promise<AgentState> {
    const active = this.active.get(projectId);
    if (active !== undefined)
      return {
        running: true,
        ...(active.taskId === undefined ? {} : { taskId: active.taskId }),
        ...(active.event === undefined ? {} : { event: active.event }),
      };
    const recovery = (
      await this.options.snapshots.listRecoveries(projectId)
    )[0];
    if (recovery === undefined) return { running: false };
    const result = await this.options.snapshots.getTaskReview(
      projectId,
      recovery.taskId,
    );
    return {
      running: false,
      taskId: recovery.taskId,
      ...result,
    };
  }
  private beginSettlement(projectId: string): () => void {
    let finish = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.settling.set(projectId, done);
    return () => {
      this.settling.delete(projectId);
      finish();
    };
  }

  async retain(
    projectId: string,
    taskId: string,
    digest: string,
  ): Promise<string | null> {
    this.assertIdle(projectId);
    const finish = this.beginSettlement(projectId);
    try {
      const commit = await this.options.snapshots.retainTaskSnapshot(
        projectId,
        taskId,
        digest,
      );
      return commit;
    } catch (error) {
      await this.options.snapshots
        .saveTaskVersionError(projectId, taskId, agentFailure(error))
        .catch(() => undefined);
      throw error;
    } finally {
      finish();
    }
  }
  async restore(
    projectId: string,
    taskId: string,
  ): ReturnType<TaskSnapshotService["restoreTaskSnapshot"]> {
    this.assertIdle(projectId);
    const finish = this.beginSettlement(projectId);
    try {
      const result = await this.options.snapshots.restoreTaskSnapshot(
        projectId,
        taskId,
      );
      await this.options.onFilesChanged?.(projectId);
      return result;
    } finally {
      finish();
    }
  }
}
