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
  it("authorizes fact confirmation before persistence and keeps failure details opaque", async () => {
    const projectId = "10000000-0000-4000-8000-000000000001";
    const trustedRendererUrl = "file:///app/renderer/index.html";
    const frame = { url: trustedRendererUrl };
    const event = { senderFrame: frame, sender: { id: 42, mainFrame: frame } };
    const fact = {
      id: "20000000-0000-4000-8000-000000000001",
      kind: "fact",
      title: "船长",
      content: "船长失去了左眼。",
      source: {
        relativePath: "第一章.md",
        contentHash: "a".repeat(64),
        capturedAt: "2026-11-07T00:00:00.000Z",
      },
    };
    const service = {
      confirmFacts: vi.fn(async () => [
        {
          ...fact,
          createdAt: fact.source.capturedAt,
          updatedAt: fact.source.capturedAt,
        },
      ]),
    };
    registerCreativeNotesIpcHandlers({
      trustedRendererUrl,
      service: service as unknown as CreativeNotesService,
      projects: { readDocument: vi.fn() },
      getTabManager: () =>
        ({
          getContext: () => ({ kind: "project", project: { projectId } }),
        }) as unknown as TabManager,
    });
    const confirm = handlers.get(IPC_INVOKE_CHANNELS.creativeFactsConfirm)!;
    const input = { projectId, facts: [fact] };
    expect(await confirm(event, { ...input, projectId: fact.id })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(await confirm(event, { ...input, rootPath: "/private" })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(service.confirmFacts).not.toHaveBeenCalled();
    expect(await confirm(event, input)).toMatchObject({
      ok: true,
      notes: [{ id: fact.id }],
    });
    service.confirmFacts.mockRejectedValueOnce(new Error("/private/secret"));
    expect(await confirm(event, input)).toEqual({
      ok: false,
      error: "unavailable",
    });
    await expect(
      confirm(
        { ...event, senderFrame: { url: "https://foreign.invalid" } },
        input,
      ),
    ).rejects.toThrow();
  });

  it.each(["summary", "fact"])(
    "checks current, changed and missing %s sources and scopes access to the owning project",
    async (kind) => {
      const projectId = "10000000-0000-4000-8000-000000000001";
      const noteId = "20000000-0000-4000-8000-000000000001";
      const trustedRendererUrl = "file:///app/renderer/index.html";
      const frame = { url: trustedRendererUrl };
      const event = {
        senderFrame: frame,
        sender: { id: 42, mainFrame: frame },
      };
      const service = {
        list: vi.fn(async () => [
          {
            id: noteId,
            kind,
            source: { relativePath: "第一章.md", contentHash: "a".repeat(64) },
          },
        ]),
      };
      const projects = {
        readDocument: vi.fn(async () => ({
          content: "正文",
          hash: "a".repeat(64),
          mtimeMs: 1,
          mode: 0o600,
        })),
      };
      const manager = {
        getContext: vi.fn(() => ({ kind: "project", project: { projectId } })),
      };
      registerCreativeNotesIpcHandlers({
        trustedRendererUrl,
        service: service as unknown as CreativeNotesService,
        projects,
        getTabManager: () => manager as unknown as TabManager,
      });
      const check = handlers.get(IPC_INVOKE_CHANNELS.creativeNoteSourceStatus)!;
      expect(await check(event, { projectId, noteId })).toEqual({
        ok: true,
        status: "current",
      });
      expect(projects.readDocument).toHaveBeenLastCalledWith(
        projectId,
        "第一章.md",
      );
      projects.readDocument.mockResolvedValueOnce({
        content: "修改后正文",
        hash: "b".repeat(64),
        mtimeMs: 2,
        mode: 0o600,
      });
      expect(await check(event, { projectId, noteId })).toEqual({
        ok: true,
        status: "changed",
      });
      projects.readDocument.mockRejectedValueOnce(
        Object.assign(new Error("/private/project/moved.md"), {
          code: "ENOENT",
        }),
      );
      expect(await check(event, { projectId, noteId })).toEqual({
        ok: true,
        status: "missing",
      });
      projects.readDocument.mockRejectedValueOnce(
        Object.assign(new Error("/private/denied.md"), { code: "EACCES" }),
      );
      expect(await check(event, { projectId, noteId })).toEqual({
        ok: false,
        error: "unavailable",
      });
      const calls = projects.readDocument.mock.calls.length;
      expect(await check(event, { projectId: noteId, noteId })).toEqual({
        ok: false,
        error: "invalid_request",
      });
      expect(
        await check(event, { projectId, noteId, relativePath: "forged.md" }),
      ).toEqual({ ok: false, error: "invalid_request" });
      expect(await check(event, { projectId, noteId: projectId })).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(projects.readDocument).toHaveBeenCalledTimes(calls);
      await expect(
        check(
          { ...event, senderFrame: { url: "https://foreign.invalid" } },
          { projectId, noteId },
        ),
      ).rejects.toThrow();
    },
  );
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
      projects: { readDocument: vi.fn() },
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
