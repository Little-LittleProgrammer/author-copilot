import { describe, expect, it, vi } from "vitest";
import { IPC_INVOKE_CHANNELS } from "@author-copilot/contracts";
import type { ProjectService } from "../src/main/project/index.js";
import type { TabManager } from "../src/main/tabs/index.js";

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
import { registerProjectIpcHandlers } from "../src/main/ipc/project-handlers.js";

describe("project backup IPC", () => {
  it("requires the owning project tab and returns the backup result", async () => {
    const projectId = "10000000-0000-4000-8000-000000000001";
    const trustedRendererUrl = "file:///app/renderer/index.html";
    const frame = { url: trustedRendererUrl };
    const event = { senderFrame: frame, sender: { id: 7, mainFrame: frame } };
    let ownsProject = true;
    const chooseBackupDestination = vi.fn(async () => "/tmp/backups");
    const service = {
      draft: vi.fn(async () => []),
      backupProject: vi.fn(async () => ({
        directoryName: "作品.author-copilot-backup",
        fileCount: 3,
      })),
    };
    registerProjectIpcHandlers({
      trustedRendererUrl,
      projectService: service as unknown as ProjectService,
      getTabManager: () =>
        ({
          getContext: () =>
            ownsProject
              ? { kind: "project", project: { projectId } }
              : { kind: "center" },
        }) as unknown as TabManager,
      directoryPicker: {
        chooseBackupDestination,
        chooseExportDestination: vi.fn(),
        chooseImportFile: vi.fn(),
        chooseImportSource: vi.fn(),
      },
    });

    const handler = handlers.get(IPC_INVOKE_CHANNELS.projectBackup)!;
    expect(await handler(event, { projectId, locale: "zh-CN" })).toMatchObject({
      ok: true,
      fileCount: 3,
    });
    expect(service.backupProject).toHaveBeenCalledWith(
      projectId,
      "/tmp/backups",
    );

    const drafts = handlers.get(IPC_INVOKE_CHANNELS.documentDraft)!;
    expect(await drafts(event, { action: "list", projectId })).toMatchObject({
      ok: true,
      drafts: [],
    });
    expect(
      await drafts(event, {
        action: "list",
        projectId: "20000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({ ok: false });
    chooseBackupDestination.mockImplementationOnce(async () => {
      ownsProject = false;
      return "/tmp/backups";
    });
    expect(await handler(event, { projectId, locale: "zh-CN" })).toMatchObject({
      ok: false,
    });
    expect(service.backupProject).toHaveBeenCalledTimes(1);
    ownsProject = false;
    expect(await handler(event, { projectId, locale: "zh-CN" })).toMatchObject({
      ok: false,
      error: { code: "invalid_path" },
    });
  });
});
