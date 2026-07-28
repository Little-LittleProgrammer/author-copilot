import { describe, expect, it } from "vitest";

import {
  AppErrorSchema,
  IPC_CHANNEL_NAMES,
  IPC_EVENT_CONTRACTS,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  IPC_INVOKE_CHANNELS,
  IpcChannelSchema,
  KnowledgeIndexStatusSchema,
  RuntimeInfoSchema,
  TaskCancelRequestSchema,
  TaskProgressEventSchema,
} from "../src/index.js";

const taskId = "20000000-0000-4000-8000-000000000001";

describe("IPC contracts", () => {
  it("keeps every declared channel in the validated whitelist", () => {
    expect(IPC_CHANNEL_NAMES).toHaveLength(13);
    for (const channel of IPC_CHANNEL_NAMES) {
      expect(IpcChannelSchema.parse(channel)).toBe(channel);
    }
    expect(IpcChannelSchema.safeParse("fs:read-any-file").success).toBe(false);
  });

  it("binds invoke and event channels to schemas", () => {
    expect(
      IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.runtimeGetInfo].request.parse(
        {},
      ),
    ).toEqual({});
    expect(
      IPC_EVENT_CONTRACTS[IPC_EVENT_CHANNELS.taskProgress].safeParse({
        type: "task.progress",
        taskId,
        taskKind: "index_initialize",
        phase: "scan",
        completed: 1,
        total: 10,
        timestamp: "2026-07-13T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("shared DTO schemas", () => {
  it("accepts only the four documented index states", () => {
    expect(KnowledgeIndexStatusSchema.options).toEqual([
      "not_initialized",
      "updating",
      "ready",
      "stale",
    ]);
    expect(KnowledgeIndexStatusSchema.safeParse("failed").success).toBe(false);
  });

  it("rejects extra runtime fields and unsupported platforms", () => {
    const runtime = {
      appVersion: "0.0.0",
      electronVersion: "41.0.3",
      nodeVersion: "24.16.0",
      platform: "darwin",
      arch: "arm64",
      packaged: false,
    };

    expect(RuntimeInfoSchema.safeParse(runtime).success).toBe(true);
    expect(
      RuntimeInfoSchema.safeParse({ ...runtime, secret: "no" }).success,
    ).toBe(false);
    expect(
      RuntimeInfoSchema.safeParse({ ...runtime, platform: "linux" }).success,
    ).toBe(false);
  });

  it("validates structured errors and cancellation requests", () => {
    expect(
      AppErrorSchema.safeParse({
        code: "PATH_NOT_AUTHORIZED",
        message: "The path is outside the registered project.",
        retryable: false,
      }).success,
    ).toBe(true);
    expect(TaskCancelRequestSchema.parse({ taskId })).toEqual({ taskId });
  });

  it("rejects malformed progress events", () => {
    expect(
      TaskProgressEventSchema.safeParse({
        type: "task.progress",
        taskId,
        taskKind: "agent",
        phase: "write",
        completed: -1,
        total: null,
        timestamp: "not-a-timestamp",
      }).success,
    ).toBe(false);
  });
});
