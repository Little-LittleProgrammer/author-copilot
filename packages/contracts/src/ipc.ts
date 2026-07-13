import { z } from "zod";

import { KnowledgeIndexStatusResultSchema } from "./index-status.js";
import {
  DocumentReadRequestSchema,
  DocumentReadResponseSchema,
  DocumentSaveRequestSchema,
  DocumentSaveResponseSchema,
  ProjectConfirmImportRequestSchema,
  ProjectConfirmImportResponseSchema,
  ProjectCreateRequestSchema,
  ProjectCreateResponseSchema,
  ProjectGetStructureRequestSchema,
  ProjectGetStructureResponseSchema,
  ProjectImportPreviewRequestSchema,
  ProjectImportPreviewResponseSchema,
  ProjectListRequestSchema,
  ProjectListResponseSchema,
} from "./project.js";
import { RuntimeInfoRequestSchema, RuntimeInfoSchema } from "./runtime.js";
import {
  TaskCancelledEventSchema,
  TaskCancelRequestSchema,
  TaskCancelResultSchema,
  TaskProgressEventSchema,
} from "./tasks.js";

export const IPC_INVOKE_CHANNELS = {
  runtimeGetInfo: "app:get-runtime-info",
  projectCreate: "project:create",
  projectPreviewImport: "project:preview-import",
  projectConfirmImport: "project:confirm-import",
  projectList: "project:list",
  projectGetStructure: "project:get-structure",
  documentRead: "document:read",
  documentSave: "document:save",
  knowledgeGetStatus: "knowledge:get-status",
  taskCancel: "task:cancel",
} as const;

export const IPC_EVENT_CHANNELS = {
  taskProgress: "task:progress",
  taskCancelled: "task:cancelled",
} as const;

export const IPC_INVOKE_CHANNEL_NAMES = [
  IPC_INVOKE_CHANNELS.runtimeGetInfo,
  IPC_INVOKE_CHANNELS.projectCreate,
  IPC_INVOKE_CHANNELS.projectPreviewImport,
  IPC_INVOKE_CHANNELS.projectConfirmImport,
  IPC_INVOKE_CHANNELS.projectList,
  IPC_INVOKE_CHANNELS.projectGetStructure,
  IPC_INVOKE_CHANNELS.documentRead,
  IPC_INVOKE_CHANNELS.documentSave,
  IPC_INVOKE_CHANNELS.knowledgeGetStatus,
  IPC_INVOKE_CHANNELS.taskCancel,
] as const;

export const IPC_EVENT_CHANNEL_NAMES = [
  IPC_EVENT_CHANNELS.taskProgress,
  IPC_EVENT_CHANNELS.taskCancelled,
] as const;

export const IPC_CHANNEL_NAMES = [
  ...IPC_INVOKE_CHANNEL_NAMES,
  ...IPC_EVENT_CHANNEL_NAMES,
] as const;

export const IpcInvokeChannelSchema = z.enum(IPC_INVOKE_CHANNEL_NAMES);
export const IpcEventChannelSchema = z.enum(IPC_EVENT_CHANNEL_NAMES);
export const IpcChannelSchema = z.enum(IPC_CHANNEL_NAMES);

export type IpcInvokeChannel = z.infer<typeof IpcInvokeChannelSchema>;
export type IpcEventChannel = z.infer<typeof IpcEventChannelSchema>;
export type IpcChannel = z.infer<typeof IpcChannelSchema>;

export const KnowledgeIndexStatusRequestSchema = z.strictObject({
  projectId: z.uuid(),
});

export type KnowledgeIndexStatusRequest = z.infer<
  typeof KnowledgeIndexStatusRequestSchema
>;

export const IPC_INVOKE_CONTRACTS = {
  [IPC_INVOKE_CHANNELS.runtimeGetInfo]: {
    request: RuntimeInfoRequestSchema,
    response: RuntimeInfoSchema,
  },
  [IPC_INVOKE_CHANNELS.projectCreate]: {
    request: ProjectCreateRequestSchema,
    response: ProjectCreateResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.projectPreviewImport]: {
    request: ProjectImportPreviewRequestSchema,
    response: ProjectImportPreviewResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.projectConfirmImport]: {
    request: ProjectConfirmImportRequestSchema,
    response: ProjectConfirmImportResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.projectList]: {
    request: ProjectListRequestSchema,
    response: ProjectListResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.projectGetStructure]: {
    request: ProjectGetStructureRequestSchema,
    response: ProjectGetStructureResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.documentRead]: {
    request: DocumentReadRequestSchema,
    response: DocumentReadResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.documentSave]: {
    request: DocumentSaveRequestSchema,
    response: DocumentSaveResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.knowledgeGetStatus]: {
    request: KnowledgeIndexStatusRequestSchema,
    response: KnowledgeIndexStatusResultSchema,
  },
  [IPC_INVOKE_CHANNELS.taskCancel]: {
    request: TaskCancelRequestSchema,
    response: TaskCancelResultSchema,
  },
} as const;

export const IPC_EVENT_CONTRACTS = {
  [IPC_EVENT_CHANNELS.taskProgress]: TaskProgressEventSchema,
  [IPC_EVENT_CHANNELS.taskCancelled]: TaskCancelledEventSchema,
} as const;
