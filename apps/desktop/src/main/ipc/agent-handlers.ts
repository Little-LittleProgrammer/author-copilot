import {
  AgentStartRequestSchema,
  AgentStartResponseSchema,
  AgentProjectRequestSchema,
  AgentStateResponseSchema,
  AgentTaskRequestSchema,
  AgentCancelResponseSchema,
  AgentRetainRequestSchema,
  AgentRetainResponseSchema,
  AgentTaskEventSchema,
  IPC_INVOKE_CHANNELS,
  IPC_EVENT_CHANNELS,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { assertTrustedIpcRequest } from "../ipc-policy.js";
import {
  agentFailure,
  type AgentTaskService,
} from "../ai/agent/task-service.js";

export function registerAgentIpcHandlers(options: {
  trustedRendererUrl: string;
  service: AgentTaskService;
}): void {
  const tracked = new WeakSet<WebContents>();
  const authorize = (
    event: IpcMainInvokeEvent,
    channel: string,
    args: readonly unknown[],
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
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.agentStart,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(event, IPC_INVOKE_CHANNELS.agentStart, args);
      const parsed = AgentStartRequestSchema.safeParse(args[0]);
      if (!parsed.success)
        return AgentStartResponseSchema.parse({
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "The Agent authorization request is invalid.",
            retryable: false,
          },
        });
      const owner = event.sender;
      if (!tracked.has(owner)) {
        tracked.add(owner);
        owner.once("destroyed", () => options.service.cancelOwner(owner.id));
      }
      try {
        const capability = await options.service.start(
          parsed.data,
          owner.id,
          (event) => {
            if (!owner.isDestroyed())
              owner.send(
                IPC_EVENT_CHANNELS.agentTaskEvent,
                AgentTaskEventSchema.parse(event),
              );
          },
        );
        return AgentStartResponseSchema.parse({ ok: true, capability });
      } catch (error) {
        return AgentStartResponseSchema.parse({
          ok: false,
          error: agentFailure(error),
        });
      }
    },
  );
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.agentState,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(event, IPC_INVOKE_CHANNELS.agentState, args);
      const request = AgentProjectRequestSchema.parse(args[0]);
      try {
        return AgentStateResponseSchema.parse({
          ok: true,
          state: await options.service.getState(request.projectId),
        });
      } catch (error) {
        return AgentStateResponseSchema.parse({
          ok: false,
          error: agentFailure(error),
        });
      }
    },
  );
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.agentCancel,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(event, IPC_INVOKE_CHANNELS.agentCancel, args);
      const request = AgentTaskRequestSchema.parse(args[0]);
      return AgentCancelResponseSchema.parse({
        accepted: options.service.cancel(
          request.projectId,
          request.taskId,
          event.sender.id,
        ),
      });
    },
  );
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.agentRetain,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(event, IPC_INVOKE_CHANNELS.agentRetain, args);
      const request = AgentRetainRequestSchema.parse(args[0]);
      try {
        return AgentRetainResponseSchema.parse({
          ok: true,
          commitId: await options.service.retain(
            request.projectId,
            request.taskId,
            request.reviewDigest,
          ),
        });
      } catch (error) {
        return AgentRetainResponseSchema.parse({
          ok: false,
          error: agentFailure(error),
        });
      }
    },
  );
}
