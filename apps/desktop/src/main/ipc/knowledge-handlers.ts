import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  KnowledgeIndexStatusRequestSchema,
  KnowledgeIndexTaskRequestSchema,
  KnowledgeSearchRequestSchema,
  KnowledgeSearchResponseSchema,
  KnowledgeStatusResponseSchema,
  KnowledgeTaskStartResponseSchema,
  TaskCancelRequestSchema,
  TaskCancelResultSchema,
  type KnowledgeOperationError,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";

import { assertTrustedIpcRequest } from "../ipc-policy.js";
import { KnowledgeServiceError } from "../knowledge/index.js";
import type { KnowledgeService } from "../knowledge/index.js";

export interface KnowledgeIpcOptions {
  readonly trustedRendererUrl: string;
  readonly knowledgeService: KnowledgeService;
}

function authorize(
  event: IpcMainInvokeEvent,
  channel: string,
  args: readonly unknown[],
  trustedRendererUrl: string,
): void {
  const senderFrame = event.senderFrame;
  assertTrustedIpcRequest({
    channel,
    senderFrameUrl: senderFrame?.url ?? "",
    mainFrameUrl: event.sender.mainFrame.url,
    trustedRendererUrl,
    isMainFrame: senderFrame !== null && senderFrame === event.sender.mainFrame,
    args,
    expectedArgumentCount: 1,
  });
}

function operationError(error: unknown): KnowledgeOperationError {
  if (error instanceof KnowledgeServiceError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (error instanceof Error && error.name === "ZodError") {
    return {
      code: "validation_failed",
      message: "The knowledge request is invalid.",
      retryable: false,
    };
  }
  return {
    code: "io_failed",
    message:
      error instanceof Error
        ? error.message
        : "The knowledge operation failed.",
    retryable: true,
  };
}

export function registerKnowledgeIpcHandlers(
  options: KnowledgeIpcOptions,
): void {
  const taskOwners = new Map<string, WebContents>();
  options.knowledgeService.subscribe((event) => {
    const owner = taskOwners.get(event.taskId);
    if (owner === undefined || owner.isDestroyed()) {
      taskOwners.delete(event.taskId);
      return;
    }
    owner.send(
      event.type === "task.progress"
        ? IPC_EVENT_CHANNELS.taskProgress
        : IPC_EVENT_CHANNELS.taskCancelled,
      event,
    );
    if (
      event.type === "task.cancelled" ||
      (event.type === "task.progress" && event.phase === "complete")
    ) {
      taskOwners.delete(event.taskId);
    }
  });

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.knowledgeGetStatus,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.knowledgeGetStatus,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = KnowledgeIndexStatusRequestSchema.parse(args[0]);
        return KnowledgeStatusResponseSchema.parse({
          ok: true,
          status: await options.knowledgeService.getStatus(request.projectId),
        });
      } catch (error) {
        return KnowledgeStatusResponseSchema.parse({
          ok: false,
          error: operationError(error),
        });
      }
    },
  );

  const startTask = async (
    event: IpcMainInvokeEvent,
    args: readonly unknown[],
    rebuild: boolean,
  ): Promise<unknown> => {
    const channel = rebuild
      ? IPC_INVOKE_CHANNELS.knowledgeRebuild
      : IPC_INVOKE_CHANNELS.knowledgeInitialize;
    authorize(event, channel, args, options.trustedRendererUrl);
    try {
      const request = KnowledgeIndexTaskRequestSchema.parse(args[0]);
      const status = rebuild
        ? await options.knowledgeService.rebuild(request.projectId)
        : await options.knowledgeService.initialize(request.projectId);
      if (status.activeTaskId === null) {
        throw new KnowledgeServiceError(
          "io_failed",
          "The knowledge task did not start.",
          true,
        );
      }
      taskOwners.set(status.activeTaskId, event.sender);
      return KnowledgeTaskStartResponseSchema.parse({
        ok: true,
        taskId: status.activeTaskId,
        status,
      });
    } catch (error) {
      return KnowledgeTaskStartResponseSchema.parse({
        ok: false,
        error: operationError(error),
      });
    }
  };

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.knowledgeInitialize,
    (event: IpcMainInvokeEvent, ...args: unknown[]) =>
      startTask(event, args, false),
  );
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.knowledgeRebuild,
    (event: IpcMainInvokeEvent, ...args: unknown[]) =>
      startTask(event, args, true),
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.knowledgeSearch,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.knowledgeSearch,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = KnowledgeSearchRequestSchema.parse(args[0]);
        return KnowledgeSearchResponseSchema.parse({
          ok: true,
          ...(await options.knowledgeService.search(
            request.projectId,
            request.query,
            request.limit,
          )),
        });
      } catch (error) {
        return KnowledgeSearchResponseSchema.parse({
          ok: false,
          error: operationError(error),
        });
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.taskCancel,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.taskCancel,
        args,
        options.trustedRendererUrl,
      );
      const request = TaskCancelRequestSchema.parse(args[0]);
      return TaskCancelResultSchema.parse({
        taskId: request.taskId,
        accepted: options.knowledgeService.cancel(request.taskId),
      });
    },
  );
}
