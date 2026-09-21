import {
  IPC_INVOKE_CHANNELS,
  WritingStatisticsRecordSchema,
  WritingStatisticsRequestSchema,
  WritingStatisticsResponseSchema,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { assertTrustedIpcRequest } from "../ipc-policy.js";
import type { TabManager } from "../tabs/index.js";
import type { WritingStatisticsService } from "../writing-statistics/writing-statistics-service.js";

export function registerWritingStatisticsHandlers(options: {
  trustedRendererUrl: string;
  service: WritingStatisticsService;
  getTabManager: () => TabManager | undefined;
}): void {
  for (const channel of [
    IPC_INVOKE_CHANNELS.writingStatisticsGet,
    IPC_INVOKE_CHANNELS.writingStatisticsRecord,
  ]) {
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
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
        const schema =
          channel === IPC_INVOKE_CHANNELS.writingStatisticsRecord
            ? WritingStatisticsRecordSchema
            : WritingStatisticsRequestSchema;
        const request = schema.safeParse(args[0]);
        const context = options.getTabManager()?.getContext(event.sender.id);
        if (
          !request.success ||
          context?.kind !== "project" ||
          context.project.projectId !== request.data.projectId
        ) {
          return WritingStatisticsResponseSchema.parse({
            ok: false,
            error: "invalid_request",
          });
        }
        try {
          const snapshot =
            channel === IPC_INVOKE_CHANNELS.writingStatisticsRecord
              ? await options.service.record(
                  WritingStatisticsRecordSchema.parse(request.data),
                )
              : await options.service.get(request.data);
          return WritingStatisticsResponseSchema.parse({ ok: true, snapshot });
        } catch {
          return WritingStatisticsResponseSchema.parse({
            ok: false,
            error: "unavailable",
          });
        }
      },
    );
  }
}
