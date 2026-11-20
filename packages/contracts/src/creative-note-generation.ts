import { z } from "zod";
import { AppErrorSchema } from "./errors.js";
import { AiInstructionSchema } from "./ai-context.js";
import {
  CreativeNoteKindSchema,
  CreativeNoteSourceSchema,
  isSourcedNoteKind,
  FactContentSchema,
  FACT_EXTRACTION_MAX_CANDIDATES,
  FactCandidateSchema,
} from "./creative-notes.js";
import { RelativeProjectPathSchema } from "./project.js";

export const CREATIVE_GENERATION_MAX_DOCUMENTS = 8;
export const CREATIVE_GENERATION_MAX_CONTEXT_CHARACTERS = 120_000;

export const CreativeNoteDraftContentSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(100_000),
});
export const CreativeNoteDraftSchema = CreativeNoteDraftContentSchema.extend({
  kind: CreativeNoteKindSchema,
  source: CreativeNoteSourceSchema.optional(),
}).refine(
  (draft) =>
    isSourcedNoteKind(draft.kind) === (draft.source !== undefined) &&
    (draft.kind !== "fact" ||
      FactContentSchema.safeParse({
        title: draft.title,
        content: draft.content,
      }).success),
  "Summaries and facts require a source snapshot and valid content.",
);
export type CreativeNoteDraft = z.infer<typeof CreativeNoteDraftSchema>;

export const CreativeNoteGenerationRequestSchema = z
  .strictObject({
    projectId: z.uuid(),
    requestId: z.uuid(),
    kind: CreativeNoteKindSchema,
    instruction: AiInstructionSchema,
    locale: z.enum(["zh-CN", "en-US"]),
    noteIds: z
      .array(z.uuid())
      .max(6)
      .refine((ids) => new Set(ids).size === ids.length),
    documentPaths: z
      .array(RelativeProjectPathSchema)
      .max(CREATIVE_GENERATION_MAX_DOCUMENTS)
      .refine((paths) => new Set(paths).size === paths.length),
    target: z
      .strictObject({
        noteId: z.uuid(),
        expectedUpdatedAt: z.iso.datetime(),
      })
      .optional(),
  })
  .refine(
    (request) =>
      !isSourcedNoteKind(request.kind) ||
      (request.documentPaths.length === 1 && request.noteIds.length === 0),
    "A chapter summary requires exactly one saved document and no reference notes.",
  )
  .refine(
    (request) => request.kind !== "fact" || request.target === undefined,
    "Fact extraction creates candidates and cannot replace an existing note.",
  );
export type CreativeNoteGenerationRequest = z.infer<
  typeof CreativeNoteGenerationRequestSchema
>;

export const FactExtractionContentSchema = z.strictObject({
  facts: z.array(FactContentSchema).max(FACT_EXTRACTION_MAX_CANDIDATES),
});

export const CreativeNoteGenerationResponseSchema = z.union([
  z.strictObject({ ok: z.literal(true), draft: CreativeNoteDraftSchema }),
  z.strictObject({
    ok: z.literal(true),
    candidates: z
      .array(FactCandidateSchema)
      .max(FACT_EXTRACTION_MAX_CANDIDATES),
  }),
  z.strictObject({ ok: z.literal(false), error: AppErrorSchema }),
]);
export type CreativeNoteGenerationResponse = z.infer<
  typeof CreativeNoteGenerationResponseSchema
>;

export const CreativeNoteGenerationCancelRequestSchema = z.strictObject({
  projectId: z.uuid(),
  requestId: z.uuid(),
});
export type CreativeNoteGenerationCancelRequest = z.infer<
  typeof CreativeNoteGenerationCancelRequestSchema
>;
export const CreativeNoteGenerationCancelResponseSchema = z.strictObject({
  accepted: z.boolean(),
});
export type CreativeNoteGenerationCancelResponse = z.infer<
  typeof CreativeNoteGenerationCancelResponseSchema
>;
