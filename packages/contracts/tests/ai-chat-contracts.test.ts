import { describe, expect, it } from "vitest";

import {
  AiChatEventSchema,
  AiChatStartRequestSchema,
  IPC_EVENT_CONTRACTS,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  IPC_INVOKE_CHANNELS,
} from "../src/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";

describe("AI chat contracts", () => {
  it("bounds history and keeps current document paths project-relative", () => {
    expect(
      AiChatStartRequestSchema.parse({
        projectId,
        currentDocument: {
          relativePath: "第一卷/第一章/正文.md",
          content: "雨夜。",
        },
        instruction: "接下来会发生什么？",
      }),
    ).toMatchObject({ history: [], retrievalLimit: 5 });
    expect(
      AiChatStartRequestSchema.safeParse({
        projectId,
        currentDocument: { relativePath: "../secret.md", content: "secret" },
        instruction: "read",
      }).success,
    ).toBe(false);
  });

  it("validates ordered streaming and terminal events strictly", () => {
    const base = {
      runId,
      sequence: 0,
      timestamp: "2026-08-04T00:00:00.000Z",
    };
    expect(
      AiChatEventSchema.parse({
        ...base,
        type: "ai.chat.delta",
        text: "她推开门。",
      }),
    ).toMatchObject({ type: "ai.chat.delta", sequence: 0 });
    expect(
      AiChatEventSchema.safeParse({
        ...base,
        type: "ai.chat.completed",
        apiKey: "must-not-leak",
      }).success,
    ).toBe(false);
  });

  it("binds start, cancel, and event channels to their schemas", () => {
    expect(
      IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.aiChatCancel].request.parse({
        runId,
      }),
    ).toEqual({ runId });
    expect(
      IPC_EVENT_CONTRACTS[IPC_EVENT_CHANNELS.aiChatEvent].safeParse({
        runId,
        sequence: 1,
        timestamp: "2026-08-04T00:00:00.000Z",
        type: "ai.chat.cancelled",
        reason: "user",
      }).success,
    ).toBe(true);
  });
});
