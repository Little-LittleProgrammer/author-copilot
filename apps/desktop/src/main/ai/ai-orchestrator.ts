import { randomUUID } from "node:crypto";

import {
  AiChatStartRequestSchema,
  type AiAssembledContext,
  type AiChatContextMetadata,
  type AiChatEvent,
  type AiPatchReview,
  type AiChatStartRequest,
  type AiChatStartResponse,
  type AppError,
} from "@author-copilot/contracts";

import {
  CredentialStoreError,
  type SecureCredentialStore,
} from "../credentials/index.js";
import {
  InvalidProjectPathError,
  ProjectNotFoundError,
} from "../project/index.js";
import type { AiContextAssembler } from "./context-assembler.js";
import { AiContextAssemblyError } from "./context-assembler.js";
import { AiChatServiceError, normalizeClaudeError } from "./errors.js";
import {
  AUTHOR_COPILOT_SYSTEM_PROMPT,
  AI_PATCH_TOOL,
  contextSources,
  providerMessages,
} from "./prompt.js";
import type { ClaudeTransport } from "./anthropic-transport.js";
import type { AiPatchApplicationService } from "./patch-application.js";
import type { AiPatchValidator } from "./patch-validator.js";

type AiChatStartSuccess = Extract<AiChatStartResponse, { readonly ok: true }>;
type AbortReason = "shutdown" | "timeout" | "user";

interface ActiveRun {
  readonly runId: string;
  readonly projectId: string;
  readonly controller: AbortController;
  readonly emit: (event: AiChatEvent) => void;
  sequence: number;
  abortReason?: AbortReason;
}

export interface AiOrchestratorOptions {
  readonly contextAssembler: AiContextAssembler;
  readonly credentialStore: Pick<SecureCredentialStore, "getApiKey">;
  readonly transport: ClaudeTransport;
  readonly patchValidator: Pick<AiPatchValidator, "validate">;
  readonly patchApplication: Pick<AiPatchApplicationService, "createReview">;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

function contextMetadata(context: AiAssembledContext): AiChatContextMetadata {
  const knowledge = context.sections[2];
  return {
    scope: knowledge.scope,
    knowledgeStatus: knowledge.status,
    indexVersion: knowledge.indexVersion,
    degradationReason: knowledge.degradationReason,
    sources: [...contextSources(context)],
  };
}

function startError(error: unknown): AiChatServiceError {
  if (error instanceof AiChatServiceError) return error;
  if (error instanceof ProjectNotFoundError) {
    return new AiChatServiceError({
      code: "NOT_FOUND",
      message: "The project was not found.",
      retryable: false,
    });
  }
  if (
    error instanceof AiContextAssemblyError ||
    error instanceof InvalidProjectPathError ||
    (error instanceof Error && error.name === "ZodError")
  ) {
    return new AiChatServiceError({
      code: "VALIDATION_FAILED",
      message: "The AI chat request is invalid.",
      retryable: false,
    });
  }
  if (error instanceof CredentialStoreError) {
    return new AiChatServiceError({
      code: "AI_UNAVAILABLE",
      message: "The Anthropic API key could not be read securely.",
      retryable: false,
    });
  }
  return new AiChatServiceError({
    code: "AI_UNAVAILABLE",
    message: "AI chat could not be started.",
    retryable: true,
  });
}

export class AiOrchestrator {
  private readonly activeByRun = new Map<string, ActiveRun>();
  private readonly activeByProject = new Map<string, ActiveRun>();
  private readonly startingProjects = new Set<string>();
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(private readonly options: AiOrchestratorOptions) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async start(
    input: AiChatStartRequest,
    emit: (event: AiChatEvent) => void,
  ): Promise<AiChatStartSuccess> {
    let projectId: string | undefined;
    try {
      const request = AiChatStartRequestSchema.parse(input);
      projectId = request.projectId;
      if (
        this.startingProjects.has(projectId) ||
        this.activeByProject.has(projectId)
      ) {
        throw new AiChatServiceError({
          code: "CONFLICT",
          message: "Another AI response is already running for this project.",
          retryable: true,
        });
      }
      this.startingProjects.add(projectId);
      const apiKey = await this.options.credentialStore.getApiKey("anthropic");
      if (apiKey === null) {
        throw new AiChatServiceError({
          code: "AI_UNAVAILABLE",
          message: "Configure an Anthropic API key before using AI chat.",
          retryable: false,
        });
      }
      const context = await this.options.contextAssembler.assemble({
        projectId,
        currentDocument: request.currentDocument,
        instruction: request.instruction,
        permissions: {
          readCurrentDocument: true,
          readProjectStructure: true,
          retrieveKnowledge: true,
          proposeChanges: request.mode === "proposal",
        },
        retrievalLimit: request.retrievalLimit,
      });
      const run: ActiveRun = {
        runId: this.createId(),
        projectId,
        controller: new AbortController(),
        emit,
        sequence: 0,
      };
      this.activeByRun.set(run.runId, run);
      this.activeByProject.set(projectId, run);
      setImmediate(() => {
        void this.execute(run, apiKey, context, request).catch(() => undefined);
      });
      return {
        ok: true,
        runId: run.runId,
        context: contextMetadata(context),
      };
    } catch (error) {
      throw startError(error);
    } finally {
      if (projectId !== undefined) this.startingProjects.delete(projectId);
    }
  }

  cancel(runId: string, reason: "shutdown" | "user" = "user"): boolean {
    const run = this.activeByRun.get(runId);
    if (run === undefined || run.controller.signal.aborted) return false;
    run.abortReason = reason;
    run.controller.abort();
    return true;
  }

  cancelAll(reason: "shutdown" | "user" = "shutdown"): void {
    for (const run of this.activeByRun.values()) this.cancel(run.runId, reason);
  }

  private async execute(
    run: ActiveRun,
    apiKey: string,
    context: AiAssembledContext,
    request: AiChatStartRequest,
  ): Promise<void> {
    const timeout = setTimeout(() => {
      if (run.controller.signal.aborted) return;
      run.abortReason = "timeout";
      run.controller.abort();
    }, this.timeoutMs);
    try {
      let proposalReview: AiPatchReview | undefined;
      await this.options.transport.stream({
        apiKey,
        messages: providerMessages(context, request.history),
        signal: run.controller.signal,
        system: AUTHOR_COPILOT_SYSTEM_PROMPT,
        timeoutMs: this.timeoutMs,
        onText: (text) => {
          if (run.controller.signal.aborted || text.length === 0) return;
          this.emit(run, { type: "ai.chat.delta", text });
        },
        ...(request.mode === "proposal"
          ? {
              tool: {
                ...AI_PATCH_TOOL,
                onInput: async (input: unknown) => {
                  try {
                    const validated =
                      await this.options.patchValidator.validate(
                        run.projectId,
                        input,
                      );
                    proposalReview = this.options.patchApplication.createReview(
                      run.projectId,
                      validated,
                    );
                  } catch {
                    throw new AiChatServiceError({
                      code: "VALIDATION_FAILED",
                      message:
                        "Claude returned a proposal that could not be validated against the current project.",
                      retryable: true,
                    });
                  }
                },
              },
            }
          : {}),
      });
      if (run.controller.signal.aborted) {
        this.emitAbort(run);
      } else if (request.mode === "proposal") {
        if (proposalReview === undefined) {
          throw new AiChatServiceError({
            code: "AI_UNAVAILABLE",
            message: "Claude did not return a reviewable proposal.",
            retryable: true,
          });
        }
        this.emit(run, { type: "ai.proposal.ready", review: proposalReview });
      } else {
        this.emit(run, { type: "ai.chat.completed" });
      }
    } catch (error) {
      if (run.controller.signal.aborted) this.emitAbort(run);
      else this.emitFailure(run, normalizeClaudeError(error));
    } finally {
      clearTimeout(timeout);
      this.activeByRun.delete(run.runId);
      if (this.activeByProject.get(run.projectId) === run) {
        this.activeByProject.delete(run.projectId);
      }
    }
  }

  private emitAbort(run: ActiveRun): void {
    if (run.abortReason === "timeout") {
      this.emitFailure(run, {
        code: "TIMEOUT",
        message: "The Claude request timed out.",
        retryable: true,
      });
      return;
    }
    this.emit(run, {
      type: "ai.chat.cancelled",
      reason: run.abortReason === "shutdown" ? "shutdown" : "user",
    });
  }

  private emitFailure(run: ActiveRun, error: AppError): void {
    this.emit(run, { type: "ai.chat.failed", error });
  }

  private emit(
    run: ActiveRun,
    event:
      | { readonly type: "ai.chat.delta"; readonly text: string }
      | { readonly type: "ai.chat.completed" }
      | { readonly type: "ai.proposal.ready"; readonly review: AiPatchReview }
      | { readonly type: "ai.chat.failed"; readonly error: AppError }
      | {
          readonly type: "ai.chat.cancelled";
          readonly reason: "shutdown" | "user";
        },
  ): void {
    run.emit({
      ...event,
      runId: run.runId,
      sequence: run.sequence++,
      timestamp: this.now().toISOString(),
    });
  }
}
