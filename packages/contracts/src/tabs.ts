import { z } from "zod";

import { ProjectSummarySchema } from "./project.js";

export const TAB_BAR_HEIGHT = 42;
export const WRITER_CENTER_TAB_ID = "writer-center";

export const TabIdSchema = z.string().trim().min(1).max(200);

export const TabContextSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("shell") }),
  z.strictObject({
    kind: z.literal("center"),
    tabId: z.literal(WRITER_CENTER_TAB_ID),
  }),
  z.strictObject({
    kind: z.literal("project"),
    tabId: TabIdSchema,
    project: ProjectSummarySchema,
  }),
]);

export type TabContext = z.infer<typeof TabContextSchema>;

export const TabDescriptorSchema = z.strictObject({
  id: TabIdSchema,
  kind: z.enum(["center", "project"]),
  title: z.string().trim().min(1).max(200),
  dirty: z.boolean(),
  failed: z.boolean(),
});

export type TabDescriptor = z.infer<typeof TabDescriptorSchema>;

export const TabStateSchema = z.strictObject({
  activeTabId: TabIdSchema.nullable(),
  tabs: z.array(TabDescriptorSchema),
});

export type TabState = z.infer<typeof TabStateSchema>;

export const TabGetContextRequestSchema = z.strictObject({});
export const TabGetStateRequestSchema = z.strictObject({});
export const TabStartSessionRequestSchema = z.strictObject({});
export const TabEndSessionRequestSchema = z.strictObject({});
export const TabRequestLogoutRequestSchema = z.strictObject({});

export const TabOpenProjectRequestSchema = z.strictObject({
  projectId: z.uuid(),
});

export const TabIdRequestSchema = z.strictObject({
  tabId: TabIdSchema,
});

export const TabReportDirtyRequestSchema = z.strictObject({
  dirty: z.boolean(),
});

export const TabSetLocaleRequestSchema = z.strictObject({
  locale: z.enum(["en-US", "zh-CN"]),
});

export const TabOperationResultSchema = z.strictObject({
  status: z.enum(["completed", "cancelled", "not_found", "protected"]),
});

export type TabOperationResult = z.infer<typeof TabOperationResultSchema>;

export const TabStateChangedEventSchema = TabStateSchema;
export const TabLogoutRequestedEventSchema = z.strictObject({});
export const ProjectChangedEventSchema = ProjectSummarySchema;
