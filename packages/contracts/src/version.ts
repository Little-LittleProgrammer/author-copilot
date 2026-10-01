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

const CommitIdSchema = z.string().regex(/^[a-f0-9]{40,64}$/u);

export const VersionListRequestSchema = z.strictObject({
  projectId: z.uuid(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type VersionListRequest = z.infer<typeof VersionListRequestSchema>;

export const VersionDiffRequestSchema = z.strictObject({
  projectId: z.uuid(),
  commitId: CommitIdSchema,
});

export type VersionDiffRequest = z.infer<typeof VersionDiffRequestSchema>;

const BranchNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/u);

export const VersionBranchListRequestSchema = z.strictObject({
  projectId: z.uuid(),
});

export type VersionBranchListRequest = z.infer<
  typeof VersionBranchListRequestSchema
>;

export const VersionBranchSwitchRequestSchema = z.strictObject({
  projectId: z.uuid(),
  branchName: BranchNameSchema,
});

export type VersionBranchSwitchRequest = z.infer<
  typeof VersionBranchSwitchRequestSchema
>;

export const VersionOperationErrorCodeSchema = z.enum([
  "not_found",
  "branch_not_found",
  "dirty_repository",
  "task_active",
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

export const VersionSummarySchema = z.strictObject({
  commitId: CommitIdSchema,
  shortCommitId: z.string().regex(/^[a-f0-9]{7,12}$/u),
  message: z.string().max(500),
  createdAt: z.iso.datetime(),
});

export type VersionSummary = z.infer<typeof VersionSummarySchema>;

export const VersionDiffFileSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  status: z.enum(["added", "modified", "deleted", "type_changed"]),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  binary: z.boolean(),
});

export type VersionDiffFile = z.infer<typeof VersionDiffFileSchema>;

export const VersionDiffSchema = z.strictObject({
  commitId: CommitIdSchema,
  files: z.array(VersionDiffFileSchema).max(10_000),
  patch: z.string().max(1024 * 1024),
});

export type VersionDiff = z.infer<typeof VersionDiffSchema>;

export const VersionBranchSchema = z.strictObject({
  name: BranchNameSchema,
  current: z.boolean(),
});

export type VersionBranch = z.infer<typeof VersionBranchSchema>;

export const VersionBranchStateSchema = z.strictObject({
  branches: z.array(VersionBranchSchema).max(1_000),
  currentBranch: BranchNameSchema.nullable(),
});

export type VersionBranchState = z.infer<typeof VersionBranchStateSchema>;

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

export const VersionListResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    versions: z.array(VersionSummarySchema).max(100),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: VersionOperationErrorSchema,
  }),
]);

export type VersionListResponse = z.infer<typeof VersionListResponseSchema>;

export const VersionDiffResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    diff: VersionDiffSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: VersionOperationErrorSchema,
  }),
]);

export type VersionDiffResponse = z.infer<typeof VersionDiffResponseSchema>;

export const VersionBranchListResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    state: VersionBranchStateSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: VersionOperationErrorSchema,
  }),
]);

export type VersionBranchListResponse = z.infer<
  typeof VersionBranchListResponseSchema
>;

export const VersionBranchSwitchResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    switched: z.boolean(),
    branchName: BranchNameSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: VersionOperationErrorSchema,
  }),
]);

export type VersionBranchSwitchResponse = z.infer<
  typeof VersionBranchSwitchResponseSchema
>;
