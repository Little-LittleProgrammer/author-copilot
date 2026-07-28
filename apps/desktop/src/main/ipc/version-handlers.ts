import {
  IPC_INVOKE_CHANNELS,
  VersionCreateRequestSchema,
  VersionCreateResponseSchema,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { GitService } from "../git/index.js";
import { assertTrustedIpcRequest } from "../ipc-policy.js";
import { versionOperationFailure } from "./version-result.js";

export interface VersionIpcOptions {
  readonly gitService: GitService;
  readonly trustedRendererUrl: string;
}

export function registerVersionIpcHandlers(options: VersionIpcOptions): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.versionCreate,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const senderFrame = event.senderFrame;
      assertTrustedIpcRequest({
        channel: IPC_INVOKE_CHANNELS.versionCreate,
        senderFrameUrl: senderFrame?.url ?? "",
        mainFrameUrl: event.sender.mainFrame.url,
        trustedRendererUrl: options.trustedRendererUrl,
        isMainFrame:
          senderFrame !== null && senderFrame === event.sender.mainFrame,
        args,
        expectedArgumentCount: 1,
      });

      try {
        const request = VersionCreateRequestSchema.parse(args[0]);
        const result = await options.gitService.createVersion(
          request.projectId,
          request.message,
        );
        return VersionCreateResponseSchema.parse(
          result.created
            ? { ok: true, created: true, version: result.version }
            : { ok: true, created: false },
        );
      } catch (error) {
        return VersionCreateResponseSchema.parse(
          versionOperationFailure(error),
        );
      }
    },
  );
}
