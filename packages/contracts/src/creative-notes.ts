import { z } from "zod";

export const CreativeNoteKindSchema = z.enum([
  "outline",
  "inspiration",
  "note",
]);
export type CreativeNoteKind = z.infer<typeof CreativeNoteKindSchema>;

const CreativeNoteTitleSchema = z.string().trim().min(1).max(200);
const CreativeNoteContentSchema = z.string().max(100_000);

export const CreativeNoteSchema = z.strictObject({
  id: z.uuid(),
  kind: CreativeNoteKindSchema,
  title: CreativeNoteTitleSchema,
  content: CreativeNoteContentSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CreativeNote = z.infer<typeof CreativeNoteSchema>;

export const AI_CREATIVE_NOTES_MAX_COUNT = 6;
export const AI_CREATIVE_NOTE_MAX_CHARACTERS = 4_000;

export const CreativeNoteReferenceSchema = z
  .strictObject({
    id: z.uuid(),
    kind: CreativeNoteKindSchema,
    title: CreativeNoteTitleSchema,
    content: z.string().max(AI_CREATIVE_NOTE_MAX_CHARACTERS),
    updatedAt: z.iso.datetime(),
    originalContentLength: z.number().int().min(0).max(100_000),
  })
  .refine((note) => note.originalContentLength >= note.content.length);
export type CreativeNoteReference = z.infer<typeof CreativeNoteReferenceSchema>;

export const CreativeNoteReferencesSchema = z
  .array(CreativeNoteReferenceSchema)
  .max(AI_CREATIVE_NOTES_MAX_COUNT)
  .refine(
    (notes) => new Set(notes.map((note) => note.id)).size === notes.length,
  );

export const CreativeNotesProjectRequestSchema = z.strictObject({
  projectId: z.uuid(),
});
export type CreativeNotesProjectRequest = z.infer<
  typeof CreativeNotesProjectRequestSchema
>;

export const CreativeNoteCreateRequestSchema = z.strictObject({
  projectId: z.uuid(),
  kind: CreativeNoteKindSchema,
  title: CreativeNoteTitleSchema,
  content: CreativeNoteContentSchema,
});
export type CreativeNoteCreateRequest = z.infer<
  typeof CreativeNoteCreateRequestSchema
>;

export const CreativeNoteUpdateRequestSchema = z.strictObject({
  projectId: z.uuid(),
  noteId: z.uuid(),
  kind: CreativeNoteKindSchema,
  title: CreativeNoteTitleSchema,
  content: CreativeNoteContentSchema,
  expectedUpdatedAt: z.iso.datetime(),
});
export type CreativeNoteUpdateRequest = z.infer<
  typeof CreativeNoteUpdateRequestSchema
>;

export const CreativeNoteDeleteRequestSchema = z.strictObject({
  projectId: z.uuid(),
  noteId: z.uuid(),
});
export type CreativeNoteDeleteRequest = z.infer<
  typeof CreativeNoteDeleteRequestSchema
>;

const CreativeNotesErrorSchema = z.enum([
  "invalid_request",
  "unavailable",
  "not_found",
  "conflict",
]);

export const CreativeNotesListResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), notes: z.array(CreativeNoteSchema) }),
  z.strictObject({ ok: z.literal(false), error: CreativeNotesErrorSchema }),
]);
export type CreativeNotesListResponse = z.infer<
  typeof CreativeNotesListResponseSchema
>;

export const CreativeNoteResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), note: CreativeNoteSchema }),
  z.strictObject({ ok: z.literal(false), error: CreativeNotesErrorSchema }),
]);
export type CreativeNoteResponse = z.infer<typeof CreativeNoteResponseSchema>;

export const CreativeNoteDeleteResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), deleted: z.boolean() }),
  z.strictObject({ ok: z.literal(false), error: CreativeNotesErrorSchema }),
]);
export type CreativeNoteDeleteResponse = z.infer<
  typeof CreativeNoteDeleteResponseSchema
>;
