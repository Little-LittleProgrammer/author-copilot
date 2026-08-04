import { z } from "zod";

import {
  KnowledgeIndexStatusSchema,
  KnowledgeSearchHitSchema,
} from "./index-status.js";
import { RelativeProjectPathSchema } from "./project.js";

export const AI_CONTEXT_MAX_DOCUMENT_CHARACTERS = 200_000;
export const AI_CONTEXT_MAX_INSTRUCTION_CHARACTERS = 4_000;

export const AiContextPermissionsSchema = z.strictObject({
  readCurrentDocument: z.literal(true),
  readProjectStructure: z.literal(true),
  retrieveKnowledge: z.boolean(),
  proposeChanges: z.boolean(),
});

export type AiContextPermissions = z.infer<typeof AiContextPermissionsSchema>;

export const AiContextSelectionSchema = z
  .strictObject({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine(
    ({ startLine, endLine }) => startLine <= endLine,
    "Selection start line must not be after its end line.",
  );

export const AiContextAssemblyRequestSchema = z.strictObject({
  projectId: z.uuid(),
  currentDocument: z.strictObject({
    relativePath: RelativeProjectPathSchema,
    content: z.string().max(AI_CONTEXT_MAX_DOCUMENT_CHARACTERS),
    selection: AiContextSelectionSchema.optional(),
  }),
  instruction: z
    .string()
    .trim()
    .min(1)
    .max(AI_CONTEXT_MAX_INSTRUCTION_CHARACTERS),
  permissions: AiContextPermissionsSchema,
  retrievalLimit: z.number().int().min(1).max(20).default(5),
});

export type AiContextAssemblyRequest = z.infer<
  typeof AiContextAssemblyRequestSchema
>;

export const AiCurrentContextSectionSchema = z.strictObject({
  kind: z.literal("current"),
  contextKind: z.enum(["document", "selection"]),
  relativePath: RelativeProjectPathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  text: z.string().max(AI_CONTEXT_MAX_DOCUMENT_CHARACTERS),
});

export const AiStructurePathEntrySchema = z.strictObject({
  kind: z.enum(["volume", "chapter", "act", "document"]),
  name: z.string().trim().min(1).max(255),
  relativePath: RelativeProjectPathSchema,
});

export const AiStructureContextSectionSchema = z.strictObject({
  kind: z.literal("structure"),
  path: z.array(AiStructurePathEntrySchema).min(1),
});

export const AiKnowledgeContextSectionSchema = z.strictObject({
  kind: z.literal("knowledge"),
  scope: z.enum(["current_document", "full_book"]),
  status: KnowledgeIndexStatusSchema,
  indexVersion: z.string().trim().min(1).nullable(),
  hits: z.array(KnowledgeSearchHitSchema).max(20),
  degradationReason: z
    .enum(["index_not_ready", "permission_denied", "retrieval_failed"])
    .nullable(),
});

export const AiRequestContextSectionSchema = z.strictObject({
  kind: z.literal("request"),
  instruction: z
    .string()
    .trim()
    .min(1)
    .max(AI_CONTEXT_MAX_INSTRUCTION_CHARACTERS),
  permissions: AiContextPermissionsSchema,
});

export const AiAssembledContextSchema = z.strictObject({
  projectId: z.uuid(),
  sections: z.tuple([
    AiCurrentContextSectionSchema,
    AiStructureContextSectionSchema,
    AiKnowledgeContextSectionSchema,
    AiRequestContextSectionSchema,
  ]),
});

export type AiAssembledContext = z.infer<typeof AiAssembledContextSchema>;
