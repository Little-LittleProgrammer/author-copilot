import {
  IPC_INVOKE_CHANNELS,
  RuntimeInfoRequestSchema,
  RuntimeInfoSchema,
} from "@author-copilot/contracts";
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";

import { assertTrustedIpcRequest } from "./ipc-policy.js";
import { registerProjectIpcHandlers } from "./ipc/project-handlers.js";
import { registerTabIpcHandlers } from "./ipc/tab-handlers.js";
import { registerVersionIpcHandlers } from "./ipc/version-handlers.js";
import type { ProjectDirectoryPicker } from "./project-dialogs.js";
import type { ProjectService } from "./project/index.js";
import type { GitService } from "./git/index.js";
import type { TabManager } from "./tabs/index.js";

export interface IpcHandlerOptions {
  readonly projectService: ProjectService;
  readonly gitService: GitService;
  readonly directoryPicker: ProjectDirectoryPicker;
  readonly onRuntimeInfo?: () => void;
  readonly getTabManager: () => TabManager | undefined;
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
    onProjectChanged: (project) =>
      options.getTabManager()?.projectChanged(project),
  });
  registerVersionIpcHandlers({
    trustedRendererUrl,
    gitService: options.gitService,
  });
  registerTabIpcHandlers({
    trustedRendererUrl,
    getTabManager: options.getTabManager,
  });
}
