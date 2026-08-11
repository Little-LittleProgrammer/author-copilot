import type { AiPatchReview } from "@author-copilot/contracts";
import { AiPatchReviewSchema } from "@author-copilot/contracts";

import type {
  ValidatedAiPatchFile,
  ValidatedAiPatchProposal,
} from "./patch-validator.js";

function lineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function lineCount(content: string): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function patchLines(prefix: "-" | "+", content: string): readonly string[] {
  if (content.length === 0) return [];
  return content.split("\n").map((line) => `${prefix}${line}`);
}

function reviewFile(
  file: ValidatedAiPatchFile,
): AiPatchReview["files"][number] {
  let offsetDelta = 0;
  const changes = file.edits.map((edit) => {
    const proposedOffset = edit.startOffset + offsetDelta;
    const originalStartLine = lineAtOffset(
      file.originalContent,
      edit.startOffset,
    );
    const proposedStartLine = lineAtOffset(
      file.proposedContent,
      proposedOffset,
    );
    const originalLineCount = lineCount(edit.expectedText);
    const proposedLineCount = lineCount(edit.replacementText);
    offsetDelta += edit.replacementText.length - edit.expectedText.length;
    const header = `@@ -${originalStartLine},${originalLineCount} +${proposedStartLine},${proposedLineCount} @@`;
    return {
      changeId: edit.changeId,
      originalStartLine,
      originalLineCount,
      proposedStartLine,
      proposedLineCount,
      patch: [
        header,
        ...patchLines("-", edit.expectedText),
        ...patchLines("+", edit.replacementText),
      ].join("\n"),
    };
  });
  return {
    relativePath: file.relativePath,
    baselineHash: file.baselineHash,
    proposedHash: file.proposedHash,
    changes,
  };
}

export function createAiPatchReview(
  proposal: ValidatedAiPatchProposal,
): AiPatchReview {
  return AiPatchReviewSchema.parse({
    summary: proposal.summary,
    files: proposal.files.map(reviewFile),
  });
}
