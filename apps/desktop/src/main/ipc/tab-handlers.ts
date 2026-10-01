import {
  IPC_INVOKE_CHANNELS,
  TabContextSchema,
  TabEndSessionRequestSchema,
  TabGetContextRequestSchema,
  TabGetStateRequestSchema,
  TabIdRequestSchema,
  TabOpenProjectRequestSchema,
  TabOperationResultSchema,
  TabReportDirtyRequestSchema,
  TabRequestLogoutRequestSchema,
  TabSetLocaleRequestSchema,
  TabStartSessionRequestSchema,
  TabStateSchema,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { assertTrustedIpcRequest } from "../ipc-policy.js";
import type { TabManager } from "../tabs/index.js";

export interface TabIpcOptions {
  readonly trustedRendererUrl: string;
  readonly getTabManager: () => TabManager | undefined;
}

function manager(options: TabIpcOptions): TabManager {
  const current = options.getTabManager();
  if (current === undefined) throw new Error("Tab manager is not available");
  return current;
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

export function registerTabIpcHandlers(options: TabIpcOptions): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabGetContext,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabGetContext,
        args,
        options.trustedRendererUrl,
      );
      TabGetContextRequestSchema.parse(args[0]);
      return TabContextSchema.parse(
        manager(options).getContext(event.sender.id),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabGetState,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabGetState,
        args,
        options.trustedRendererUrl,
      );
      TabGetStateRequestSchema.parse(args[0]);
      return TabStateSchema.parse(manager(options).getState(event.sender.id));
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabStartSession,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabStartSession,
        args,
        options.trustedRendererUrl,
      );
      TabStartSessionRequestSchema.parse(args[0]);
      return TabStateSchema.parse(
        await manager(options).startSession(event.sender.id),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabOpenProject,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabOpenProject,
        args,
        options.trustedRendererUrl,
      );
      const request = TabOpenProjectRequestSchema.parse(args[0]);
      return TabStateSchema.parse(
        await manager(options).openProject(event.sender.id, request.projectId),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabActivate,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabActivate,
        args,
        options.trustedRendererUrl,
      );
      const request = TabIdRequestSchema.parse(args[0]);
      return TabStateSchema.parse(
        await manager(options).activate(event.sender.id, request.tabId),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabClose,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabClose,
        args,
        options.trustedRendererUrl,
      );
      const request = TabIdRequestSchema.parse(args[0]);
      return TabOperationResultSchema.parse(
        await manager(options).close(event.sender.id, request.tabId),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabEndSession,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabEndSession,
        args,
        options.trustedRendererUrl,
      );
      TabEndSessionRequestSchema.parse(args[0]);
      return TabOperationResultSchema.parse(
        await manager(options).endSession(event.sender.id),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabReportDirty,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabReportDirty,
        args,
        options.trustedRendererUrl,
      );
      const request = TabReportDirtyRequestSchema.parse(args[0]);
      return TabStateSchema.parse(
        manager(options).reportDirty(event.sender.id, request.dirty),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabSetLocale,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabSetLocale,
        args,
        options.trustedRendererUrl,
      );
      const request = TabSetLocaleRequestSchema.parse(args[0]);
      return TabStateSchema.parse(
        manager(options).setLocale(event.sender.id, request.locale),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.tabRequestLogout,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.tabRequestLogout,
        args,
        options.trustedRendererUrl,
      );
      TabRequestLogoutRequestSchema.parse(args[0]);
      return TabOperationResultSchema.parse(
        manager(options).requestLogout(event.sender.id),
      );
    },
  );
}
