import { describe, expect, it } from "vitest";

import {
  AnthropicCredentialResponseSchema,
  AnthropicCredentialSetRequestSchema,
  AppErrorSchema,
  IPC_CHANNEL_NAMES,
  IPC_EVENT_CONTRACTS,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  IPC_INVOKE_CHANNELS,
  IpcChannelSchema,
  KnowledgeIndexStatusSchema,
  RuntimeInfoSchema,
  TabContextSchema,
  TabStateSchema,
  TaskCancelRequestSchema,
  TaskProgressEventSchema,
  VersionBranchListResponseSchema,
  VersionBranchSwitchRequestSchema,
} from "../src/index.js";

const taskId = "20000000-0000-4000-8000-000000000001";

describe("IPC contracts", () => {
  it("keeps every declared channel in the validated whitelist", () => {
    expect(IPC_CHANNEL_NAMES).toHaveLength(46);
    for (const channel of IPC_CHANNEL_NAMES) {
      expect(IpcChannelSchema.parse(channel)).toBe(channel);
    }
    expect(IpcChannelSchema.safeParse("fs:read-any-file").success).toBe(false);
  });

  it("validates native tab contexts and state", () => {
    const project = {
      projectId: "10000000-0000-4000-8000-000000000001",
      title: "Novel",
      template: "novel",
      rootDisplayName: "Novel",
    } as const;
    expect(TabContextSchema.parse({ kind: "shell" })).toEqual({
      kind: "shell",
    });
    expect(
      TabContextSchema.parse({
        kind: "project",
        tabId: project.projectId,
        project,
      }),
    ).toMatchObject({ kind: "project", project });
    expect(
      TabStateSchema.safeParse({
        activeTabId: project.projectId,
        tabs: [
          {
            id: project.projectId,
            kind: "project",
            title: project.title,
            dirty: false,
            failed: false,
            extra: true,
          },
        ],
      }).success,
    ).toBe(false);
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

  it("keeps Anthropic credentials write-only across the IPC contract", () => {
    expect(
      AnthropicCredentialSetRequestSchema.safeParse({ apiKey: "" }).success,
    ).toBe(false);
    expect(
      AnthropicCredentialSetRequestSchema.safeParse({
        apiKey: "sk-ant-valid\nInjected",
      }).success,
    ).toBe(false);
    expect(
      AnthropicCredentialSetRequestSchema.safeParse({
        apiKey: "sk-ant-valid",
        reveal: true,
      }).success,
    ).toBe(false);
    expect(
      AnthropicCredentialResponseSchema.parse({
        ok: true,
        status: {
          configured: true,
          updatedAt: "2026-08-04T00:00:00.000Z",
        },
      }),
    ).toEqual({
      ok: true,
      status: {
        configured: true,
        updatedAt: "2026-08-04T00:00:00.000Z",
      },
    });
    expect(
      AnthropicCredentialResponseSchema.safeParse({
        ok: true,
        status: {
          configured: true,
          updatedAt: "2026-08-04T00:00:00.000Z",
          apiKey: "sk-ant-must-not-leak",
        },
      }).success,
    ).toBe(false);
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

  it("keeps knowledge search bounded and source-relative", () => {
    const searchContract =
      IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.knowledgeSearch];
    expect(
      searchContract.request.parse({
        projectId: "10000000-0000-4000-8000-000000000001",
        query: "雨夜重逢",
      }),
    ).toMatchObject({ query: "雨夜重逢", limit: 5 });
    expect(
      searchContract.request.safeParse({
        projectId: "10000000-0000-4000-8000-000000000001",
        query: "雨",
        limit: 21,
      }).success,
    ).toBe(false);
    expect(
      searchContract.response.safeParse({
        ok: true,
        status: {
          projectId: "10000000-0000-4000-8000-000000000001",
          status: "ready",
          indexVersion: "index-v1",
          updatedAt: "2026-07-30T00:00:00.000Z",
          documentCount: 1,
          chunkCount: 1,
          activeTaskId: null,
          lastError: null,
        },
        hits: [
          {
            relativePath: "第一卷/第一章/01-正文.md",
            titleContext: ["雨夜"],
            startLine: 3,
            endLine: 4,
            score: 0.8,
            text: "她在雨夜回来。",
            indexVersion: "index-v1",
          },
        ],
      }).success,
    ).toBe(true);
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

  it("keeps branch switching limited to a structured local branch name", () => {
    expect(
      VersionBranchSwitchRequestSchema.parse({
        projectId: "10000000-0000-4000-8000-000000000001",
        branchName: "备选-结局",
      }).branchName,
    ).toBe("备选-结局");
    expect(
      VersionBranchSwitchRequestSchema.safeParse({
        projectId: "10000000-0000-4000-8000-000000000001",
        branchName: "main\n--detach",
      }).success,
    ).toBe(false);
    expect(
      VersionBranchListResponseSchema.safeParse({
        ok: true,
        state: {
          currentBranch: "main",
          branches: [{ name: "main", current: true, commitId: "secret" }],
        },
      }).success,
    ).toBe(false);
  });
});
