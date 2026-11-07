import { describe, expect, it } from "vitest";

import {
  AGENT_TASK_MAX_SUMMARY_CHARACTERS,
  AgentTaskEventSchema,
} from "../src/index.js";

const base = {
  taskId: "20000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000001",
  sequence: 0,
  timestamp: "2026-08-16T00:00:00.000Z",
};

describe("Agent task contracts", () => {
  it("accepts sanitized lifecycle and terminal events", () => {
    expect(
      AgentTaskEventSchema.parse({
        ...base,
        type: "agent.task.started",
      }),
    ).toMatchObject({ type: "agent.task.started" });
    expect(
      AgentTaskEventSchema.parse({
        ...base,
        sequence: 1,
        type: "agent.task.progress",
        phase: "tool",
      }),
    ).toMatchObject({ phase: "tool" });
    expect(
      AgentTaskEventSchema.parse({
        ...base,
        sequence: 2,
        type: "agent.task.completed",
        summary: "已完成受控修改。",
        durationMs: 120,
        numTurns: 2,
        totalCostUsd: 0.01,
        permissionDenialCount: 0,
      }),
    ).toMatchObject({ type: "agent.task.completed" });
    expect(
      AgentTaskEventSchema.parse({
        ...base,
        sequence: 3,
        type: "agent.task.cancelled",
        reason: "timeout",
      }),
    ).toMatchObject({ reason: "timeout" });
  });

  it("rejects raw SDK fields, oversized summaries, and unsanitized errors", () => {
    expect(
      AgentTaskEventSchema.safeParse({
        ...base,
        type: "agent.task.progress",
        phase: "running",
        sdkMessage: { content: "正文" },
      }).success,
    ).toBe(false);
    expect(
      AgentTaskEventSchema.safeParse({
        ...base,
        type: "agent.task.completed",
        summary: "x".repeat(AGENT_TASK_MAX_SUMMARY_CHARACTERS + 1),
        durationMs: 0,
        numTurns: 0,
        totalCostUsd: 0,
        permissionDenialCount: 0,
      }).success,
    ).toBe(false);
    expect(
      AgentTaskEventSchema.safeParse({
        ...base,
        type: "agent.task.failed",
        error: {
          code: "AI_UNAVAILABLE",
          message: "Agent failed.",
          retryable: true,
          absolutePath: "/private/manuscript.md",
        },
      }).success,
    ).toBe(false);
  });
});
