import { createHash } from "node:crypto";

import type { ValidatedAiPatchProposal } from "../src/main/ai/index.js";
import { AiPatchApplicationService } from "../src/main/ai/index.js";
import { DocumentConflictError } from "../src/main/project/index.js";
import { describe, expect, it, vi } from "vitest";

const projectId = "10000000-0000-4000-8000-000000000001";
const proposalId = "30000000-0000-4000-8000-000000000001";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function proposal(): ValidatedAiPatchProposal {
  const first = "雨夜，她开门。";
  const second = "钟声响起。";
  return {
    summary: "加强开场\n紧张感",
    files: [
      {
        relativePath: "第一章.md",
        baselineHash: hash(first),
        proposedHash: hash("暴雨之夜，她推门而入。"),
        originalContent: first,
        proposedContent: "暴雨之夜，她推门而入。",
        edits: [
          {
            changeId: "opening",
            startOffset: 0,
            endOffset: 2,
            expectedText: "雨夜",
            replacementText: "暴雨之夜",
          },
          {
            changeId: "action",
            startOffset: 4,
            endOffset: 6,
            expectedText: "开门",
            replacementText: "推门而入",
          },
        ],
      },
      {
        relativePath: "第二章.md",
        baselineHash: hash(second),
        proposedHash: hash("远处钟声响起。"),
        originalContent: second,
        proposedContent: "远处钟声响起。",
        edits: [
          {
            changeId: "sound",
            startOffset: 0,
            endOffset: 0,
            expectedText: "",
            replacementText: "远处",
          },
        ],
      },
    ],
  };
}

function service(
  options: {
    readonly applyDocumentBatch?: ReturnType<typeof vi.fn>;
    readonly createVersionForPathsWhileProjectLocked?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const applyDocumentBatch =
    options.applyDocumentBatch ??
    vi.fn(async (_projectId, writes, afterWrite) => ({
      documents: writes.map(
        (write: { relativePath: string; content: string }) => ({
          relativePath: write.relativePath,
          hash: hash(write.content),
          mtimeMs: 1,
        }),
      ),
      afterWriteResult: await afterWrite(),
    }));
  const createVersionForPathsWhileProjectLocked =
    options.createVersionForPathsWhileProjectLocked ??
    vi.fn().mockResolvedValue({
      created: true,
      version: {
        changedFiles: 1,
        commitId: "a".repeat(40),
        shortCommitId: "a".repeat(8),
        createdAt: "2026-08-12T00:00:00.000Z",
      },
    });
  return {
    applyDocumentBatch,
    createVersionForPathsWhileProjectLocked,
    application: new AiPatchApplicationService({
      projectService: { applyDocumentBatch } as never,
      gitService: { createVersionForPathsWhileProjectLocked } as never,
      createId: () => proposalId,
      now: () => 1_000,
    }),
  };
}

describe("AI patch application", () => {
  it("applies only accepted changes and creates a path-scoped Git version", async () => {
    const fixture = service();
    const review = fixture.application.createReview(projectId, proposal());

    const result = await fixture.application.apply({
      projectId,
      proposalId: review.proposalId,
      acceptedChangeIds: ["action", "sound"],
    });

    expect(result).toMatchObject({
      ok: true,
      status: "versioned",
      documents: [
        { relativePath: "第一章.md", hash: hash("雨夜，她推门而入。") },
        { relativePath: "第二章.md", hash: hash("远处钟声响起。") },
      ],
    });
    expect(fixture.applyDocumentBatch.mock.calls[0]?.[1]).toEqual([
      {
        relativePath: "第一章.md",
        expectedHash: hash("雨夜，她开门。"),
        content: "雨夜，她推门而入。",
      },
      {
        relativePath: "第二章.md",
        expectedHash: hash("钟声响起。"),
        content: "远处钟声响起。",
      },
    ]);
    expect(
      fixture.createVersionForPathsWhileProjectLocked,
    ).toHaveBeenCalledWith(projectId, "AI: 加强开场 紧张感", [
      "第一章.md",
      "第二章.md",
    ]);
    await expect(
      fixture.application.apply({
        projectId,
        proposalId,
        acceptedChangeIds: ["action"],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("keeps written content and reports Git failure separately", async () => {
    const fixture = service({
      createVersionForPathsWhileProjectLocked: vi
        .fn()
        .mockRejectedValue(new Error("git down")),
    });
    fixture.application.createReview(projectId, proposal());

    await expect(
      fixture.application.apply({
        projectId,
        proposalId,
        acceptedChangeIds: ["opening"],
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "version_failed",
      versionError: { code: "GIT_FAILED", retryable: true },
    });
  });

  it("retains a proposal after write conflict and rejects unknown changes", async () => {
    const applyDocumentBatch = vi
      .fn()
      .mockRejectedValue(new DocumentConflictError("a", "b"));
    const fixture = service({ applyDocumentBatch });
    fixture.application.createReview(projectId, proposal());

    await expect(
      fixture.application.apply({
        projectId,
        proposalId,
        acceptedChangeIds: ["opening"],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CONFLICT", retryable: true },
    });
    await expect(
      fixture.application.apply({
        projectId,
        proposalId,
        acceptedChangeIds: ["unknown"],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
  });

  it("discards and expires in-memory proposals", async () => {
    let now = 1_000;
    const fixture = service();
    const expiring = new AiPatchApplicationService({
      projectService: {
        applyDocumentBatch: fixture.applyDocumentBatch,
      } as never,
      gitService: {
        createVersionForPathsWhileProjectLocked:
          fixture.createVersionForPathsWhileProjectLocked,
      } as never,
      createId: () => proposalId,
      now: () => now,
      proposalTtlMs: 10,
    });
    expiring.createReview(projectId, proposal());
    expect(expiring.discard(projectId, proposalId)).toBe(true);
    expect(expiring.discard(projectId, proposalId)).toBe(false);
    expiring.createReview(projectId, proposal());
    now = 1_010;
    await expect(
      expiring.apply({
        projectId,
        proposalId,
        acceptedChangeIds: ["opening"],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});
