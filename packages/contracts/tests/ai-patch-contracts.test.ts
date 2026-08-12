import { describe, expect, it } from "vitest";

import {
  AI_PATCH_MAX_EDITS_PER_FILE,
  AiPatchApplyRequestSchema,
  AiPatchApplyResponseSchema,
  AiPatchProposalSchema,
  AiPatchReviewSchema,
} from "../src/index.js";

const hash = "a".repeat(64);

describe("AI patch contracts", () => {
  it("accepts bounded project-relative text replacements", () => {
    expect(
      AiPatchProposalSchema.parse({
        summary: "收紧开场节奏",
        files: [
          {
            relativePath: "第一卷/第一章/正文.md",
            baselineHash: hash,
            edits: [
              {
                changeId: "opening-1",
                startOffset: 0,
                endOffset: 2,
                expectedText: "雨夜",
                replacementText: "暴雨之夜",
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      summary: "收紧开场节奏",
      files: [{ relativePath: "第一卷/第一章/正文.md" }],
    });
  });

  it("rejects escaping paths, invalid hashes, ranges, and unknown fields", () => {
    const valid = {
      summary: "修改正文",
      files: [
        {
          relativePath: "正文.md",
          baselineHash: hash,
          edits: [
            {
              changeId: "change-1",
              startOffset: 0,
              endOffset: 0,
              expectedText: "",
              replacementText: "开场",
            },
          ],
        },
      ],
    };

    expect(
      AiPatchProposalSchema.safeParse({
        ...valid,
        files: [{ ...valid.files[0]!, relativePath: "../secret.md" }],
      }).success,
    ).toBe(false);
    expect(
      AiPatchProposalSchema.safeParse({
        ...valid,
        files: [{ ...valid.files[0]!, baselineHash: "not-a-hash" }],
      }).success,
    ).toBe(false);
    expect(
      AiPatchProposalSchema.safeParse({
        ...valid,
        files: [
          {
            ...valid.files[0]!,
            edits: [
              {
                ...valid.files[0]!.edits[0]!,
                startOffset: 2,
                endOffset: 1,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiPatchProposalSchema.safeParse({ ...valid, absoluteRoot: "/tmp/book" })
        .success,
    ).toBe(false);
  });

  it("bounds the number of edits per document", () => {
    expect(
      AiPatchProposalSchema.safeParse({
        summary: "too many",
        files: [
          {
            relativePath: "正文.md",
            baselineHash: hash,
            edits: Array.from(
              { length: AI_PATCH_MAX_EDITS_PER_FILE + 1 },
              (_, index) => ({
                changeId: `change-${index}`,
                startOffset: index,
                endOffset: index,
                expectedText: "",
                replacementText: "x",
              }),
            ),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts review-safe per-change diffs", () => {
    expect(
      AiPatchReviewSchema.parse({
        proposalId: "30000000-0000-4000-8000-000000000001",
        summary: "修改正文",
        files: [
          {
            relativePath: "正文.md",
            baselineHash: hash,
            proposedHash: "b".repeat(64),
            changes: [
              {
                changeId: "change-1",
                originalStartLine: 1,
                originalLineCount: 1,
                proposedStartLine: 1,
                proposedLineCount: 1,
                patch: "@@ -1,1 +1,1 @@\n-雨夜\n+夜雨",
              },
            ],
          },
        ],
      }),
    ).toMatchObject({ files: [{ changes: [{ changeId: "change-1" }] }] });
  });

  it("validates accepted changes and the Git failure outcome", () => {
    expect(
      AiPatchApplyRequestSchema.safeParse({
        projectId: "10000000-0000-4000-8000-000000000001",
        proposalId: "30000000-0000-4000-8000-000000000001",
        acceptedChangeIds: ["change-1", "change-1"],
      }).success,
    ).toBe(false);
    expect(
      AiPatchApplyResponseSchema.parse({
        ok: true,
        status: "version_failed",
        documents: [{ relativePath: "正文.md", hash }],
        versionError: {
          code: "GIT_FAILED",
          message: "Git failed",
          retryable: true,
        },
      }),
    ).toMatchObject({ status: "version_failed" });
  });
});
