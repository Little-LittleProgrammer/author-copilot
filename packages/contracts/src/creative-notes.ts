import { z } from "zod";
import { ContentHashSchema, RelativeProjectPathSchema } from "./project.js";

export const CreativeNoteKindSchema = z.enum([
  "outline",
  "inspiration",
  "note",
  "summary",
  "fact",
]);
export type CreativeNoteKind = z.infer<typeof CreativeNoteKindSchema>;

export const isSourcedNoteKind = (kind: CreativeNoteKind): boolean =>
  kind === "summary" || kind === "fact";

export const FACT_EXTRACTION_MAX_CANDIDATES = 12;
export const FactContentSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(4_000).trim().min(1),
});

const CreativeNoteTitleSchema = z.string().trim().min(1).max(200);
const CreativeNoteContentSchema = z.string().max(100_000);

export const CreativeNoteSourceSchema = z.strictObject({
  relativePath: RelativeProjectPathSchema,
  contentHash: ContentHashSchema,
  capturedAt: z.iso.datetime(),
});
export type CreativeNoteSource = z.infer<typeof CreativeNoteSourceSchema>;

const hasValidSource = (note: {
  kind: CreativeNoteKind;
  title: string;
  content: string;
  source?: CreativeNoteSource | undefined;
}): boolean =>
  isSourcedNoteKind(note.kind) === (note.source !== undefined) &&
  (note.kind !== "fact" ||
    FactContentSchema.safeParse({ title: note.title, content: note.content })
      .success);

export const CreativeNoteSchema = z
  .strictObject({
    id: z.uuid(),
    kind: CreativeNoteKindSchema,
    title: CreativeNoteTitleSchema,
    content: CreativeNoteContentSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    source: CreativeNoteSourceSchema.optional(),
  })
  .refine(
    hasValidSource,
    "Only chapter summaries and facts require a source snapshot.",
  );
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
    source: CreativeNoteSourceSchema.optional(),
  })
  .refine((note) => note.originalContentLength >= note.content.length)
  .refine(
    hasValidSource,
    "Only chapter summaries and facts require a source snapshot.",
  );
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

export const FactCandidateSchema = FactContentSchema.extend({
  id: z.uuid(),
  kind: z.literal("fact"),
  source: CreativeNoteSourceSchema,
});
export type FactCandidate = z.infer<typeof FactCandidateSchema>;
export const CreativeFactsConfirmRequestSchema = z.strictObject({
  projectId: z.uuid(),
  facts: z
    .array(FactCandidateSchema)
    .min(1)
    .max(FACT_EXTRACTION_MAX_CANDIDATES)
    .refine(
      (facts) => new Set(facts.map((fact) => fact.id)).size === facts.length,
    ),
});
export type CreativeFactsConfirmRequest = z.infer<
  typeof CreativeFactsConfirmRequestSchema
>;

export const CreativeNoteCreateRequestSchema = z
  .strictObject({
    projectId: z.uuid(),
    kind: CreativeNoteKindSchema,
    title: CreativeNoteTitleSchema,
    content: CreativeNoteContentSchema,
    source: CreativeNoteSourceSchema.optional(),
  })
  .refine(
    hasValidSource,
    "Only chapter summaries and facts require a source snapshot.",
  );
export type CreativeNoteCreateRequest = z.infer<
  typeof CreativeNoteCreateRequestSchema
>;

export const CreativeNoteUpdateRequestSchema = z
  .strictObject({
    projectId: z.uuid(),
    noteId: z.uuid(),
    kind: CreativeNoteKindSchema,
    title: CreativeNoteTitleSchema,
    content: CreativeNoteContentSchema,
    expectedUpdatedAt: z.iso.datetime(),
    source: CreativeNoteSourceSchema.optional(),
  })
  .refine(
    hasValidSource,
    "Only chapter summaries and facts require a source snapshot.",
  );
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

export const CreativeNoteSourceStatusRequestSchema =
  CreativeNoteDeleteRequestSchema;
export type CreativeNoteSourceStatusRequest = z.infer<
  typeof CreativeNoteSourceStatusRequestSchema
>;
export const CreativeNoteSourceStatusResponseSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      ok: z.literal(true),
      status: z.enum(["current", "changed", "missing"]),
    }),
    z.strictObject({ ok: z.literal(false), error: CreativeNotesErrorSchema }),
  ],
);
export type CreativeNoteSourceStatusResponse = z.infer<
  typeof CreativeNoteSourceStatusResponseSchema
>;
