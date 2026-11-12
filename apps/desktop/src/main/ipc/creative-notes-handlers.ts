import {
  CreativeNoteSourceStatusRequestSchema,
  CreativeNoteSourceStatusResponseSchema,
  CreativeNoteCreateRequestSchema,
  CreativeFactsConfirmRequestSchema,
  CreativeNoteDeleteRequestSchema,
  CreativeNoteDeleteResponseSchema,
  CreativeNoteResponseSchema,
  CreativeNoteUpdateRequestSchema,
  CreativeNotesListResponseSchema,
  CreativeNotesProjectRequestSchema,
  IPC_INVOKE_CHANNELS,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { assertTrustedIpcRequest } from "../ipc-policy.js";
import type { TabManager } from "../tabs/index.js";
import type { ProjectService } from "../project/index.js";
import {
  CreativeNotesServiceError,
  type CreativeNotesService,
} from "../creative-notes/creative-notes-service.js";

export function registerCreativeNotesIpcHandlers(options: {
  trustedRendererUrl: string;
  service: CreativeNotesService;
  projects: Pick<ProjectService, "readDocument">;
  getTabManager: () => TabManager | undefined;
}): void {
  const channels = [
    IPC_INVOKE_CHANNELS.creativeFactsConfirm,
    IPC_INVOKE_CHANNELS.creativeNoteSourceStatus,
    IPC_INVOKE_CHANNELS.creativeNotesList,
    IPC_INVOKE_CHANNELS.creativeNoteCreate,
    IPC_INVOKE_CHANNELS.creativeNoteUpdate,
    IPC_INVOKE_CHANNELS.creativeNoteDelete,
  ] as const;

  for (const channel of channels) {
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
          channel === IPC_INVOKE_CHANNELS.creativeFactsConfirm
            ? CreativeFactsConfirmRequestSchema
            : channel === IPC_INVOKE_CHANNELS.creativeNoteSourceStatus
              ? CreativeNoteSourceStatusRequestSchema
              : channel === IPC_INVOKE_CHANNELS.creativeNotesList
                ? CreativeNotesProjectRequestSchema
                : channel === IPC_INVOKE_CHANNELS.creativeNoteCreate
                  ? CreativeNoteCreateRequestSchema
                  : channel === IPC_INVOKE_CHANNELS.creativeNoteUpdate
                    ? CreativeNoteUpdateRequestSchema
                    : CreativeNoteDeleteRequestSchema;
        const request = schema.safeParse(args[0]);
        const projectId =
          request.success && "projectId" in request.data
            ? request.data.projectId
            : undefined;
        const context = options.getTabManager()?.getContext(event.sender.id);
        if (
          !request.success ||
          projectId === undefined ||
          context?.kind !== "project" ||
          context.project.projectId !== projectId
        ) {
          return CreativeNoteResponseSchema.parse({
            ok: false,
            error: "invalid_request",
          });
        }

        try {
          if (channel === IPC_INVOKE_CHANNELS.creativeFactsConfirm) {
            const notes = await options.service.confirmFacts(
              CreativeFactsConfirmRequestSchema.parse(request.data),
            );
            return CreativeNotesListResponseSchema.parse({ ok: true, notes });
          }
          if (channel === IPC_INVOKE_CHANNELS.creativeNoteSourceStatus) {
            const parsed = CreativeNoteSourceStatusRequestSchema.parse(
              request.data,
            );
            const notes = await options.service.list({ projectId });
            const note = notes.find((item) => item.id === parsed.noteId);
            if (!note?.source)
              return CreativeNoteSourceStatusResponseSchema.parse({
                ok: false,
                error: "not_found",
              });
            try {
              const document = await options.projects.readDocument(
                projectId,
                note.source.relativePath,
              );
              return CreativeNoteSourceStatusResponseSchema.parse({
                ok: true,
                status:
                  document.hash === note.source.contentHash
                    ? "current"
                    : "changed",
              });
            } catch (error) {
              if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
              )
                return CreativeNoteSourceStatusResponseSchema.parse({
                  ok: true,
                  status: "missing",
                });
              throw error;
            }
          }
          if (channel === IPC_INVOKE_CHANNELS.creativeNotesList) {
            const notes = await options.service.list(
              CreativeNotesProjectRequestSchema.parse(request.data),
            );
            return CreativeNotesListResponseSchema.parse({ ok: true, notes });
          }
          if (channel === IPC_INVOKE_CHANNELS.creativeNoteCreate) {
            const note = await options.service.create(
              CreativeNoteCreateRequestSchema.parse(request.data),
            );
            return CreativeNoteResponseSchema.parse({ ok: true, note });
          }
          if (channel === IPC_INVOKE_CHANNELS.creativeNoteUpdate) {
            const note = await options.service.update(
              CreativeNoteUpdateRequestSchema.parse(request.data),
            );
            return CreativeNoteResponseSchema.parse({ ok: true, note });
          }
          const deleted = await options.service.delete(
            CreativeNoteDeleteRequestSchema.parse(request.data),
          );
          return CreativeNoteDeleteResponseSchema.parse({ ok: true, deleted });
        } catch (error) {
          const code =
            error instanceof CreativeNotesServiceError
              ? error.code
              : "unavailable";
          return CreativeNoteResponseSchema.parse({ ok: false, error: code });
        }
      },
    );
  }
}
