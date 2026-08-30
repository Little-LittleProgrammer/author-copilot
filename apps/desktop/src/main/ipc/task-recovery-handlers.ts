import {
  IPC_INVOKE_CHANNELS,
  TaskRecoveryListRequestSchema,
  TaskRecoveryListResponseSchema,
  TaskRecoveryRestoreRequestSchema,
  TaskRecoveryRestoreResponseSchema,
  type TaskRecoveryError,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { TaskSnapshotError, type TaskSnapshotService } from "../git/index.js";
import { assertTrustedIpcRequest } from "../ipc-policy.js";
import { ProjectNotFoundError } from "../project/index.js";

export interface TaskRecoveryIpcOptions {
  readonly taskSnapshotService: TaskSnapshotService;
  readonly trustedRendererUrl: string;
}

function assertTrustedTaskRecoveryIpc(
  event: IpcMainInvokeEvent,
  args: readonly unknown[],
  channel: string,
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

function recoveryFailure(error: unknown): {
  readonly ok: false;
  readonly error: TaskRecoveryError;
} {
  if (error instanceof ProjectNotFoundError) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: "The project is not registered.",
        retryable: false,
      },
    };
  }
  if (error instanceof TaskSnapshotError) {
    const code =
      error.code === "unsafe_path" || error.code === "budget_exceeded"
        ? "invalid_snapshot"
        : error.code;
    return {
      ok: false,
      error: { code, message: error.message, retryable: error.retryable },
    };
  }
  return {
    ok: false,
    error: {
      code: "io_failed",
      message: "The task recovery operation could not be completed.",
      retryable: true,
    },
  };
}

export function registerTaskRecoveryIpcHandlers(
  options: TaskRecoveryIpcOptions,
): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.taskRecoveryList,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedTaskRecoveryIpc(
        event,
        args,
        IPC_INVOKE_CHANNELS.taskRecoveryList,
        options.trustedRendererUrl,
      );
      try {
        const request = TaskRecoveryListRequestSchema.parse(args[0]);
        const recoveries = await options.taskSnapshotService.listRecoveries(
          request.projectId,
        );
        return TaskRecoveryListResponseSchema.parse({ ok: true, recoveries });
      } catch (error) {
        return TaskRecoveryListResponseSchema.parse(recoveryFailure(error));
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.taskRecoveryRestore,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedTaskRecoveryIpc(
        event,
        args,
        IPC_INVOKE_CHANNELS.taskRecoveryRestore,
        options.trustedRendererUrl,
      );
      try {
        const request = TaskRecoveryRestoreRequestSchema.parse(args[0]);
        const result = await options.taskSnapshotService.restoreTaskSnapshot(
          request.projectId,
          request.taskId,
        );
        return TaskRecoveryRestoreResponseSchema.parse({ ok: true, result });
      } catch (error) {
        return TaskRecoveryRestoreResponseSchema.parse(recoveryFailure(error));
      }
    },
  );
}
