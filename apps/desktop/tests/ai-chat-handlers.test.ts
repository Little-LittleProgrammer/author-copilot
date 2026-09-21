import type { AiChatEvent } from "@author-copilot/contracts";
import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
} from "@author-copilot/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown
  >(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (
          event: unknown,
          ...args: unknown[]
        ) => Promise<unknown> | unknown,
      ) => electronMock.handlers.set(channel, handler),
    ),
  },
}));

import type { AiOrchestrator } from "../src/main/ai/index.js";
import { registerAiChatIpcHandlers } from "../src/main/ipc/ai-chat-handlers.js";

const trustedRendererUrl = "file:///app/renderer/index.html";
const projectId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const request = {
  projectId,
  currentDocument: { relativePath: "第一章/正文.md", content: "雨夜。" },
  instruction: "续写",
};

function senderFixture(): {
  readonly event: unknown;
  readonly sender: {
    readonly mainFrame: { readonly url: string };
    readonly isDestroyed: ReturnType<typeof vi.fn>;
    readonly send: ReturnType<typeof vi.fn>;
    readonly once: ReturnType<typeof vi.fn>;
  };
  destroy: () => void;
} {
  let destroyed: (() => void) | undefined;
  const mainFrame = { url: trustedRendererUrl };
  const sender = {
    mainFrame,
    isDestroyed: vi.fn().mockReturnValue(false),
    send: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === "destroyed") destroyed = listener;
    }),
  };
  return {
    event: { senderFrame: mainFrame, sender },
    sender,
    destroy: () => destroyed?.(),
  };
}

function handler(channel: string) {
  const registered = electronMock.handlers.get(channel);
  if (registered === undefined) throw new Error(`Missing handler: ${channel}`);
  return registered;
}

function orchestratorFixture(): {
  readonly orchestrator: AiOrchestrator;
  readonly cancel: ReturnType<typeof vi.fn>;
  emit: (event: AiChatEvent) => void;
} {
  let emit: ((event: AiChatEvent) => void) | undefined;
  const cancel = vi.fn().mockReturnValue(true);
  return {
    orchestrator: {
      start: vi.fn(async (_request, listener) => {
        emit = listener;
        return {
          ok: true as const,
          runId,
          context: {
            scope: "current_document" as const,
            knowledgeStatus: "not_initialized" as const,
            indexVersion: null,
            degradationReason: "index_not_ready" as const,
            sources: [],
          },
        };
      }),
      cancel,
    } as unknown as AiOrchestrator,
    cancel,
    emit: (event) => emit?.(event),
  };
}

beforeEach(() => electronMock.handlers.clear());

describe("AI chat IPC", () => {
  it("sends validated events only to the start owner", async () => {
    const service = orchestratorFixture();
    registerAiChatIpcHandlers({
      orchestrator: service.orchestrator,
      trustedRendererUrl,
    });
    const owner = senderFixture();
    await expect(
      handler(IPC_INVOKE_CHANNELS.aiChatStart)(owner.event, request),
    ).resolves.toMatchObject({ ok: true, runId });

    service.emit({
      type: "ai.chat.delta",
      runId,
      sequence: 0,
      timestamp: "2026-08-04T00:00:00.000Z",
      text: "她推开门。",
    });
    expect(owner.sender.send).toHaveBeenCalledWith(
      IPC_EVENT_CHANNELS.aiChatEvent,
      expect.objectContaining({ type: "ai.chat.delta", runId }),
    );

    const other = senderFixture();
    expect(
      handler(IPC_INVOKE_CHANNELS.aiChatCancel)(other.event, { runId }),
    ).toEqual({ runId, accepted: false });
    expect(service.cancel).not.toHaveBeenCalled();
    expect(
      handler(IPC_INVOKE_CHANNELS.aiChatCancel)(owner.event, { runId }),
    ).toEqual({ runId, accepted: true });
    expect(service.cancel).toHaveBeenCalledWith(runId, "user");
  });

  it("cancels owned work when its Renderer is destroyed", async () => {
    const service = orchestratorFixture();
    registerAiChatIpcHandlers({
      orchestrator: service.orchestrator,
      trustedRendererUrl,
    });
    const owner = senderFixture();
    await handler(IPC_INVOKE_CHANNELS.aiChatStart)(owner.event, request);
    owner.destroy();
    expect(service.cancel).toHaveBeenCalledWith(runId, "shutdown");
  });

  it("fails closed for malformed requests and untrusted child frames", async () => {
    const service = orchestratorFixture();
    registerAiChatIpcHandlers({
      orchestrator: service.orchestrator,
      trustedRendererUrl,
    });
    const owner = senderFixture();
    await expect(
      handler(IPC_INVOKE_CHANNELS.aiChatStart)(owner.event, {
        ...request,
        secret: "unexpected",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    await expect(
      handler(IPC_INVOKE_CHANNELS.aiChatStart)(
        {
          sender: owner.sender,
          senderFrame: { url: trustedRendererUrl },
        },
        request,
      ),
    ).rejects.toThrow("IPC sender is not trusted");
  });
});
