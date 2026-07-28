import { z } from "zod";

const VersionMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => !value.includes("\n") && !value.includes("\r"),
    "Version message must be a single line.",
  );

export const VersionCreateRequestSchema = z.strictObject({
  projectId: z.uuid(),
  message: VersionMessageSchema,
});

export type VersionCreateRequest = z.infer<typeof VersionCreateRequestSchema>;

export const VersionOperationErrorCodeSchema = z.enum([
  "not_found",
  "git_unavailable",
  "invalid_repository",
  "git_failed",
  "timeout",
]);

export const VersionOperationErrorSchema = z.strictObject({
  code: VersionOperationErrorCodeSchema,
  message: z.string().trim().min(1),
  retryable: z.boolean(),
});

export type VersionOperationError = z.infer<typeof VersionOperationErrorSchema>;

export const VersionCreateResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    created: z.literal(true),
    version: z.strictObject({
      commitId: z.string().regex(/^[a-f0-9]{40,64}$/u),
      shortCommitId: z.string().regex(/^[a-f0-9]{7,12}$/u),
      changedFiles: z.number().int().positive(),
      createdAt: z.iso.datetime(),
    }),
  }),
  z.strictObject({
    ok: z.literal(true),
    created: z.literal(false),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: VersionOperationErrorSchema,
  }),
]);

export type VersionCreateResponse = z.infer<typeof VersionCreateResponseSchema>;
