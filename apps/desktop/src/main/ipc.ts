import {
  IPC_INVOKE_CHANNELS,
  RuntimeInfoRequestSchema,
  RuntimeInfoSchema,
} from "@author-copilot/contracts";
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";

import { assertTrustedIpcRequest } from "./ipc-policy.js";
import { registerProjectIpcHandlers } from "./ipc/project-handlers.js";
import type { ProjectDirectoryPicker } from "./project-dialogs.js";
import type { ProjectService } from "./project/index.js";

export interface IpcHandlerOptions {
  readonly projectService: ProjectService;
  readonly directoryPicker: ProjectDirectoryPicker;
  readonly onRuntimeInfo?: () => void;
}

export function registerIpcHandlers(
  trustedRendererUrl: string,
  options: IpcHandlerOptions,
): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.runtimeGetInfo,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const senderFrame = event.senderFrame;
      assertTrustedIpcRequest({
        channel: IPC_INVOKE_CHANNELS.runtimeGetInfo,
        senderFrameUrl: senderFrame?.url ?? "",
        mainFrameUrl: event.sender.mainFrame.url,
        trustedRendererUrl,
        isMainFrame:
          senderFrame !== null && senderFrame === event.sender.mainFrame,
        args,
      });

      RuntimeInfoRequestSchema.parse({});

      const runtimeInfo = RuntimeInfoSchema.parse({
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
      });
      options.onRuntimeInfo?.();
      return runtimeInfo;
    },
  );

  registerProjectIpcHandlers({
    trustedRendererUrl,
    projectService: options.projectService,
    directoryPicker: options.directoryPicker,
  });
}
