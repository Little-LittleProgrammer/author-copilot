import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  ConversationRequestSchema,
  ConversationResponseSchema,
  IPC_INVOKE_CHANNELS,
} from "@author-copilot/contracts";
import type { ConversationStore } from "../ai/conversation-store.js";
import type { ProjectService } from "../project/index.js";
import { assertTrustedIpcRequest } from "../ipc-policy.js";

export function registerConversationHandlers(options: {
  trustedRendererUrl: string;
  store: ConversationStore;
  projects: Pick<ProjectService, "getProjectRoot">;
}): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.conversation,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedIpcRequest({
        channel: IPC_INVOKE_CHANNELS.conversation,
        senderFrameUrl: event.senderFrame?.url ?? "",
        mainFrameUrl: event.sender.mainFrame.url,
        trustedRendererUrl: options.trustedRendererUrl,
        isMainFrame:
          event.senderFrame !== null &&
          event.senderFrame === event.sender.mainFrame,
        args,
        expectedArgumentCount: 1,
      });
      try {
        const request = ConversationRequestSchema.parse(args[0]);
        await options.projects.getProjectRoot(
          request.action === "save"
            ? request.conversation.projectId
            : request.projectId,
        );
        return ConversationResponseSchema.parse(
          await options.store.request(request),
        );
      } catch {
        return ConversationResponseSchema.parse({
          ok: false,
          error: {
            code: "IO_FAILED",
            message:
              "Conversation history could not be read or saved. Please retry.",
            retryable: true,
          },
        });
      }
    },
  );
}
