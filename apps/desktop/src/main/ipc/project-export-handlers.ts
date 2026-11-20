import {
  IPC_INVOKE_CHANNELS,
  ProjectExportRequestSchema,
  ProjectExportResponseSchema,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { assertTrustedIpcRequest } from "../ipc-policy.js";
import { InvalidProjectPathError } from "../project/errors.js";
import type { ProjectIpcOptions } from "./project-handlers.js";
import {
  cancelledOperation,
  projectOperationFailure,
} from "./project-result.js";
import {
  suggestedExportName,
  writeManuscriptExport,
} from "../project/document-export.js";

export function registerProjectExportHandler(options: ProjectIpcOptions): void {
  const pending = new Set<number>();
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.projectExport,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const frame = event.senderFrame;
      assertTrustedIpcRequest({
        channel: IPC_INVOKE_CHANNELS.projectExport,
        senderFrameUrl: frame?.url ?? "",
        mainFrameUrl: event.sender.mainFrame.url,
        trustedRendererUrl: options.trustedRendererUrl,
        isMainFrame: frame !== null && frame === event.sender.mainFrame,
        args,
        expectedArgumentCount: 1,
      });
      let ownsPending = false;
      try {
        const request = ProjectExportRequestSchema.parse(args[0]);
        const assertOwner = (): void => {
          const context = options.getTabManager()?.getContext(event.sender.id);
          if (
            context?.kind !== "project" ||
            context.project.projectId !== request.projectId
          )
            throw new InvalidProjectPathError(
              "Export is limited to the owning project tab.",
            );
        };
        assertOwner();
        if (pending.has(event.sender.id))
          return ProjectExportResponseSchema.parse(cancelledOperation());
        pending.add(event.sender.id);
        ownsPending = true;
        const snapshot = await options.projectService.prepareExport(request);
        const destination =
          await options.directoryPicker.chooseExportDestination({
            fileName: suggestedExportName(snapshot, request.format),
            format: request.format,
            locale: request.locale,
          });
        if (!destination)
          return ProjectExportResponseSchema.parse(cancelledOperation());
        assertOwner();
        const roots = (await options.projectService.list()).map(
          (project) => project.rootPath,
        );
        const fileName = await writeManuscriptExport(
          snapshot,
          request.format,
          destination,
          roots,
        );
        return ProjectExportResponseSchema.parse({
          ok: true,
          fileName,
          documentCount: snapshot.documentCount,
        });
      } catch (error) {
        return ProjectExportResponseSchema.parse(
          projectOperationFailure(error),
        );
      } finally {
        if (ownsPending) pending.delete(event.sender.id);
      }
    },
  );
}
