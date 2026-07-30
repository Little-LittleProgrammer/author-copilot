import {
  IPC_INVOKE_CHANNELS,
  VersionBranchListRequestSchema,
  VersionBranchListResponseSchema,
  VersionBranchSwitchRequestSchema,
  VersionBranchSwitchResponseSchema,
  VersionCreateRequestSchema,
  VersionCreateResponseSchema,
  VersionDiffRequestSchema,
  VersionDiffResponseSchema,
  VersionListRequestSchema,
  VersionListResponseSchema,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { GitService } from "../git/index.js";
import { assertTrustedIpcRequest } from "../ipc-policy.js";
import { versionOperationFailure } from "./version-result.js";

export interface VersionIpcOptions {
  readonly gitService: GitService;
  readonly trustedRendererUrl: string;
}

function assertTrustedVersionIpc(
  event: IpcMainInvokeEvent,
  args: readonly unknown[],
  channel: string,
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

export function registerVersionIpcHandlers(options: VersionIpcOptions): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.versionCreate,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedVersionIpc(
        event,
        args,
        IPC_INVOKE_CHANNELS.versionCreate,
        options.trustedRendererUrl,
      );

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

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.versionList,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedVersionIpc(
        event,
        args,
        IPC_INVOKE_CHANNELS.versionList,
        options.trustedRendererUrl,
      );

      try {
        const request = VersionListRequestSchema.parse(args[0]);
        const versions = await options.gitService.listVersions(
          request.projectId,
          request.limit,
        );
        return VersionListResponseSchema.parse({ ok: true, versions });
      } catch (error) {
        return VersionListResponseSchema.parse(versionOperationFailure(error));
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.versionDiff,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedVersionIpc(
        event,
        args,
        IPC_INVOKE_CHANNELS.versionDiff,
        options.trustedRendererUrl,
      );

      try {
        const request = VersionDiffRequestSchema.parse(args[0]);
        const diff = await options.gitService.getVersionDiff(
          request.projectId,
          request.commitId,
        );
        return VersionDiffResponseSchema.parse({ ok: true, diff });
      } catch (error) {
        return VersionDiffResponseSchema.parse(versionOperationFailure(error));
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.versionBranchList,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedVersionIpc(
        event,
        args,
        IPC_INVOKE_CHANNELS.versionBranchList,
        options.trustedRendererUrl,
      );

      try {
        const request = VersionBranchListRequestSchema.parse(args[0]);
        const state = await options.gitService.listBranches(request.projectId);
        return VersionBranchListResponseSchema.parse({ ok: true, state });
      } catch (error) {
        return VersionBranchListResponseSchema.parse(
          versionOperationFailure(error),
        );
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.versionBranchSwitch,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedVersionIpc(
        event,
        args,
        IPC_INVOKE_CHANNELS.versionBranchSwitch,
        options.trustedRendererUrl,
      );

      try {
        const request = VersionBranchSwitchRequestSchema.parse(args[0]);
        const result = await options.gitService.switchBranch(
          request.projectId,
          request.branchName,
        );
        return VersionBranchSwitchResponseSchema.parse({ ok: true, ...result });
      } catch (error) {
        return VersionBranchSwitchResponseSchema.parse(
          versionOperationFailure(error),
        );
      }
    },
  );
}
