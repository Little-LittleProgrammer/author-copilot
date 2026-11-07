import {
  AiSettingsRequestSchema,
  AiSettingsResponseSchema,
  IPC_INVOKE_CHANNELS,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { assertTrustedIpcRequest } from "../ipc-policy.js";
import type { ProviderService } from "../ai/provider-service.js";
export function registerAiSettingsHandlers(
  service: ProviderService,
  trustedRendererUrl: string,
): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.aiSettings,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const frame = event.senderFrame;
      assertTrustedIpcRequest({
        channel: IPC_INVOKE_CHANNELS.aiSettings,
        senderFrameUrl: frame?.url ?? "",
        mainFrameUrl: event.sender.mainFrame.url,
        trustedRendererUrl,
        isMainFrame: frame !== null && frame === event.sender.mainFrame,
        args,
        expectedArgumentCount: 1,
      });
      try {
        return AiSettingsResponseSchema.parse(
          await service.execute(AiSettingsRequestSchema.parse(args[0])),
        );
      } catch (error) {
        return AiSettingsResponseSchema.parse({
          ok: false,
          error: {
            code: "AI_UNAVAILABLE",
            message:
              error instanceof Error && error.name !== "ZodError"
                ? error.message
                : "Invalid AI settings request.",
            retryable: true,
          },
        });
      }
    },
  );
}
