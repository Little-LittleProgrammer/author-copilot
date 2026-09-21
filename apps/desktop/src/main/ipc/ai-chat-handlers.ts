import {
  AiChatCancelRequestSchema,
  AiChatCancelResponseSchema,
  AiChatEventSchema,
  AiChatStartRequestSchema,
  AiChatStartResponseSchema,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";

import type { AiOrchestrator } from "../ai/index.js";
import { AiChatServiceError } from "../ai/index.js";
import { assertTrustedIpcRequest } from "../ipc-policy.js";

export interface AiChatIpcOptions {
  readonly orchestrator: AiOrchestrator;
  readonly trustedRendererUrl: string;
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

export function registerAiChatIpcHandlers(options: AiChatIpcOptions): void {
  const owners = new Map<string, WebContents>();
  const ownerRuns = new Map<WebContents, Set<string>>();

  const release = (runId: string): void => {
    const owner = owners.get(runId);
    if (owner === undefined) return;
    owners.delete(runId);
    const runs = ownerRuns.get(owner);
    runs?.delete(runId);
    if (runs?.size === 0) ownerRuns.delete(owner);
  };

  const track = (runId: string, owner: WebContents): void => {
    owners.set(runId, owner);
    let runs = ownerRuns.get(owner);
    if (runs === undefined) {
      runs = new Set<string>();
      ownerRuns.set(owner, runs);
      owner.once("destroyed", () => {
        for (const ownedRunId of ownerRuns.get(owner) ?? []) {
          options.orchestrator.cancel(ownedRunId, "shutdown");
          owners.delete(ownedRunId);
        }
        ownerRuns.delete(owner);
      });
    }
    runs.add(runId);
  };

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.aiChatStart,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.aiChatStart,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = AiChatStartRequestSchema.parse(args[0]);
        const owner = event.sender;
        const result = await options.orchestrator.start(request, (rawEvent) => {
          const chatEvent = AiChatEventSchema.parse(rawEvent);
          if (!owner.isDestroyed()) {
            owner.send(IPC_EVENT_CHANNELS.aiChatEvent, chatEvent);
          }
          if (chatEvent.type !== "ai.chat.delta") release(chatEvent.runId);
        });
        track(result.runId, owner);
        return AiChatStartResponseSchema.parse(result);
      } catch (error) {
        const appError =
          error instanceof AiChatServiceError
            ? error.appError
            : {
                code: "VALIDATION_FAILED" as const,
                message: "The AI chat request is invalid.",
                retryable: false,
              };
        return AiChatStartResponseSchema.parse({ ok: false, error: appError });
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.aiChatCancel,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.aiChatCancel,
        args,
        options.trustedRendererUrl,
      );
      const request = AiChatCancelRequestSchema.parse(args[0]);
      const accepted =
        owners.get(request.runId) === event.sender &&
        options.orchestrator.cancel(request.runId, "user");
      return AiChatCancelResponseSchema.parse({
        runId: request.runId,
        accepted,
      });
    },
  );
}
