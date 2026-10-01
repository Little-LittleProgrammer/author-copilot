import type {
  AiAssembledContext,
  AiChatEvent,
  AiChatStartRequest,
} from "@author-copilot/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  AiChatServiceError,
  AiOrchestrator,
  createAiPatchReview,
  type ClaudeTransport,
} from "../src/main/ai/index.js";
import type { AiContextAssembler } from "../src/main/ai/context-assembler.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const proposalId = "30000000-0000-4000-8000-000000000001";
const request: AiChatStartRequest = {
  projectId,
  currentDocument: {
    relativePath: "第一卷/第一章/正文.md",
    content: "雨夜。",
  },
  instruction: "接下来会发生什么？",
  history: [],
  retrievalLimit: 5,
};
const context: AiAssembledContext = {
  projectId,
  sections: [
    {
      kind: "current",
      contextKind: "document",
      relativePath: "第一卷/第一章/正文.md",
      baselineHash: "a".repeat(64),
      startLine: 1,
      endLine: 1,
      text: "雨夜。",
    },
    {
      kind: "structure",
      path: [
        {
          kind: "document",
          name: "正文",
          relativePath: "第一卷/第一章/正文.md",
        },
      ],
    },
    {
      kind: "knowledge",
      scope: "full_book",
      status: "ready",
      indexVersion: "index-v1",
      hits: [
        {
          relativePath: "人物/林晚.md",
          titleContext: ["林晚"],
          startLine: 2,
          endLine: 3,
          score: 0.9,
          text: "林晚害怕雷声。",
          indexVersion: "index-v1",
        },
      ],
      degradationReason: null,
    },
    {
      kind: "request",
      instruction: request.instruction,
      permissions: {
        readCurrentDocument: true,
        readProjectStructure: true,
        retrieveKnowledge: true,
        proposeChanges: false,
      },
    },
  ],
};

function orchestrator(
  transport: ClaudeTransport,
  options: {
    readonly apiKey?: string | null;
    readonly timeoutMs?: number;
  } = {},
): AiOrchestrator {
  return new AiOrchestrator({
    contextAssembler: {
      assemble: vi.fn().mockResolvedValue(context),
    } as unknown as AiContextAssembler,
    credentialStore: {
      getApiKey: vi
        .fn()
        .mockResolvedValue(
          options.apiKey === undefined ? "sk-ant-test" : options.apiKey,
        ),
    },
    patchValidator: {
      validate: vi.fn(),
    },
    patchApplication: {
      createReview: (_projectId, proposal) =>
        createAiPatchReview(proposal, proposalId),
    },
    transport,
    createId: () => runId,
    now: () => new Date("2026-08-04T00:00:00.000Z"),
    timeoutMs: options.timeoutMs ?? 1_000,
  });
}

describe("AI orchestrator", () => {
  it("streams sequenced text and returns numbered full-book sources", async () => {
    const events: AiChatEvent[] = [];
    const service = orchestrator({
      stream: async ({ onText }) => {
        onText("她推开");
        onText("门。");
      },
    });

    await expect(
      service.start(request, (event) => events.push(event)),
    ).resolves.toMatchObject({
      ok: true,
      runId,
      context: {
        scope: "full_book",
        sources: [{ sourceId: 1, relativePath: "人物/林晚.md" }],
      },
    });
    await vi.waitFor(() => expect(events).toHaveLength(3));
    expect(events.map((event) => [event.type, event.sequence])).toEqual([
      ["ai.chat.delta", 0],
      ["ai.chat.delta", 1],
      ["ai.chat.completed", 2],
    ]);
  });

  it("validates a forced tool proposal and emits review data without writes", async () => {
    const events: AiChatEvent[] = [];
    const contextAssembler = {
      assemble: vi.fn().mockResolvedValue(context),
    };
    const validate = vi.fn().mockResolvedValue({
      summary: "收紧开场",
      files: [
        {
          relativePath: "第一卷/第一章/正文.md",
          baselineHash: "a".repeat(64),
          proposedHash: "b".repeat(64),
          originalContent: "雨夜。",
          proposedContent: "暴雨。",
          edits: [
            {
              changeId: "opening",
              startOffset: 0,
              endOffset: 2,
              expectedText: "雨夜",
              replacementText: "暴雨",
            },
          ],
        },
      ],
    });
    const service = new AiOrchestrator({
      contextAssembler: contextAssembler as unknown as AiContextAssembler,
      credentialStore: { getApiKey: vi.fn().mockResolvedValue("sk-ant-test") },
      patchValidator: { validate },
      patchApplication: {
        createReview: (_projectId, proposal) =>
          createAiPatchReview(proposal, proposalId),
      },
      transport: {
        stream: async ({ tool }) => {
          expect(tool?.name).toBe("propose_project_changes");
          await tool?.onInput({ summary: "raw proposal" });
        },
      },
      createId: () => runId,
      now: () => new Date("2026-08-04T00:00:00.000Z"),
    });

    await service.start({ ...request, mode: "proposal" }, (event) =>
      events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(validate).toHaveBeenCalledWith(projectId, {
      summary: "raw proposal",
    });
    expect(contextAssembler.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: expect.objectContaining({ proposeChanges: true }),
      }),
    );
    expect(events[0]).toMatchObject({
      type: "ai.proposal.ready",
      review: {
        summary: "收紧开场",
        files: [
          {
            relativePath: "第一卷/第一章/正文.md",
            changes: [{ changeId: "opening" }],
          },
        ],
      },
    });
  });

  it("normalizes invalid proposal tool input without leaking contents", async () => {
    const events: AiChatEvent[] = [];
    const service = new AiOrchestrator({
      contextAssembler: {
        assemble: vi.fn().mockResolvedValue(context),
      } as unknown as AiContextAssembler,
      credentialStore: { getApiKey: vi.fn().mockResolvedValue("sk-ant-test") },
      patchValidator: {
        validate: vi.fn().mockRejectedValue(new Error("secret manuscript")),
      },
      patchApplication: {
        createReview: (_projectId, proposal) =>
          createAiPatchReview(proposal, proposalId),
      },
      transport: {
        stream: async ({ tool }) => {
          await tool?.onInput({ manuscript: "secret manuscript" });
        },
      },
      createId: () => runId,
      now: () => new Date("2026-08-04T00:00:00.000Z"),
    });

    await service.start({ ...request, mode: "proposal" }, (event) =>
      events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      type: "ai.chat.failed",
      error: { code: "VALIDATION_FAILED" },
    });
    expect(JSON.stringify(events[0])).not.toContain("secret manuscript");
  });

  it("rejects a missing credential and concurrent runs without leaking keys", async () => {
    const missing = orchestrator({ stream: vi.fn() }, { apiKey: null });
    await expect(missing.start(request, vi.fn())).rejects.toMatchObject({
      appError: { code: "AI_UNAVAILABLE", retryable: false },
    });

    const pending = orchestrator({
      stream: ({ signal }) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    });
    await pending.start(request, vi.fn());
    await expect(pending.start(request, vi.fn())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AiChatServiceError &&
        error.appError.code === "CONFLICT",
    );
    pending.cancel(runId);
  });

  it("emits user cancellation and timeout as different terminal results", async () => {
    const abortingTransport: ClaudeTransport = {
      stream: ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("aborted without secrets"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new Error("aborted without secrets")),
            { once: true },
          );
        }),
    };
    const cancelledEvents: AiChatEvent[] = [];
    const cancelled = orchestrator(abortingTransport);
    await cancelled.start(request, (event) => cancelledEvents.push(event));
    expect(cancelled.cancel(runId)).toBe(true);
    await vi.waitFor(() => expect(cancelledEvents).toHaveLength(1));
    expect(cancelledEvents[0]).toMatchObject({
      type: "ai.chat.cancelled",
      reason: "user",
    });

    const timeoutEvents: AiChatEvent[] = [];
    const timedOut = orchestrator(abortingTransport, { timeoutMs: 5 });
    await timedOut.start(request, (event) => timeoutEvents.push(event));
    await vi.waitFor(() => expect(timeoutEvents).toHaveLength(1));
    expect(timeoutEvents[0]).toMatchObject({
      type: "ai.chat.failed",
      error: { code: "TIMEOUT", retryable: true },
    });
  });
});
