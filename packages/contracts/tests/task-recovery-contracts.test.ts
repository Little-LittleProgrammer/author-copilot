import { describe, expect, it } from "vitest";

import {
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  TaskRecoveryListResponseSchema,
  TaskRecoveryRestoreResponseSchema,
  TaskRecoveryRestoreRequestSchema,
} from "../src/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000002";

describe("task recovery contracts", () => {
  it("accepts only project and task identifiers for restore", () => {
    expect(
      TaskRecoveryRestoreRequestSchema.parse({ projectId, taskId }),
    ).toEqual({ projectId, taskId });
    expect(
      TaskRecoveryRestoreRequestSchema.safeParse({
        projectId,
        taskId,
        command: "reset --hard",
      }).success,
    ).toBe(false);
  });

  it("does not expose repository paths, hashes, or snapshot content", () => {
    const response = TaskRecoveryListResponseSchema.parse({
      ok: true,
      recoveries: [
        {
          taskId,
          createdAt: "2026-07-30T02:00:00.000Z",
          affectedPaths: ["第一章/场景 1.md"],
          status: "partial",
        },
      ],
    });
    expect(response.ok).toBe(true);
    expect(
      TaskRecoveryListResponseSchema.safeParse({
        ...response,
        repositoryPath: "/private/project",
      }).success,
    ).toBe(false);
  });

  it("returns structured complete, partial, and blocked restore outcomes", () => {
    const response = TaskRecoveryRestoreResponseSchema.parse({
      ok: true,
      result: {
        status: "partial",
        restoredPaths: ["第一章.md"],
        alreadyRestoredPaths: [],
        conflicts: [{ path: "第二章.md", reason: "overlapping_user_edit" }],
        failures: [],
      },
    });
    expect(response.ok).toBe(true);
  });

  it("binds list and restore channels to strict schemas", () => {
    const list = IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.taskRecoveryList];
    const restore =
      IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.taskRecoveryRestore];
    expect(list.request.parse({ projectId })).toEqual({ projectId });
    expect(restore.request.parse({ projectId, taskId })).toEqual({
      projectId,
      taskId,
    });
  });
});
