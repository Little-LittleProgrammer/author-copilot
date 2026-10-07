import { describe, expect, it } from "vitest";
import {
  AgentStartRequestSchema,
  AgentRetainRequestSchema,
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  AgentTaskEventSchema,
} from "../src/index.js";
const projectId = "10000000-0000-4000-8000-000000000001";
const grant = {
  projectId,
  prompt: "Revise this work",
  readableFileTypes: ["markdown"],
  writableFileTypes: ["markdown"],
  allowedTools: ["mcp__author_copilot__write_text"],
  timeoutMs: 60_000,
};
describe("Agent desktop workflow contracts", () => {
  it("requires a bounded instruction and explicit one-task permissions without accepting credentials or SDK options", () => {
    expect(AgentStartRequestSchema.safeParse(grant).success).toBe(true);
    for (const request of [
      { ...grant, prompt: " " },
      { ...grant, apiKey: "secret" },
      { ...grant, cwd: "/tmp" },
      { ...grant, allowedTools: ["Bash"] },
      { ...grant, writableFileTypes: ["json"] },
      { ...grant, timeoutMs: 24 * 60 * 60 * 1000 },
    ])
      expect(AgentStartRequestSchema.safeParse(request).success).toBe(false);
    expect(IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.agentStart].request).toBe(
      AgentStartRequestSchema,
    );
  });
  it("binds keep authorization to a project, task and content review digest", () => {
    const taskId = "20000000-0000-4000-8000-000000000001";
    expect(
      AgentRetainRequestSchema.safeParse({ projectId, taskId }).success,
    ).toBe(false);
    expect(
      AgentRetainRequestSchema.safeParse({
        projectId,
        taskId,
        reviewDigest: "a".repeat(64),
      }).success,
    ).toBe(true);
    expect(
      AgentTaskEventSchema.safeParse({
        type: "agent.task.progress",
        taskId,
        projectId,
        phase: "tool",
        sequence: 1,
        timestamp: new Date().toISOString(),
        apiKey: "secret",
        toolInput: "manuscript",
      }).success,
    ).toBe(false);
  });
});
