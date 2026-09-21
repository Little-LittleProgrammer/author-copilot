import { describe, expect, it } from "vitest";

import {
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  VersionCreateRequestSchema,
  VersionCreateResponseSchema,
  VersionDiffRequestSchema,
  VersionDiffResponseSchema,
  VersionListRequestSchema,
  VersionListResponseSchema,
} from "../src/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";

describe("version contracts", () => {
  it("accepts a bounded single-line version message", () => {
    expect(
      VersionCreateRequestSchema.parse({
        projectId,
        message: "保存第一章",
      }),
    ).toEqual({ projectId, message: "保存第一章" });
    expect(
      VersionCreateRequestSchema.safeParse({ projectId, message: "a\nb" })
        .success,
    ).toBe(false);
  });

  it("does not expose repository paths or command output", () => {
    const response = VersionCreateResponseSchema.parse({
      ok: true,
      created: true,
      version: {
        commitId: "a".repeat(40),
        shortCommitId: "a".repeat(8),
        changedFiles: 2,
        createdAt: "2026-07-27T10:00:00.000Z",
      },
    });
    expect(response).toEqual({
      ok: true,
      created: true,
      version: {
        commitId: "a".repeat(40),
        shortCommitId: "a".repeat(8),
        changedFiles: 2,
        createdAt: "2026-07-27T10:00:00.000Z",
      },
    });
    expect(
      VersionCreateResponseSchema.safeParse({
        ...response,
        repositoryPath: "/private/project",
      }).success,
    ).toBe(false);
  });

  it("binds the create-version IPC channel to strict schemas", () => {
    const contract = IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.versionCreate];
    expect(contract.request.parse({ projectId, message: "初稿" })).toEqual({
      projectId,
      message: "初稿",
    });
    expect(contract.response.parse({ ok: true, created: false })).toEqual({
      ok: true,
      created: false,
    });
  });

  it("accepts bounded history queries and full commit ids", () => {
    expect(VersionListRequestSchema.parse({ projectId })).toEqual({
      projectId,
      limit: 50,
    });
    expect(
      VersionListRequestSchema.safeParse({ projectId, limit: 101 }).success,
    ).toBe(false);
    expect(
      VersionDiffRequestSchema.parse({ projectId, commitId: "a".repeat(40) }),
    ).toEqual({ projectId, commitId: "a".repeat(40) });
    expect(
      VersionDiffRequestSchema.safeParse({ projectId, commitId: "HEAD~1" })
        .success,
    ).toBe(false);
  });

  it("returns strict version history and structured diff data", () => {
    const summary = {
      commitId: "a".repeat(40),
      shortCommitId: "a".repeat(8),
      message: "保存第一章",
      createdAt: "2026-07-29T10:00:00.000Z",
    };
    expect(
      VersionListResponseSchema.parse({ ok: true, versions: [summary] }),
    ).toEqual({ ok: true, versions: [summary] });
    const response = VersionDiffResponseSchema.parse({
      ok: true,
      diff: {
        commitId: summary.commitId,
        files: [
          {
            path: "第一章.md",
            status: "modified",
            additions: 2,
            deletions: 1,
            binary: false,
          },
        ],
        patch: "diff --git a/第一章.md b/第一章.md\n",
      },
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error("Expected a successful diff response.");
    expect(response.diff.files[0]).toMatchObject({
      path: "第一章.md",
      status: "modified",
    });
  });

  it("binds history and diff channels to their schemas", () => {
    const listContract = IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.versionList];
    const diffContract = IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.versionDiff];
    expect(listContract.request.parse({ projectId })).toEqual({
      projectId,
      limit: 50,
    });
    expect(
      diffContract.request.parse({ projectId, commitId: "b".repeat(40) }),
    ).toEqual({ projectId, commitId: "b".repeat(40) });
  });
});
