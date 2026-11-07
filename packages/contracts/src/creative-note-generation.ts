import { z } from "zod";
import { AppErrorSchema } from "./errors.js";
import { AiInstructionSchema } from "./ai-context.js";
import { CreativeNoteKindSchema } from "./creative-notes.js";
import { RelativeProjectPathSchema } from "./project.js";

export const CREATIVE_GENERATION_MAX_DOCUMENTS = 8;
export const CREATIVE_GENERATION_MAX_CONTEXT_CHARACTERS = 120_000;

export const CreativeNoteDraftSchema = z.strictObject({
  kind: CreativeNoteKindSchema,
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(100_000),
});
export type CreativeNoteDraft = z.infer<typeof CreativeNoteDraftSchema>;

export const CreativeNoteGenerationRequestSchema = z.strictObject({
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
});
export type CreativeNoteGenerationRequest = z.infer<
  typeof CreativeNoteGenerationRequestSchema
>;

export const CreativeNoteGenerationResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), draft: CreativeNoteDraftSchema }),
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
