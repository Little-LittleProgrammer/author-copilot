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
  it("guards daily goal reads and writes by the active project", async () => {
    const projectId = "10000000-0000-4000-8000-000000000001";
    const trustedRendererUrl = "file:///app/renderer/index.html";
    const frame = { url: trustedRendererUrl };
    const event = { senderFrame: frame, sender: { id: 42, mainFrame: frame } };
    const manager = {
      getContext: vi.fn(() => ({ kind: "project", project: { projectId } })),
    };
    const service = {
      getGoal: vi.fn(async () => ({ dailyTarget: 500 })),
      setGoal: vi.fn(async () => ({ dailyTarget: 1200 })),
    };
    registerWritingStatisticsHandlers({
      trustedRendererUrl,
      service: service as unknown as WritingStatisticsService,
      getTabManager: () => manager as unknown as TabManager,
    });
    const get = handlers.get(IPC_INVOKE_CHANNELS.writingGoalGet)!;
    const set = handlers.get(IPC_INVOKE_CHANNELS.writingGoalSet)!;
    expect(await get(event, { projectId })).toEqual({
      ok: true,
      goal: { dailyTarget: 500 },
    });
    expect(await set(event, { projectId, dailyTarget: 1200 })).toEqual({
      ok: true,
      goal: { dailyTarget: 1200 },
    });
    expect(await get(event, { projectId, dailyTarget: 10 })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(
      await set(event, {
        projectId: "20000000-0000-4000-8000-000000000001",
        dailyTarget: 1200,
      }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(service.getGoal).toHaveBeenCalledTimes(1);
    expect(service.setGoal).toHaveBeenCalledTimes(1);
  });

  it("guards history reads and sanitizes storage errors", async () => {
    const projectId = "10000000-0000-4000-8000-000000000001";
    const trustedRendererUrl = "file:///app/renderer/index.html";
    const frame = { url: trustedRendererUrl };
    const event = { senderFrame: frame, sender: { id: 42, mainFrame: frame } };
    const request = { projectId, endDay: "2026-09-27" };
    const history = {
      days: Array.from({ length: 7 }, (_, index) => ({
        day: `2026-09-${21 + index}`,
        netCharacters: -2,
      })),
      netCharacters: -14,
    };
    const service = { history: vi.fn(async () => history) };
    const manager = {
      getContext: vi.fn(() => ({ kind: "project", project: { projectId } })),
    };
    registerWritingStatisticsHandlers({
      trustedRendererUrl,
      service: service as unknown as WritingStatisticsService,
      getTabManager: () => manager as unknown as TabManager,
    });
    const read = handlers.get(IPC_INVOKE_CHANNELS.writingStatisticsHistory)!;
    for (const senderFrame of [
      { url: "https://foreign.invalid" },
      { ...frame },
      null,
    ]) {
      await expect(read({ ...event, senderFrame }, request)).rejects.toThrow();
    }
    await expect(read(event, request, "extra")).rejects.toThrow();
    for (const changes of [
      { projectId: "20000000-0000-4000-8000-000000000001" },
      { projectId: "../escape" },
      { endDay: "2026-02-30" },
      { content: "private text" },
      { days: 10000 },
    ]) {
      expect(await read(event, { ...request, ...changes })).toEqual({
        ok: false,
        error: "invalid_request",
      });
    }
    manager.getContext.mockReturnValueOnce({
      kind: "center",
      project: { projectId },
    });
    expect(await read(event, request)).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(service.history).not.toHaveBeenCalled();
    expect(await read(event, request)).toEqual({ ok: true, history });
    service.history.mockRejectedValueOnce(new Error("private path"));
    expect(await read(event, request)).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

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
