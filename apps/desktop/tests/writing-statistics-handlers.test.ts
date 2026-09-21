import { describe, expect, it, vi } from "vitest";
import { IPC_INVOKE_CHANNELS } from "@author-copilot/contracts";
import type { TabManager } from "../src/main/tabs/index.js";
import type { WritingStatisticsService } from "../src/main/writing-statistics/writing-statistics-service.js";

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
import { registerWritingStatisticsHandlers } from "../src/main/ipc/writing-statistics-handlers.js";

describe("writing statistics IPC", () => {
  it("enforces renderer origin, frame, project ownership and strict payloads before storage", async () => {
    const projectId = "10000000-0000-4000-8000-000000000001";
    const trustedRendererUrl = "file:///app/renderer/index.html";
    const frame = { url: trustedRendererUrl };
    const event = { senderFrame: frame, sender: { id: 42, mainFrame: frame } };
    const request = {
      projectId,
      sessionId: "20000000-0000-4000-8000-000000000001",
      day: "2026-09-19",
      sequence: 1,
      netCharacters: 2,
    };
    const service = {
      record: vi.fn(async () => ({
        day: request.day,
        sequence: 1,
        sessionCharacters: 2,
        netCharacters: 2,
      })),
    };
    const manager = {
      getContext: vi.fn(() => ({ kind: "project", project: { projectId } })),
    };
    registerWritingStatisticsHandlers({
      trustedRendererUrl,
      service: service as unknown as WritingStatisticsService,
      getTabManager: () => manager as unknown as TabManager,
    });
    const record = handlers.get(IPC_INVOKE_CHANNELS.writingStatisticsRecord)!;
    await expect(
      record(
        { ...event, senderFrame: { url: "https://foreign.invalid" } },
        request,
      ),
    ).rejects.toThrow();
    await expect(
      record({ ...event, senderFrame: { ...frame } }, request),
    ).rejects.toThrow();
    await expect(record(event, request, "extra")).rejects.toThrow();
    expect(await record(event, { ...request, content: "manuscript" })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(
      await record(event, { ...request, projectId: request.sessionId }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(service.record).not.toHaveBeenCalled();
    expect(await record(event, request)).toMatchObject({
      ok: true,
      snapshot: { netCharacters: 2 },
    });
    service.record.mockRejectedValueOnce(new Error("private filesystem path"));
    expect(await record(event, request)).toEqual({
      ok: false,
      error: "unavailable",
    });
  });
});
