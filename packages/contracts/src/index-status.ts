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
});

export type KnowledgeIndexStatusResult = z.infer<
  typeof KnowledgeIndexStatusResultSchema
>;
