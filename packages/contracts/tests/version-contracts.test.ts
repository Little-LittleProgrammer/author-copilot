import { describe, expect, it } from "vitest";

import {
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  VersionCreateRequestSchema,
  VersionCreateResponseSchema,
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
});
