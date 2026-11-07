import { describe, expect, it } from "vitest";

import {
  AGENT_TASK_MAX_TIMEOUT_MS,
  AgentTaskCapabilityGrantRequestSchema,
  AgentTaskCapabilitySchema,
  AgentToolNameSchema,
} from "../src/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000002";
const allowedTools = [
  "mcp__author_copilot__read_text",
  "mcp__author_copilot__write_text",
  "mcp__author_copilot__edit_text",
  "mcp__author_copilot__glob",
  "mcp__author_copilot__grep",
] as const;

describe("Agent task capability contracts", () => {
  it("binds one task to one project and an explicit bounded policy", () => {
    expect(
      AgentTaskCapabilitySchema.parse({
        taskId,
        projectId,
        readableFileTypes: ["markdown"],
        writableFileTypes: ["markdown"],
        allowedTools,
        timeoutMs: 60_000,
        createdAt: "2026-08-16T00:00:00.000Z",
      }),
    ).toEqual({
      taskId,
      projectId,
      readableFileTypes: ["markdown"],
      writableFileTypes: ["markdown"],
      allowedTools,
      timeoutMs: 60_000,
      createdAt: "2026-08-16T00:00:00.000Z",
    });
  });

  it("rejects ambient tools, duplicate grants, and unknown fields", () => {
    expect(AgentToolNameSchema.safeParse("Bash").success).toBe(false);
    expect(AgentToolNameSchema.safeParse("WebFetch").success).toBe(false);
    expect(AgentToolNameSchema.safeParse("Task").success).toBe(false);
    expect(
      AgentTaskCapabilityGrantRequestSchema.safeParse({
        projectId,
        readableFileTypes: ["markdown"],
        writableFileTypes: ["markdown"],
        allowedTools: [allowedTools[0], allowedTools[0]],
        timeoutMs: 60_000,
      }).success,
    ).toBe(false);
    expect(
      AgentTaskCapabilityGrantRequestSchema.safeParse({
        projectId,
        readableFileTypes: ["markdown"],
        writableFileTypes: ["markdown"],
        allowedTools,
        timeoutMs: 60_000,
        cwd: "/private/project",
      }).success,
    ).toBe(false);
  });

  it("requires file access for matching tools and keeps timeouts bounded", () => {
    expect(
      AgentTaskCapabilityGrantRequestSchema.safeParse({
        projectId,
        readableFileTypes: [],
        writableFileTypes: [],
        allowedTools: ["mcp__author_copilot__read_text"],
        timeoutMs: 60_000,
      }).success,
    ).toBe(false);
    expect(
      AgentTaskCapabilityGrantRequestSchema.safeParse({
        projectId,
        readableFileTypes: ["markdown"],
        writableFileTypes: [],
        allowedTools: ["mcp__author_copilot__write_text"],
        timeoutMs: 60_000,
      }).success,
    ).toBe(false);
    expect(
      AgentTaskCapabilityGrantRequestSchema.safeParse({
        projectId,
        readableFileTypes: ["markdown"],
        writableFileTypes: ["markdown"],
        allowedTools,
        timeoutMs: AGENT_TASK_MAX_TIMEOUT_MS + 1,
      }).success,
    ).toBe(false);
  });
});
