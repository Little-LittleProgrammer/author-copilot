import { z } from "zod";

import { ContentHashSchema, RelativeProjectPathSchema } from "./project.js";

export const AI_PATCH_MAX_FILES = 20;
export const AI_PATCH_MAX_EDITS_PER_FILE = 100;
export const AI_PATCH_MAX_TEXT_CHARACTERS = 200_000;
export const AI_PATCH_MAX_DIFF_CHARACTERS =
  AI_PATCH_MAX_TEXT_CHARACTERS * 2 + 512;

export const AiPatchChangeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u);

export const AiPatchEditSchema = z
  .strictObject({
    changeId: AiPatchChangeIdSchema,
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    expectedText: z.string().max(AI_PATCH_MAX_TEXT_CHARACTERS),
    replacementText: z.string().max(AI_PATCH_MAX_TEXT_CHARACTERS),
  })
  .refine(
    ({ startOffset, endOffset }) => startOffset <= endOffset,
    "Patch start offset must not be after its end offset.",
  );

export type AiPatchEdit = z.infer<typeof AiPatchEditSchema>;

export const AiPatchFileSchema = z.strictObject({
  relativePath: RelativeProjectPathSchema,
  baselineHash: ContentHashSchema,
  edits: z.array(AiPatchEditSchema).min(1).max(AI_PATCH_MAX_EDITS_PER_FILE),
});

export type AiPatchFile = z.infer<typeof AiPatchFileSchema>;

export const AiPatchProposalSchema = z.strictObject({
  summary: z.string().trim().min(1).max(2_000),
  files: z.array(AiPatchFileSchema).min(1).max(AI_PATCH_MAX_FILES),
});

export type AiPatchProposal = z.infer<typeof AiPatchProposalSchema>;

export const AiPatchReviewChangeSchema = z.strictObject({
  changeId: AiPatchChangeIdSchema,
  originalStartLine: z.number().int().positive(),
  originalLineCount: z.number().int().nonnegative(),
  proposedStartLine: z.number().int().positive(),
  proposedLineCount: z.number().int().nonnegative(),
  patch: z.string().min(1).max(AI_PATCH_MAX_DIFF_CHARACTERS),
});

export type AiPatchReviewChange = z.infer<typeof AiPatchReviewChangeSchema>;

export const AiPatchReviewFileSchema = z.strictObject({
  relativePath: RelativeProjectPathSchema,
  baselineHash: ContentHashSchema,
  proposedHash: ContentHashSchema,
  changes: z
    .array(AiPatchReviewChangeSchema)
    .min(1)
    .max(AI_PATCH_MAX_EDITS_PER_FILE),
});

export type AiPatchReviewFile = z.infer<typeof AiPatchReviewFileSchema>;

export const AiPatchReviewSchema = z.strictObject({
  summary: z.string().trim().min(1).max(2_000),
  files: z.array(AiPatchReviewFileSchema).min(1).max(AI_PATCH_MAX_FILES),
});

export type AiPatchReview = z.infer<typeof AiPatchReviewSchema>;
