import {
  query,
  type Options,
  type SDKMessage,
  type SDKResultError,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  AGENT_TASK_MAX_SUMMARY_CHARACTERS,
  type AgentTaskEvent,
  type AgentTaskProgressPhase,
  type AgentTaskTerminalEvent,
  type AppError,
} from "@author-copilot/contracts";

import { normalizeClaudeError } from "../errors.js";
import type { AgentCapabilityService } from "./capability-service.js";
import type { AgentFileToolService } from "./file-tool-service.js";
import {
  AgentProcessTerminationError,
  AgentSdkProcessTree,
} from "./process-tree.js";
import { buildAgentSdkOptions } from "./sdk-policy.js";
import { createAgentMcpServer } from "./tool-server.js";

const MAX_AGENT_PROMPT_CHARACTERS = 200_000;

type AgentTaskAbortReason = "shutdown" | "timeout" | "user";
type AgentTaskEventType = AgentTaskEvent["type"];
type AgentTaskEventOfType<Type extends AgentTaskEventType> = Extract<
  AgentTaskEvent,
  { readonly type: Type }
>;
type AgentTaskEventPayload<Type extends AgentTaskEventType> =
  Type extends AgentTaskEventType
    ? Omit<
        AgentTaskEventOfType<Type>,
        "projectId" | "sequence" | "taskId" | "timestamp"
      >
    : never;

interface AgentSdkQueryHandle extends AsyncIterable<SDKMessage> {
  close(): void;
}

type AgentSdkQueryFactory = (input: {
  readonly prompt: string;
  readonly options: Options;
}) => AgentSdkQueryHandle;

interface AgentProcessTreeHandle {
  readonly spawn: NonNullable<Options["spawnClaudeCodeProcess"]>;
  terminate(): Promise<void>;
}

interface TaskEventContext {
  readonly taskId: string;
  readonly projectId: string;
  readonly emit: (event: AgentTaskEvent) => void;
  sequence: number;
  lastProgressPhase?: AgentTaskProgressPhase;
}

interface ActiveAgentTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly controller: AbortController;
  readonly query: AgentSdkQueryHandle;
  readonly processTree: AgentProcessTreeHandle;
  abortReason?: AgentTaskAbortReason;
  closing: boolean;
  termination?: Promise<void>;
}

export interface AgentTaskRuntimeServiceOptions {
  readonly capabilityService: Pick<
    AgentCapabilityService,
    "authorize" | "authorizeTask" | "revoke"
  >;
  readonly fileTools: AgentFileToolService;
  readonly createQuery?: AgentSdkQueryFactory;
  readonly createProcessTree?: () => AgentProcessTreeHandle;
  readonly now?: () => Date;
}

export interface AgentTaskExecutionRequest {
  readonly taskId: string;
  readonly projectId: string;
  readonly prompt: string;
  readonly projectRoot: string;
  readonly configDirectory: string;
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly sourceEnvironment?: NodeJS.ProcessEnv;
}

export class AgentTaskRuntimeError extends Error {
  constructor(
    readonly code: "invalid_prompt" | "task_running",
    message: string,
  ) {
    super(message);
    this.name = "AgentTaskRuntimeError";
  }
}

function sdkProgressPhase(message: SDKMessage): AgentTaskProgressPhase {
  if (message.type === "result") return "finalizing";
  if (message.type === "assistant" || message.type === "stream_event") {
    return "responding";
  }
  if (message.type === "tool_progress" || message.type === "tool_use_summary") {
    return "tool";
  }
  const subtype =
    "subtype" in message && typeof message.subtype === "string"
      ? message.subtype
      : undefined;
  if (subtype === "init") return "initializing";
  if (
    subtype === "permission_denied" ||
    subtype === "task_notification" ||
    subtype === "task_progress" ||
    subtype === "task_started" ||
    subtype === "task_updated"
  ) {
    return "tool";
  }
  return "running";
}

function sdkResultError(result: SDKResultError): AppError {
  if (result.subtype === "error_max_turns") {
    return {
      code: "AI_UNAVAILABLE",
      message: "The Agent stopped after reaching its turn limit.",
      retryable: false,
    };
  }
  if (result.subtype === "error_max_budget_usd") {
    return {
      code: "AI_UNAVAILABLE",
      message: "The Agent stopped after reaching its task budget.",
      retryable: false,
    };
  }
  if (result.subtype === "error_max_structured_output_retries") {
    return {
      code: "AI_UNAVAILABLE",
      message: "The Agent could not produce a valid structured result.",
      retryable: false,
    };
  }
  return {
    code: "AI_UNAVAILABLE",
    message: "The Agent failed during execution.",
    retryable: true,
  };
}

function missingResultError(): AppError {
  return {
    code: "AI_UNAVAILABLE",
    message: "The Agent ended without a terminal result.",
    retryable: true,
  };
}

function processTerminationError(): AppError {
  return {
    code: "INTERNAL_ERROR",
    message: "The Agent process tree could not be terminated safely.",
    retryable: true,
  };
}

export class AgentTaskRuntimeService {
  private readonly activeByTask = new Map<string, ActiveAgentTask>();
  private readonly activeByProject = new Map<string, ActiveAgentTask>();
  private readonly createQuery: AgentSdkQueryFactory;
  private readonly createProcessTree: () => AgentProcessTreeHandle;
  private readonly now: () => Date;

  constructor(private readonly options: AgentTaskRuntimeServiceOptions) {
    this.createQuery = options.createQuery ?? query;
    this.createProcessTree =
      options.createProcessTree ?? (() => new AgentSdkProcessTree());
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    input: AgentTaskExecutionRequest,
    emit: (event: AgentTaskEvent) => void,
  ): Promise<AgentTaskTerminalEvent> {
    this.assertCanExecute(input);
    const capability = this.options.capabilityService.authorizeTask({
      taskId: input.taskId,
      projectId: input.projectId,
    });
    const events: TaskEventContext = {
      taskId: input.taskId,
      projectId: input.projectId,
      emit,
      sequence: 0,
    };
    const controller = new AbortController();
    let processTree: AgentProcessTreeHandle | undefined;
    let active: ActiveAgentTask | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let sdkResult: SDKResultMessage | undefined;
    let terminal:
      | { readonly status: "cancelled"; readonly reason: AgentTaskAbortReason }
      | { readonly status: "completed"; readonly result: SDKResultMessage }
      | { readonly status: "failed"; readonly error: AppError };

    try {
      this.emit(events, { type: "agent.task.started" });
      processTree = this.createProcessTree();
      const mcpServer = createAgentMcpServer({
        capability,
        fileTools: this.options.fileTools,
      });
      const sdkOptions = buildAgentSdkOptions({
        capability,
        capabilityService: this.options.capabilityService,
        projectRoot: input.projectRoot,
        configDirectory: input.configDirectory,
        apiKey: input.apiKey,
        ...(input.baseURL ? { baseURL: input.baseURL } : {}),
        ...(input.model ? { model: input.model } : {}),
        mcpServer,
        spawnClaudeCodeProcess: processTree.spawn,
        ...(input.sourceEnvironment === undefined
          ? {}
          : { sourceEnvironment: input.sourceEnvironment }),
      });
      const sdkQuery = this.createQuery({
        prompt: input.prompt,
        options: { ...sdkOptions, abortController: controller },
      });
      active = {
        taskId: input.taskId,
        projectId: input.projectId,
        controller,
        query: sdkQuery,
        processTree,
        closing: false,
      };
      this.activeByTask.set(active.taskId, active);
      this.activeByProject.set(active.projectId, active);
      timeout = setTimeout(
        () => {
          if (active !== undefined) this.requestCancellation(active, "timeout");
        },
        Math.min(
          capability.timeoutMs,
          Math.max(
            0,
            Date.parse(capability.createdAt) +
              capability.timeoutMs -
              this.now().getTime(),
          ),
        ),
      );
      timeout.unref();

      for await (const message of sdkQuery) {
        if (active.closing) break;
        this.emitProgress(events, sdkProgressPhase(message));
        if (message.type === "result") sdkResult = message;
      }
      if (active.abortReason !== undefined) {
        terminal = { status: "cancelled", reason: active.abortReason };
      } else if (sdkResult === undefined) {
        terminal = { status: "failed", error: missingResultError() };
      } else if (sdkResult.subtype === "success") {
        terminal = { status: "completed", result: sdkResult };
      } else {
        terminal = { status: "failed", error: sdkResultError(sdkResult) };
      }
    } catch (error) {
      terminal =
        active?.abortReason === undefined
          ? { status: "failed", error: normalizeClaudeError(error) }
          : { status: "cancelled", reason: active.abortReason };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (active === undefined) {
        controller.abort();
        this.options.capabilityService.revoke(input.taskId);
      } else {
        this.beginClose(active);
      }
      try {
        await (active?.termination ??
          processTree?.terminate() ??
          Promise.resolve());
      } catch (error) {
        if (error instanceof AgentProcessTerminationError) {
          terminal = { status: "failed", error: processTerminationError() };
        } else {
          terminal = { status: "failed", error: normalizeClaudeError(error) };
        }
      } finally {
        await this.options.fileTools.drain(input.taskId);
        if (active !== undefined) this.remove(active);
      }
    }

    return this.emitTerminal(
      events,
      terminal ?? { status: "failed", error: missingResultError() },
    );
  }

  cancel(taskId: string): boolean {
    const active = this.activeByTask.get(taskId);
    if (active === undefined || active.closing) return false;
    this.requestCancellation(active, "user");
    return true;
  }

  shutdown(): void {
    for (const active of this.activeByTask.values()) {
      this.requestCancellation(active, "shutdown");
    }
  }

  private assertCanExecute(input: AgentTaskExecutionRequest): void {
    if (
      input.prompt.trim().length === 0 ||
      input.prompt.length > MAX_AGENT_PROMPT_CHARACTERS
    ) {
      throw new AgentTaskRuntimeError(
        "invalid_prompt",
        "The Agent task prompt is invalid.",
      );
    }
    if (
      this.activeByTask.has(input.taskId) ||
      this.activeByProject.has(input.projectId)
    ) {
      throw new AgentTaskRuntimeError(
        "task_running",
        "An Agent SDK task is already running for this capability.",
      );
    }
  }

  private requestCancellation(
    active: ActiveAgentTask,
    reason: AgentTaskAbortReason,
  ): void {
    if (active.closing) return;
    active.abortReason = reason;
    this.beginClose(active);
  }

  private beginClose(active: ActiveAgentTask): void {
    if (active.closing) return;
    active.closing = true;
    this.options.capabilityService.revoke(active.taskId);
    active.controller.abort();
    try {
      active.query.close();
    } catch {
      // Cancellation still terminates and drains the owned process tree.
    } finally {
      active.termination ??= active.processTree.terminate();
      active.termination.catch(() => undefined);
    }
  }

  private remove(active: ActiveAgentTask): void {
    this.activeByTask.delete(active.taskId);
    if (this.activeByProject.get(active.projectId) === active) {
      this.activeByProject.delete(active.projectId);
    }
  }

  private emitProgress(
    context: TaskEventContext,
    phase: AgentTaskProgressPhase,
  ): void {
    if (context.lastProgressPhase === phase) return;
    context.lastProgressPhase = phase;
    this.emit(context, { type: "agent.task.progress", phase });
  }

  private emitTerminal(
    context: TaskEventContext,
    terminal:
      | { readonly status: "cancelled"; readonly reason: AgentTaskAbortReason }
      | { readonly status: "completed"; readonly result: SDKResultMessage }
      | { readonly status: "failed"; readonly error: AppError },
  ): AgentTaskTerminalEvent {
    if (terminal.status === "cancelled") {
      return this.emit(context, {
        type: "agent.task.cancelled",
        reason: terminal.reason,
      });
    }
    if (terminal.status === "failed") {
      return this.emit(context, {
        type: "agent.task.failed",
        error: terminal.error,
      });
    }
    if (terminal.result.subtype !== "success") {
      return this.emit(context, {
        type: "agent.task.failed",
        error: sdkResultError(terminal.result),
      });
    }
    return this.emit(context, {
      type: "agent.task.completed",
      summary: terminal.result.result.slice(
        0,
        AGENT_TASK_MAX_SUMMARY_CHARACTERS,
      ),
      durationMs: terminal.result.duration_ms,
      numTurns: terminal.result.num_turns,
      totalCostUsd: terminal.result.total_cost_usd,
      permissionDenialCount: terminal.result.permission_denials.length,
    });
  }

  private emit<Type extends AgentTaskEventType>(
    context: TaskEventContext,
    event: AgentTaskEventPayload<Type>,
  ): AgentTaskEventOfType<Type> {
    const emitted = {
      ...event,
      taskId: context.taskId,
      projectId: context.projectId,
      sequence: context.sequence++,
      timestamp: this.now().toISOString(),
    } as unknown as AgentTaskEventOfType<Type>;
    context.emit(emitted);
    return emitted;
  }
}
