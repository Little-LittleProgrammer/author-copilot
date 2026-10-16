import {
  AiPatchApplyRequestSchema,
  AiPatchApplyResponseSchema,
  AiPatchDiscardRequestSchema,
  AiPatchDiscardResponseSchema,
  IPC_INVOKE_CHANNELS,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { AiPatchApplicationService } from "../ai/index.js";
import { assertTrustedIpcRequest } from "../ipc-policy.js";

export interface AiProposalIpcOptions {
  readonly patchApplication: Pick<
    AiPatchApplicationService,
    "apply" | "discard"
  >;
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

export function registerAiProposalIpcHandlers(
  options: AiProposalIpcOptions,
): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.aiProposalApply,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.aiProposalApply,
        args,
        options.trustedRendererUrl,
      );
      const request = AiPatchApplyRequestSchema.parse(args[0]);
      return AiPatchApplyResponseSchema.parse(
        await options.patchApplication.apply(request),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.aiProposalDiscard,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.aiProposalDiscard,
        args,
        options.trustedRendererUrl,
      );
      const request = AiPatchDiscardRequestSchema.parse(args[0]);
      return AiPatchDiscardResponseSchema.parse({
        discarded: options.patchApplication.discard(
          request.projectId,
          request.proposalId,
        ),
      });
    },
  );
}
