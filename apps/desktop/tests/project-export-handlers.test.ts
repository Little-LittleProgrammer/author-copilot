import { describe, expect, it, vi } from "vitest";
import { IPC_INVOKE_CHANNELS } from "@author-copilot/contracts";
import type { TabManager } from "../src/main/tabs/index.js";
import type { ProjectService } from "../src/main/project/index.js";
import * as exports from "../src/main/project/document-export.js";

const handlers = vi.hoisted(
  () =>
    new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
);
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
    ) => handlers.set(channel, handler),
  },
}));
import { registerProjectExportHandler } from "../src/main/ipc/project-export-handlers.js";

function fixture() {
  const projectId = "10000000-0000-4000-8000-000000000001";
  const trustedRendererUrl = "file:///app/renderer/index.html";
  const frame = { url: trustedRendererUrl };
  const event = { senderFrame: frame, sender: { id: 42, mainFrame: frame } };
  const snapshot: exports.ManuscriptSnapshot = {
    title: "作品",
    fileTitle: "作品",
    documentCount: 2,
    blocks: [],
  };
  const service = {
    prepareExport: vi.fn(async () => snapshot),
    list: vi.fn(async () => [{ rootPath: "/works/book" }]),
  };
  let ownsProject = true;
  const manager = {
    getContext: () =>
      ownsProject
        ? { kind: "project", project: { projectId } }
        : { kind: "center" },
  };
  const chooseExportDestination = vi.fn<() => Promise<string | undefined>>(
    async () => "/delivery/作品.docx",
  );
  const write = vi
    .spyOn(exports, "writeManuscriptExport")
    .mockResolvedValue("作品.docx");
  registerProjectExportHandler({
    trustedRendererUrl,
    projectService: service as unknown as ProjectService,
    getTabManager: () => manager as unknown as TabManager,
    directoryPicker: {
      chooseExportDestination,
      chooseCreateParent: vi.fn(),
      chooseImportSource: vi.fn(),
      chooseCopyDestination: vi.fn(),
      chooseImportFile: vi.fn(),
    },
  });
  return {
    event,
    request: { projectId, scope: "project", format: "docx", locale: "zh-CN" },
    handler: handlers.get(IPC_INVOKE_CHANNELS.projectExport)!,
    service,
    chooseExportDestination,
    write,
    disown: () => {
      ownsProject = false;
    },
  };
}

describe("project export IPC", () => {
  it("authorizes the owning project and keeps absolute paths in the main process", async () => {
    const { event, request, handler, service, chooseExportDestination, write } =
      fixture();
    expect(await handler(event, request)).toEqual({
      ok: true,
      fileName: "作品.docx",
      documentCount: 2,
    });
    expect(chooseExportDestination).toHaveBeenCalledWith({
      fileName: "作品.docx",
      format: "docx",
      locale: "zh-CN",
    });
    expect(write).toHaveBeenCalledWith(
      await service.prepareExport(),
      "docx",
      "/delivery/作品.docx",
      ["/works/book"],
    );
    for (const input of [
      { ...request, projectId: "20000000-0000-4000-8000-000000000001" },
      { ...request, destination: "/private/file.docx" },
      { ...request, scope: "chapter", relativePath: "../private.md" },
    ]) {
      expect(await handler(event, input)).toMatchObject({ ok: false });
    }
    expect(write).toHaveBeenCalledTimes(1);
    await expect(
      handler(
        { ...event, senderFrame: { url: event.senderFrame.url } },
        request,
      ),
    ).rejects.toThrow("IPC sender is not trusted");
    await expect(handler(event, request, {})).rejects.toThrow("argument count");
  });

  it("treats native cancellation as a quiet result and permits retry", async () => {
    const { event, request, handler, chooseExportDestination, write } =
      fixture();
    chooseExportDestination.mockResolvedValueOnce(undefined);
    expect(await handler(event, request)).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(write).not.toHaveBeenCalled();
    expect(await handler(event, request)).toMatchObject({ ok: true });
  });

  it("blocks duplicate dialogs and rechecks tab ownership before writing", async () => {
    const { event, request, handler, chooseExportDestination, write, disown } =
      fixture();
    let choose!: (path: string) => void;
    chooseExportDestination.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          choose = resolve;
        }),
    );
    const first = handler(event, request);
    await vi.waitFor(() =>
      expect(chooseExportDestination).toHaveBeenCalledTimes(1),
    );
    expect(await handler(event, request)).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    disown();
    choose("/delivery/作品.docx");
    expect(await first).toMatchObject({
      ok: false,
      error: { code: "invalid_path" },
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("normalizes failure reasons without exposing the save location", async () => {
    const { event, request, handler, write } = fixture();
    write.mockRejectedValueOnce(new exports.DocumentExportError("destination"));
    expect(await handler(event, request)).toEqual({
      ok: false,
      error: {
        code: "invalid_path",
        message: "The manuscript could not be exported.",
        retryable: true,
        details: { exportReason: "destination" },
      },
    });
  });
});
