import {
  IPC_INVOKE_CHANNELS,
  WritingStatisticsHistoryRequestSchema,
  WritingStatisticsHistoryResponseSchema,
  WritingStatisticsRecordSchema,
  WritingStatisticsRequestSchema,
  WritingStatisticsResponseSchema,
  WritingGoalRequestSchema,
  WritingGoalResponseSchema,
  WritingGoalSetRequestSchema,
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
    IPC_INVOKE_CHANNELS.writingStatisticsHistory,
    IPC_INVOKE_CHANNELS.writingStatisticsGet,
    IPC_INVOKE_CHANNELS.writingStatisticsRecord,
    IPC_INVOKE_CHANNELS.writingGoalGet,
    IPC_INVOKE_CHANNELS.writingGoalSet,
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
          channel === IPC_INVOKE_CHANNELS.writingStatisticsHistory
            ? WritingStatisticsHistoryRequestSchema
            : channel === IPC_INVOKE_CHANNELS.writingStatisticsRecord
              ? WritingStatisticsRecordSchema
              : channel === IPC_INVOKE_CHANNELS.writingGoalGet
                ? WritingGoalRequestSchema
                : channel === IPC_INVOKE_CHANNELS.writingGoalSet
                  ? WritingGoalSetRequestSchema
                  : WritingStatisticsRequestSchema;
        const request = schema.safeParse(args[0]);
        const context = options.getTabManager()?.getContext(event.sender.id);
        if (
          !request.success ||
          context?.kind !== "project" ||
          context.project.projectId !== request.data.projectId
        ) {
          return channel === IPC_INVOKE_CHANNELS.writingGoalGet ||
            channel === IPC_INVOKE_CHANNELS.writingGoalSet
            ? WritingGoalResponseSchema.parse({
                ok: false,
                error: "invalid_request",
              })
            : WritingStatisticsResponseSchema.parse({
                ok: false,
                error: "invalid_request",
              });
        }
        try {
          if (channel === IPC_INVOKE_CHANNELS.writingGoalGet) {
            const goal = await options.service.getGoal(
              WritingGoalRequestSchema.parse(request.data),
            );
            return WritingGoalResponseSchema.parse({ ok: true, goal });
          }
          if (channel === IPC_INVOKE_CHANNELS.writingGoalSet) {
            const goal = await options.service.setGoal(
              WritingGoalSetRequestSchema.parse(request.data),
            );
            return WritingGoalResponseSchema.parse({ ok: true, goal });
          }
          if (channel === IPC_INVOKE_CHANNELS.writingStatisticsHistory) {
            const history = await options.service.history(
              WritingStatisticsHistoryRequestSchema.parse(request.data),
            );
            return WritingStatisticsHistoryResponseSchema.parse({
              ok: true,
              history,
            });
          }
          const snapshot =
            channel === IPC_INVOKE_CHANNELS.writingStatisticsRecord
              ? await options.service.record(
                  WritingStatisticsRecordSchema.parse(request.data),
                )
              : await options.service.get(
                  WritingStatisticsRequestSchema.parse(request.data),
                );
          return WritingStatisticsResponseSchema.parse({ ok: true, snapshot });
        } catch {
          return channel === IPC_INVOKE_CHANNELS.writingGoalGet ||
            channel === IPC_INVOKE_CHANNELS.writingGoalSet
            ? WritingGoalResponseSchema.parse({
                ok: false,
                error: "unavailable",
              })
            : WritingStatisticsResponseSchema.parse({
                ok: false,
                error: "unavailable",
              });
        }
      },
    );
  }
}
