import { describe, expect, it, vi } from "vitest";
import { IPC_INVOKE_CHANNELS } from "@author-copilot/contracts";
import type { TabManager } from "../src/main/tabs/index.js";
import type { ProjectService } from "../src/main/project/index.js";

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

describe("project structure IPC", () => {
  it("checks tab ownership, schemas and trusted frames before creating or moving files", async () => {
    const projectId = "10000000-0000-4000-8000-000000000001";
    const trustedRendererUrl = "file:///app/renderer/index.html";
    const frame = { url: trustedRendererUrl };
    const event = { senderFrame: frame, sender: { id: 42, mainFrame: frame } };
    const service = {
      createEntry: vi.fn(async () => ({
        relativePath: "新卷",
        documentPath: "新卷/第一章/01-正文.md",
      })),
      moveEntry: vi.fn(async () => undefined),
    };
    let ownsProject = true;
    const manager = {
      getContext: () =>
        ownsProject
          ? { kind: "project", project: { projectId } }
          : { kind: "center" },
    };
    registerProjectIpcHandlers({
      trustedRendererUrl,
      projectService: service as unknown as ProjectService,
      getTabManager: () => manager as unknown as TabManager,
      directoryPicker: {
        chooseExportDestination: vi.fn(),
        chooseCreateParent: vi.fn(),
        chooseImportSource: vi.fn(),
        chooseCopyDestination: vi.fn(),
        chooseImportFile: vi.fn(),
      },
    });
    const create = handlers.get(IPC_INVOKE_CHANNELS.projectCreateEntry)!;
    const move = handlers.get(IPC_INVOKE_CHANNELS.projectMoveEntry)!;
    const input = { projectId, role: "volume", name: "新卷" };
    expect(await create(event, input)).toMatchObject({
      ok: true,
      documentPath: "新卷/第一章/01-正文.md",
    });
    expect(
      await move(event, { projectId, relativePath: "新卷", direction: "up" }),
    ).toEqual({ ok: true, projectId });
    for (const request of [
      { ...input, projectId: "20000000-0000-4000-8000-000000000001" },
      { ...input, parentPath: "../外部" },
      { ...input, content: "unauthorized" },
    ]) {
      expect(await create(event, request)).toMatchObject({ ok: false });
    }
    ownsProject = false;
    expect(await create(event, input)).toMatchObject({
      ok: false,
      error: { code: "invalid_path" },
    });
    expect(
      await move(event, { projectId, relativePath: "新卷", direction: "down" }),
    ).toMatchObject({ ok: false });
    await expect(
      create({ ...event, senderFrame: { url: trustedRendererUrl } }, input),
    ).rejects.toThrow("IPC sender is not trusted");
    await expect(create(event, input, {})).rejects.toThrow("argument count");
    expect(service.createEntry).toHaveBeenCalledTimes(1);
    expect(service.moveEntry).toHaveBeenCalledTimes(1);
  });
});
