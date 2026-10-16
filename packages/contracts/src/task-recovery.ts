import { z } from "zod";

const ProjectIdSchema = z.uuid();
const TaskIdSchema = z.uuid();
const ProjectRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !value.includes("\0"),
    "Expected a project-relative path.",
  );

export const TaskRecoveryListRequestSchema = z.strictObject({
  projectId: ProjectIdSchema,
});

export type TaskRecoveryListRequest = z.infer<
  typeof TaskRecoveryListRequestSchema
>;

export const TaskRecoveryRestoreRequestSchema = z.strictObject({
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
});

export type TaskRecoveryRestoreRequest = z.infer<
  typeof TaskRecoveryRestoreRequestSchema
>;

export const TaskRecoveryErrorSchema = z.strictObject({
  code: z.enum([
    "not_found",
    "invalid_repository",
    "invalid_snapshot",
    "task_conflict",
    "git_unavailable",
    "timeout",
    "io_failed",
  ]),
  message: z.string().trim().min(1),
  retryable: z.boolean(),
});

export type TaskRecoveryError = z.infer<typeof TaskRecoveryErrorSchema>;

export const TaskRecoverySummarySchema = z.strictObject({
  taskId: TaskIdSchema,
  createdAt: z.iso.datetime(),
  affectedPaths: z.array(ProjectRelativePathSchema).max(10_000),
  status: z.enum(["active", "partial", "blocked"]),
});

export type TaskRecoverySummary = z.infer<typeof TaskRecoverySummarySchema>;

export const TaskRecoveryListResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    recoveries: z.array(TaskRecoverySummarySchema).max(100),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: TaskRecoveryErrorSchema,
  }),
]);

export type TaskRecoveryListResponse = z.infer<
  typeof TaskRecoveryListResponseSchema
>;

export const TaskRestoreConflictReasonSchema = z.enum([
  "head_changed",
  "index_entry_changed",
  "overlapping_user_edit",
  "binary_concurrent_change",
  "create_delete_concurrent_change",
]);

export const TaskRestoreResultSchema = z.strictObject({
  status: z.enum(["complete", "partial", "blocked"]),
  restoredPaths: z.array(ProjectRelativePathSchema).max(10_000),
  alreadyRestoredPaths: z.array(ProjectRelativePathSchema).max(10_000),
  conflicts: z
    .array(
      z.strictObject({
        path: ProjectRelativePathSchema.nullable(),
        reason: TaskRestoreConflictReasonSchema,
      }),
    )
    .max(10_000),
  failures: z
    .array(
      z.strictObject({
        path: ProjectRelativePathSchema,
        message: z.string().trim().min(1).max(500),
      }),
    )
    .max(10_000),
});

export type TaskRestoreResult = z.infer<typeof TaskRestoreResultSchema>;

export const TaskRecoveryRestoreResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    result: TaskRestoreResultSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: TaskRecoveryErrorSchema,
  }),
]);

export type TaskRecoveryRestoreResponse = z.infer<
  typeof TaskRecoveryRestoreResponseSchema
>;
