import { z } from "zod";

export const ProjectTemplateSchema = z.enum(["novel", "screenplay"]);

export type ProjectTemplate = z.infer<typeof ProjectTemplateSchema>;

const DisplayNameSchema = z.string().trim().min(1).max(255);
const ProjectTitleSchema = z.string().trim().min(1).max(200);
const MainProcessTokenSchema = z.string().trim().min(1).max(512);

export const RelativeProjectPathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\0"), "Path must not contain NUL bytes.")
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-zA-Z]:[\\/]/u.test(value),
    "Path must be relative to the project root.",
  )
  .refine(
    (value) =>
      value
        .replaceAll("\\", "/")
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        ),
    "Path must not contain empty, current-directory, or parent-directory segments.",
  );

export type RelativeProjectPath = z.infer<typeof RelativeProjectPathSchema>;

export const ContentHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/iu, "Content hash must be a SHA-256 hex digest.");

export type ContentHash = z.infer<typeof ContentHashSchema>;

export const ProjectOperationErrorCodeSchema = z.enum([
  "cancelled",
  "not_found",
  "conflict",
  "duplicate_project_id",
  "invalid_path",
  "io_error",
  "invalid_metadata",
]);

export type ProjectOperationErrorCode = z.infer<
  typeof ProjectOperationErrorCodeSchema
>;

export const ProjectOperationErrorSchema = z.strictObject({
  code: ProjectOperationErrorCodeSchema,
  message: z.string().trim().min(1),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ProjectOperationError = z.infer<typeof ProjectOperationErrorSchema>;

export const ProjectOperationFailureSchema = z.strictObject({
  ok: z.literal(false),
  error: ProjectOperationErrorSchema,
});

export type ProjectOperationFailure = z.infer<
  typeof ProjectOperationFailureSchema
>;

export const ProjectSummarySchema = z.strictObject({
  projectId: z.uuid(),
  title: ProjectTitleSchema,
  template: ProjectTemplateSchema,
  rootDisplayName: DisplayNameSchema,
});

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectCreateRequestSchema = z.strictObject({
  title: ProjectTitleSchema,
  template: ProjectTemplateSchema,
});

export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>;

export const ProjectCreateResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    project: ProjectSummarySchema,
  }),
  ProjectOperationFailureSchema,
]);

export type ProjectCreateResponse = z.infer<typeof ProjectCreateResponseSchema>;

export const ProjectImportPreviewRequestSchema = z.strictObject({
  template: ProjectTemplateSchema,
});

export type ProjectImportPreviewRequest = z.infer<
  typeof ProjectImportPreviewRequestSchema
>;

export const ProjectImportNodeRoleSchema = z.enum([
  "volume",
  "chapter",
  "act",
  "scene",
]);

export type ProjectImportNodeRole = z.infer<typeof ProjectImportNodeRoleSchema>;

export interface ProjectImportRecognizedNode {
  role: ProjectImportNodeRole;
  displayName: string;
  relativePath: RelativeProjectPath;
  children: ProjectImportRecognizedNode[];
}

export const ProjectImportRecognizedNodeSchema: z.ZodType<ProjectImportRecognizedNode> =
  z.strictObject({
    role: ProjectImportNodeRoleSchema,
    displayName: DisplayNameSchema,
    relativePath: RelativeProjectPathSchema,
    children: z.lazy(() => z.array(ProjectImportRecognizedNodeSchema)),
  });

export const ProjectImportUnclassifiedFileSchema = z.strictObject({
  displayName: DisplayNameSchema,
  relativePath: RelativeProjectPathSchema,
});

export type ProjectImportUnclassifiedFile = z.infer<
  typeof ProjectImportUnclassifiedFileSchema
>;

export const ProjectImportPreviewResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    previewToken: MainProcessTokenSchema,
    sourceRoot: z.strictObject({
      displayName: DisplayNameSchema,
    }),
    template: ProjectTemplateSchema,
    recognizedTree: z.array(ProjectImportRecognizedNodeSchema),
    unclassifiedFiles: z.array(ProjectImportUnclassifiedFileSchema),
  }),
  ProjectOperationFailureSchema,
]);

export type ProjectImportPreviewResponse = z.infer<
  typeof ProjectImportPreviewResponseSchema
>;

export const ProjectConfirmImportRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    previewToken: MainProcessTokenSchema,
    mode: z.literal("in_place"),
    reassignProjectId: z.boolean().optional(),
  }),
  z.strictObject({
    previewToken: MainProcessTokenSchema,
    mode: z.literal("copy"),
  }),
]);

export type ProjectConfirmImportRequest = z.infer<
  typeof ProjectConfirmImportRequestSchema
>;

export const ProjectConfirmImportResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    project: ProjectSummarySchema,
  }),
  ProjectOperationFailureSchema,
]);

export type ProjectConfirmImportResponse = z.infer<
  typeof ProjectConfirmImportResponseSchema
>;

export const ProjectListRequestSchema = z.strictObject({});

export type ProjectListRequest = z.infer<typeof ProjectListRequestSchema>;

export const ProjectListResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    projects: z.array(ProjectSummarySchema),
  }),
  ProjectOperationFailureSchema,
]);

export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

export const ProjectStructureNodeKindSchema = z.enum(["directory", "document"]);

export const ProjectStructureNodeRoleSchema = z.enum([
  "volume",
  "chapter",
  "act",
  "scene",
  "unclassified",
]);

export type ProjectStructureNodeKind = z.infer<
  typeof ProjectStructureNodeKindSchema
>;
export type ProjectStructureNodeRole = z.infer<
  typeof ProjectStructureNodeRoleSchema
>;

export interface ProjectStructureNode {
  kind: ProjectStructureNodeKind;
  role: ProjectStructureNodeRole;
  displayName: string;
  relativePath: RelativeProjectPath;
  children: ProjectStructureNode[];
}

export const ProjectStructureNodeSchema: z.ZodType<ProjectStructureNode> =
  z.strictObject({
    kind: ProjectStructureNodeKindSchema,
    role: ProjectStructureNodeRoleSchema,
    displayName: DisplayNameSchema,
    relativePath: RelativeProjectPathSchema,
    children: z.lazy(() => z.array(ProjectStructureNodeSchema)),
  });

export const ProjectGetStructureRequestSchema = z.strictObject({
  projectId: z.uuid(),
});

export type ProjectGetStructureRequest = z.infer<
  typeof ProjectGetStructureRequestSchema
>;

export const ProjectGetStructureResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    projectId: z.uuid(),
    nodes: z.array(ProjectStructureNodeSchema),
  }),
  ProjectOperationFailureSchema,
]);

export type ProjectGetStructureResponse = z.infer<
  typeof ProjectGetStructureResponseSchema
>;

export const DocumentReadRequestSchema = z.strictObject({
  projectId: z.uuid(),
  relativePath: RelativeProjectPathSchema,
});

export type DocumentReadRequest = z.infer<typeof DocumentReadRequestSchema>;

export const DocumentReadResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    relativePath: RelativeProjectPathSchema,
    content: z.string(),
    contentHash: ContentHashSchema,
    mtimeMs: z.number().finite().nonnegative(),
  }),
  ProjectOperationFailureSchema,
]);

export type DocumentReadResponse = z.infer<typeof DocumentReadResponseSchema>;

export const DocumentSaveRequestSchema = z.strictObject({
  projectId: z.uuid(),
  relativePath: RelativeProjectPathSchema,
  expectedHash: ContentHashSchema,
  content: z.string(),
});

export type DocumentSaveRequest = z.infer<typeof DocumentSaveRequestSchema>;

export const DocumentSaveResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    contentHash: ContentHashSchema,
    mtimeMs: z.number().finite().nonnegative(),
  }),
  ProjectOperationFailureSchema,
]);

export type DocumentSaveResponse = z.infer<typeof DocumentSaveResponseSchema>;
