import { createHash } from "node:crypto";

import { AiPatchReviewSchema } from "@author-copilot/contracts";
import { describe, expect, it } from "vitest";

import { createAiPatchReview } from "../src/main/ai/patch-review.js";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("AI patch review", () => {
  it("creates bounded per-file and per-change diffs without full documents", () => {
    const originalContent = "雨夜。\n她推开门。\n";
    const proposedContent = "暴雨之夜。\n她推开窗。\n钟声响起。\n";
    const review = createAiPatchReview({
      summary: "加强开场氛围",
      files: [
        {
          relativePath: "第一卷/第一章/正文.md",
          baselineHash: hash(originalContent),
          proposedHash: hash(proposedContent),
          originalContent,
          proposedContent,
          edits: [
            {
              changeId: "opening",
              startOffset: 0,
              endOffset: 2,
              expectedText: "雨夜",
              replacementText: "暴雨之夜",
            },
            {
              changeId: "ending",
              startOffset: 7,
              endOffset: 9,
              expectedText: "门。",
              replacementText: "窗。\n钟声响起。",
            },
          ],
        },
      ],
    });

    expect(() => AiPatchReviewSchema.parse(review)).not.toThrow();
    expect(review.files[0]?.changes).toEqual([
      {
        changeId: "opening",
        originalStartLine: 1,
        originalLineCount: 1,
        proposedStartLine: 1,
        proposedLineCount: 1,
        patch: "@@ -1,1 +1,1 @@\n-雨夜\n+暴雨之夜",
      },
      {
        changeId: "ending",
        originalStartLine: 2,
        originalLineCount: 1,
        proposedStartLine: 2,
        proposedLineCount: 2,
        patch: "@@ -2,1 +2,2 @@\n-门。\n+窗。\n+钟声响起。",
      },
    ]);
    expect(JSON.stringify(review)).not.toContain(originalContent);
    expect(JSON.stringify(review)).not.toContain(proposedContent);
  });

  it("represents insertion-only and deletion-only changes", () => {
    const review = createAiPatchReview({
      summary: "调整停顿",
      files: [
        {
          relativePath: "正文.md",
          baselineHash: "a".repeat(64),
          proposedHash: "b".repeat(64),
          originalContent: "尾声",
          proposedContent: "\n尾",
          edits: [
            {
              changeId: "insert",
              startOffset: 0,
              endOffset: 0,
              expectedText: "",
              replacementText: "\n",
            },
            {
              changeId: "delete",
              startOffset: 1,
              endOffset: 2,
              expectedText: "声",
              replacementText: "",
            },
          ],
        },
      ],
    });

    expect(review.files[0]?.changes[0]?.patch).toBe("@@ -1,0 +1,2 @@\n+\n+");
    expect(review.files[0]?.changes[1]?.patch).toBe("@@ -1,1 +2,0 @@\n-声");
  });
});
