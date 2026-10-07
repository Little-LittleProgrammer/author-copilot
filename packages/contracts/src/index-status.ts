import { z } from "zod";

export const KnowledgeIndexStatusSchema = z.enum([
  "not_initialized",
  "updating",
  "ready",
  "stale",
]);

export type KnowledgeIndexStatus = z.infer<typeof KnowledgeIndexStatusSchema>;

export const KnowledgeIndexStatusResultSchema = z.strictObject({
  projectId: z.uuid(),
  status: KnowledgeIndexStatusSchema,
  indexVersion: z.string().trim().min(1).nullable(),
  updatedAt: z.iso.datetime().nullable(),
  documentCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  activeTaskId: z.uuid().nullable(),
  lastError: z.string().trim().min(1).nullable(),
});

export type KnowledgeIndexStatusResult = z.infer<
  typeof KnowledgeIndexStatusResultSchema
>;

export const KnowledgeIndexStatusRequestSchema = z.strictObject({
  projectId: z.uuid(),
});

export type KnowledgeIndexStatusRequest = z.infer<
  typeof KnowledgeIndexStatusRequestSchema
>;

export const KnowledgeIndexTaskRequestSchema = z.strictObject({
  projectId: z.uuid(),
});

export type KnowledgeIndexTaskRequest = z.infer<
  typeof KnowledgeIndexTaskRequestSchema
>;

export const KnowledgeOperationErrorSchema = z.strictObject({
  code: z.enum([
    "cancelled",
    "conflict",
    "io_failed",
    "not_found",
    "unavailable",
    "validation_failed",
  ]),
  message: z.string().trim().min(1),
  retryable: z.boolean(),
});

export type KnowledgeOperationError = z.infer<
  typeof KnowledgeOperationErrorSchema
>;

export const KnowledgeStatusResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    status: KnowledgeIndexStatusResultSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: KnowledgeOperationErrorSchema,
  }),
]);

export type KnowledgeStatusResponse = z.infer<
  typeof KnowledgeStatusResponseSchema
>;

export const KnowledgeTaskStartResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    taskId: z.uuid(),
    status: KnowledgeIndexStatusResultSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: KnowledgeOperationErrorSchema,
  }),
]);

export type KnowledgeTaskStartResponse = z.infer<
  typeof KnowledgeTaskStartResponseSchema
>;

export const KnowledgeSearchRequestSchema = z.strictObject({
  projectId: z.uuid(),
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(5),
});

export type KnowledgeSearchRequest = z.infer<
  typeof KnowledgeSearchRequestSchema
>;

export const KnowledgeSearchHitSchema = z.strictObject({
  relativePath: z.string().trim().min(1),
  titleContext: z.array(z.string().trim().min(1)).max(12),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  score: z.number().min(0).max(1),
  text: z.string().trim().min(1),
  indexVersion: z.string().trim().min(1),
});

export type KnowledgeSearchHit = z.infer<typeof KnowledgeSearchHitSchema>;

export const KnowledgeSearchResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    status: KnowledgeIndexStatusResultSchema,
    hits: z.array(KnowledgeSearchHitSchema).max(20),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: KnowledgeOperationErrorSchema,
  }),
]);

export type KnowledgeSearchResponse = z.infer<
  typeof KnowledgeSearchResponseSchema
>;
