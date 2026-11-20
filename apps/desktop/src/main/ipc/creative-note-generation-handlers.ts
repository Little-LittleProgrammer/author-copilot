import {
  CreativeNoteGenerationRequestSchema,
  CreativeNoteGenerationResponseSchema,
  CreativeNoteGenerationCancelRequestSchema,
  CreativeNoteGenerationCancelResponseSchema,
  IPC_INVOKE_CHANNELS,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { CreativeNoteGenerationService } from "../ai/creative-note-generation-service.js";
import { assertTrustedIpcRequest } from "../ipc-policy.js";
import type { TabManager } from "../tabs/index.js";

export function registerCreativeNoteGenerationHandlers(options: {
  readonly trustedRendererUrl: string;
  readonly service: CreativeNoteGenerationService;
  readonly getTabManager: () => TabManager | undefined;
}): void {
  const owners = new Map<string, number>();
  const authorize = (
    event: IpcMainInvokeEvent,
    channel: string,
    args: unknown[],
  ): void => {
    assertTrustedIpcRequest({
      channel,
      senderFrameUrl: event.senderFrame?.url ?? "",
      mainFrameUrl: event.sender.mainFrame.url,
      trustedRendererUrl: options.trustedRendererUrl,
      isMainFrame:
        event.senderFrame !== null &&
        event.senderFrame === event.sender.mainFrame,
      args,
      expectedArgumentCount: 1,
    });
  };
  const belongs = (event: IpcMainInvokeEvent, projectId: string): boolean => {
    const context = options.getTabManager()?.getContext(event.sender.id);
    return (
      context?.kind === "project" && context.project.projectId === projectId
    );
  };
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.creativeNoteGenerate,
    async (event, ...args: unknown[]) => {
      authorize(event, IPC_INVOKE_CHANNELS.creativeNoteGenerate, args);
      const parsed = CreativeNoteGenerationRequestSchema.safeParse(args[0]);
      if (
        !parsed.success ||
        !belongs(event, parsed.data.projectId) ||
        owners.has(parsed.data.requestId)
      )
        return CreativeNoteGenerationResponseSchema.parse({
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "The creative draft request is invalid.",
            retryable: false,
          },
        });
      const request = parsed.data;
      const owner = event.sender;
      owners.set(request.requestId, owner.id);
      const cancel = (): void => {
        options.service.cancel(request.projectId, request.requestId);
      };
      owner.once("destroyed", cancel);
      owner.once("did-start-navigation", cancel);
      // A renderer crash must also stop its in-flight request.
      owner.once("render-process-gone", cancel);
      try {
        const response = await options.service.generate(request);
        if (owner.isDestroyed() || !belongs(event, request.projectId))
          return CreativeNoteGenerationResponseSchema.parse({
            ok: false,
            error: {
              code: "CANCELLED",
              message: "The owning work was closed.",
              retryable: false,
            },
          });
        return CreativeNoteGenerationResponseSchema.parse(response);
      } finally {
        owners.delete(request.requestId);
        owner.removeListener("destroyed", cancel);
        owner.removeListener("did-start-navigation", cancel);
        owner.removeListener("render-process-gone", cancel);
      }
    },
  );
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.creativeNoteGenerateCancel,
    (event, ...args: unknown[]) => {
      authorize(event, IPC_INVOKE_CHANNELS.creativeNoteGenerateCancel, args);
      const request = CreativeNoteGenerationCancelRequestSchema.safeParse(
        args[0],
      );
      return CreativeNoteGenerationCancelResponseSchema.parse({
        accepted:
          request.success &&
          belongs(event, request.data.projectId) &&
          owners.get(request.data.requestId) === event.sender.id &&
          options.service.cancel(
            request.data.projectId,
            request.data.requestId,
          ),
      });
    },
  );
}
