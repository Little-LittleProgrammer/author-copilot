import { describe, expect, it } from "vitest";

import { AgentCapabilityService } from "../src/main/ai/agent/index.js";
import type { AgentCapabilityError } from "../src/main/ai/agent/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const otherProjectId = "10000000-0000-4000-8000-000000000002";
const taskId = "20000000-0000-4000-8000-000000000001";
const nextTaskId = "20000000-0000-4000-8000-000000000002";
const allowedTools = [
  "mcp__author_copilot__read_text",
  "mcp__author_copilot__write_text",
  "mcp__author_copilot__edit_text",
  "mcp__author_copilot__glob",
  "mcp__author_copilot__grep",
] as const;

function grant(
  service: AgentCapabilityService,
  requestedProjectId: string = projectId,
  requestedTaskId: string = taskId,
) {
  return service.grant(
    {
      projectId: requestedProjectId,
      readableFileTypes: ["markdown"],
      writableFileTypes: ["markdown"],
      allowedTools,
      timeoutMs: 60_000,
    },
    requestedTaskId,
  );
}

function expectCapabilityError(
  operation: () => unknown,
  code: AgentCapabilityError["code"],
): void {
  expect(operation).toThrowError(
    expect.objectContaining({ name: "AgentCapabilityError", code }),
  );
}

describe("AgentCapabilityService", () => {
  it("issues an in-memory project-bound capability and authorizes safe tools", () => {
    const service = new AgentCapabilityService({
      now: () => Date.parse("2026-08-16T00:00:00.000Z"),
    });

    expect(grant(service)).toEqual({
      taskId,
      projectId,
      readableFileTypes: ["markdown"],
      writableFileTypes: ["markdown"],
      allowedTools,
      timeoutMs: 60_000,
      createdAt: "2026-08-16T00:00:00.000Z",
    });
    expect(
      service.authorize({
        taskId,
        projectId,
        tool: "mcp__author_copilot__read_text",
        relativePath: "第一卷/第一章/正文.MD",
      }).taskId,
    ).toBe(taskId);
    expect(
      service.authorize({
        taskId,
        projectId,
        tool: "mcp__author_copilot__grep",
      }).taskId,
    ).toBe(taskId);
  });

  it("rejects project reuse, ungranted tools, invalid paths, and file types", () => {
    const service = new AgentCapabilityService({});
    grant(service);

    expectCapabilityError(() => grant(service), "task_active");
    expectCapabilityError(
      () =>
        service.authorize({
          taskId,
          projectId: otherProjectId,
          tool: "mcp__author_copilot__read_text",
          relativePath: "正文.md",
        }),
      "project_mismatch",
    );
    expectCapabilityError(
      () =>
        service.authorize({
          taskId,
          projectId,
          tool: "Bash" as never,
        }),
      "tool_not_authorized",
    );
    expectCapabilityError(
      () =>
        service.authorize({
          taskId,
          projectId,
          tool: "mcp__author_copilot__read_text",
          relativePath: "../秘密.md",
        }),
      "invalid_path",
    );
    expectCapabilityError(
      () =>
        service.authorize({
          taskId,
          projectId,
          tool: "mcp__author_copilot__write_text",
          relativePath: "脚本.ts",
        }),
      "file_type_not_authorized",
    );
    expectCapabilityError(
      () =>
        service.authorizeFilePath({
          taskId,
          projectId,
          access: "read",
          relativePath: ".private/秘密.md",
        }),
      "invalid_path",
    );
  });

  it("expires and revokes grants without carrying authority forward", () => {
    let now = Date.parse("2026-08-16T00:00:00.000Z");
    const service = new AgentCapabilityService({
      now: () => now,
    });
    grant(service);
    now += 60_000;

    expectCapabilityError(
      () =>
        service.authorize({
          taskId,
          projectId,
          tool: "mcp__author_copilot__grep",
        }),
      "task_expired",
    );
    expect(grant(service, projectId, nextTaskId).taskId).toBe(nextTaskId);
    expect(service.revoke(nextTaskId)).toBe(true);
    expect(service.revoke(nextTaskId)).toBe(false);
    expectCapabilityError(
      () =>
        service.authorize({
          taskId: nextTaskId,
          projectId,
          tool: "mcp__author_copilot__grep",
        }),
      "task_not_found",
    );
  });

  it("drops all capabilities on shutdown", () => {
    const service = new AgentCapabilityService({});
    grant(service);
    service.revokeAll();

    expectCapabilityError(
      () =>
        service.authorize({
          taskId,
          projectId,
          tool: "mcp__author_copilot__grep",
        }),
      "task_not_found",
    );
  });
});
