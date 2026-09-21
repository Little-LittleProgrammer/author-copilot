import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_INVOKE_CHANNELS } from "@author-copilot/contracts";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => unknown,
    ) => mock.handlers.set(channel, handler),
  },
}));
import { registerAgentIpcHandlers } from "../src/main/ipc/agent-handlers.js";
import type { AgentTaskService } from "../src/main/ai/agent/task-service.js";
const trustedRendererUrl = "file:///app/renderer/index.html";
const projectId = "10000000-0000-4000-8000-000000000001";
const request = {
  projectId,
  prompt: "Edit the work",
  readableFileTypes: ["markdown"],
  writableFileTypes: ["markdown"],
  allowedTools: ["mcp__author_copilot__write_text"],
  timeoutMs: 60_000,
};
function fixture() {
  const sender = Object.assign(new EventEmitter(), {
    id: 42,
    mainFrame: { url: trustedRendererUrl },
    isDestroyed: () => false,
    send: vi.fn(),
  });
  const { prompt: _prompt, ...grant } = request;
  void _prompt;
  const service = {
    start: vi.fn(async () => ({
      ...grant,
      taskId: "20000000-0000-4000-8000-000000000001",
      createdAt: new Date().toISOString(),
    })),
    cancelOwner: vi.fn(),
    cancel: vi.fn(() => false),
    getState: vi.fn(async () => ({ running: false })),
  };
  registerAgentIpcHandlers({
    trustedRendererUrl,
    service: service as unknown as AgentTaskService,
  });
  return { sender, service, event: { sender, senderFrame: sender.mainFrame } };
}
beforeEach(() => mock.handlers.clear());
describe("Agent IPC boundary", () => {
  it("rejects foreign origins, frames and injected SDK configuration before starting", async () => {
    const fx = fixture();
    const start = mock.handlers.get(IPC_INVOKE_CHANNELS.agentStart)!;
    await expect(
      start(
        { ...fx.event, senderFrame: { url: "https://untrusted.invalid" } },
        request,
      ),
    ).rejects.toThrow();
    expect(
      await start(fx.event, { ...request, apiKey: "secret", cwd: "/outside" }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(fx.service.start).not.toHaveBeenCalled();
  });
  it("captures renderer ownership before the asynchronous start and cancels it on destruction", async () => {
    const fx = fixture();
    const start = mock.handlers.get(IPC_INVOKE_CHANNELS.agentStart)!;
    expect(await start(fx.event, request)).toMatchObject({ ok: true });
    expect(fx.service.start).toHaveBeenCalledWith(
      request,
      42,
      expect.any(Function),
    );
    fx.sender.emit("destroyed");
    expect(fx.service.cancelOwner).toHaveBeenCalledWith(42);
    const cancel = mock.handlers.get(IPC_INVOKE_CHANNELS.agentCancel)!;
    await cancel(fx.event, {
      projectId,
      taskId: "20000000-0000-4000-8000-000000000001",
    });
    expect(fx.service.cancel).toHaveBeenCalledWith(
      projectId,
      "20000000-0000-4000-8000-000000000001",
      42,
    );
  });
});
