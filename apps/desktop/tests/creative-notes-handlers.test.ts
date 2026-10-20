import { describe, expect, it, vi } from "vitest";
import { IPC_INVOKE_CHANNELS } from "@author-copilot/contracts";
import type { TabManager } from "../src/main/tabs/index.js";
import type { CreativeNotesService } from "../src/main/creative-notes/creative-notes-service.js";

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
import { registerCreativeNotesIpcHandlers } from "../src/main/ipc/creative-notes-handlers.js";

describe("creative notes IPC", () => {
  it("requires the active project and keeps storage errors opaque", async () => {
    const projectId = "10000000-0000-4000-8000-000000000001";
    const trustedRendererUrl = "file:///app/renderer/index.html";
    const frame = { url: trustedRendererUrl };
    const event = { senderFrame: frame, sender: { id: 42, mainFrame: frame } };
    const service = {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({
        id: "20000000-0000-4000-8000-000000000001",
        kind: "note",
        title: "Draft",
        content: "Text",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      })),
      update: vi.fn(),
      delete: vi.fn(async () => true),
    };
    const manager = {
      getContext: vi.fn(() => ({ kind: "project", project: { projectId } })),
    };
    registerCreativeNotesIpcHandlers({
      trustedRendererUrl,
      service: service as unknown as CreativeNotesService,
      getTabManager: () => manager as unknown as TabManager,
    });
    const list = handlers.get(IPC_INVOKE_CHANNELS.creativeNotesList)!;
    const create = handlers.get(IPC_INVOKE_CHANNELS.creativeNoteCreate)!;
    const remove = handlers.get(IPC_INVOKE_CHANNELS.creativeNoteDelete)!;
    expect(await list(event, { projectId })).toEqual({ ok: true, notes: [] });
    expect(
      await create(event, {
        projectId,
        kind: "note",
        title: "Draft",
        content: "Text",
      }),
    ).toMatchObject({ ok: true, note: { title: "Draft" } });
    expect(await list(event, { projectId, extra: true })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(
      await remove(event, {
        projectId: "20000000-0000-4000-8000-000000000001",
        noteId: projectId,
      }),
    ).toEqual({
      ok: false,
      error: "invalid_request",
    });
    service.list.mockRejectedValueOnce(new Error("private path"));
    expect(await list(event, { projectId })).toEqual({
      ok: false,
      error: "unavailable",
    });
    await expect(
      list(
        { ...event, senderFrame: { url: "https://foreign.invalid" } },
        { projectId },
      ),
    ).rejects.toThrow();
  });
});
