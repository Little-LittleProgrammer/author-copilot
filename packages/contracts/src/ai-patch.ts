import { z } from "zod";

import { AppErrorSchema } from "./errors.js";
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
  proposalId: z.uuid(),
  summary: z.string().trim().min(1).max(2_000),
  files: z.array(AiPatchReviewFileSchema).min(1).max(AI_PATCH_MAX_FILES),
});

export type AiPatchReview = z.infer<typeof AiPatchReviewSchema>;

export const AiPatchApplyRequestSchema = z.strictObject({
  projectId: z.uuid(),
  proposalId: z.uuid(),
  acceptedChangeIds: z
    .array(AiPatchChangeIdSchema)
    .min(1)
    .max(AI_PATCH_MAX_FILES * AI_PATCH_MAX_EDITS_PER_FILE)
    .refine(
      (changeIds) => new Set(changeIds).size === changeIds.length,
      "Accepted patch change IDs must be unique.",
    ),
});

export type AiPatchApplyRequest = z.infer<typeof AiPatchApplyRequestSchema>;

export const AiPatchDiscardRequestSchema = z.strictObject({
  projectId: z.uuid(),
  proposalId: z.uuid(),
});

export type AiPatchDiscardRequest = z.infer<typeof AiPatchDiscardRequestSchema>;

export const AiPatchDiscardResponseSchema = z.strictObject({
  discarded: z.boolean(),
});

export type AiPatchDiscardResponse = z.infer<
  typeof AiPatchDiscardResponseSchema
>;

export const AiPatchAppliedDocumentSchema = z.strictObject({
  relativePath: RelativeProjectPathSchema,
  hash: ContentHashSchema,
});

const AiPatchAppliedDocumentsSchema = z
  .array(AiPatchAppliedDocumentSchema)
  .min(1)
  .max(AI_PATCH_MAX_FILES);

const AiPatchVersionSchema = z.strictObject({
  commitId: z.string().regex(/^[a-f0-9]{40,64}$/u),
  shortCommitId: z.string().regex(/^[a-f0-9]{7,12}$/u),
  changedFiles: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export const AiPatchApplyResponseSchema = z.discriminatedUnion("ok", [
  z.discriminatedUnion("status", [
    z.strictObject({
      ok: z.literal(true),
      status: z.literal("versioned"),
      documents: AiPatchAppliedDocumentsSchema,
      version: AiPatchVersionSchema,
    }),
    z.strictObject({
      ok: z.literal(true),
      status: z.literal("version_failed"),
      documents: AiPatchAppliedDocumentsSchema,
      versionError: AppErrorSchema,
    }),
  ]),
  z.strictObject({
    ok: z.literal(false),
    error: AppErrorSchema,
  }),
]);

export type AiPatchApplyResponse = z.infer<typeof AiPatchApplyResponseSchema>;
