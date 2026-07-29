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
  ProjectDeleteEntryRequestSchema,
  ProjectDeleteEntryResponseSchema,
  ProjectGetStructureRequestSchema,
  ProjectGetStructureResponseSchema,
  ProjectImportPreviewRequestSchema,
  ProjectImportPreviewResponseSchema,
  ProjectListRequestSchema,
  ProjectListResponseSchema,
  ProjectRenameEntryRequestSchema,
  ProjectRenameEntryResponseSchema,
  ProjectUpdateRequestSchema,
  ProjectUpdateResponseSchema,
} from "./project.js";
import { RuntimeInfoRequestSchema, RuntimeInfoSchema } from "./runtime.js";
import {
  ProjectChangedEventSchema,
  TabEndSessionRequestSchema,
  TabGetContextRequestSchema,
  TabGetStateRequestSchema,
  TabIdRequestSchema,
  TabLogoutRequestedEventSchema,
  TabOpenProjectRequestSchema,
  TabOperationResultSchema,
  TabReportDirtyRequestSchema,
  TabRequestLogoutRequestSchema,
  TabSetLocaleRequestSchema,
  TabStartSessionRequestSchema,
  TabStateChangedEventSchema,
  TabStateSchema,
  TabContextSchema,
} from "./tabs.js";
import {
  TaskCancelledEventSchema,
  TaskCancelRequestSchema,
  TaskCancelResultSchema,
  TaskProgressEventSchema,
} from "./tasks.js";
import {
  VersionCreateRequestSchema,
  VersionCreateResponseSchema,
  VersionDiffRequestSchema,
  VersionDiffResponseSchema,
  VersionListRequestSchema,
  VersionListResponseSchema,
} from "./version.js";

export const IPC_INVOKE_CHANNELS = {
  runtimeGetInfo: "app:get-runtime-info",
  projectCreate: "project:create",
  projectDeleteEntry: "project:delete-entry",
  projectUpdate: "project:update",
  projectPreviewImport: "project:preview-import",
  projectConfirmImport: "project:confirm-import",
  projectList: "project:list",
  projectGetStructure: "project:get-structure",
  projectRenameEntry: "project:rename-entry",
  documentRead: "document:read",
  documentSave: "document:save",
  versionCreate: "version:create",
  versionList: "version:list",
  versionDiff: "version:diff",
  knowledgeGetStatus: "knowledge:get-status",
  taskCancel: "task:cancel",
  tabGetContext: "tabs:get-context",
  tabGetState: "tabs:get-state",
  tabStartSession: "tabs:start-session",
  tabOpenProject: "tabs:open-project",
  tabActivate: "tabs:activate",
  tabClose: "tabs:close",
  tabEndSession: "tabs:end-session",
  tabReportDirty: "tabs:report-dirty",
  tabSetLocale: "tabs:set-locale",
  tabRequestLogout: "tabs:request-logout",
} as const;

export const IPC_EVENT_CHANNELS = {
  taskProgress: "task:progress",
  taskCancelled: "task:cancelled",
  tabStateChanged: "tabs:state-changed",
  tabLogoutRequested: "tabs:logout-requested",
  projectChanged: "project:changed",
} as const;

export const IPC_INVOKE_CHANNEL_NAMES = [
  IPC_INVOKE_CHANNELS.runtimeGetInfo,
  IPC_INVOKE_CHANNELS.projectCreate,
  IPC_INVOKE_CHANNELS.projectDeleteEntry,
  IPC_INVOKE_CHANNELS.projectUpdate,
  IPC_INVOKE_CHANNELS.projectPreviewImport,
  IPC_INVOKE_CHANNELS.projectConfirmImport,
  IPC_INVOKE_CHANNELS.projectList,
  IPC_INVOKE_CHANNELS.projectGetStructure,
  IPC_INVOKE_CHANNELS.projectRenameEntry,
  IPC_INVOKE_CHANNELS.documentRead,
  IPC_INVOKE_CHANNELS.documentSave,
  IPC_INVOKE_CHANNELS.versionCreate,
  IPC_INVOKE_CHANNELS.versionList,
  IPC_INVOKE_CHANNELS.versionDiff,
  IPC_INVOKE_CHANNELS.knowledgeGetStatus,
  IPC_INVOKE_CHANNELS.taskCancel,
  IPC_INVOKE_CHANNELS.tabGetContext,
  IPC_INVOKE_CHANNELS.tabGetState,
  IPC_INVOKE_CHANNELS.tabStartSession,
  IPC_INVOKE_CHANNELS.tabOpenProject,
  IPC_INVOKE_CHANNELS.tabActivate,
  IPC_INVOKE_CHANNELS.tabClose,
  IPC_INVOKE_CHANNELS.tabEndSession,
  IPC_INVOKE_CHANNELS.tabReportDirty,
  IPC_INVOKE_CHANNELS.tabSetLocale,
  IPC_INVOKE_CHANNELS.tabRequestLogout,
] as const;

export const IPC_EVENT_CHANNEL_NAMES = [
  IPC_EVENT_CHANNELS.taskProgress,
  IPC_EVENT_CHANNELS.taskCancelled,
  IPC_EVENT_CHANNELS.tabStateChanged,
  IPC_EVENT_CHANNELS.tabLogoutRequested,
  IPC_EVENT_CHANNELS.projectChanged,
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
  [IPC_INVOKE_CHANNELS.projectDeleteEntry]: {
    request: ProjectDeleteEntryRequestSchema,
    response: ProjectDeleteEntryResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.projectUpdate]: {
    request: ProjectUpdateRequestSchema,
    response: ProjectUpdateResponseSchema,
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
  [IPC_INVOKE_CHANNELS.projectRenameEntry]: {
    request: ProjectRenameEntryRequestSchema,
    response: ProjectRenameEntryResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.documentRead]: {
    request: DocumentReadRequestSchema,
    response: DocumentReadResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.documentSave]: {
    request: DocumentSaveRequestSchema,
    response: DocumentSaveResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.versionCreate]: {
    request: VersionCreateRequestSchema,
    response: VersionCreateResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.versionList]: {
    request: VersionListRequestSchema,
    response: VersionListResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.versionDiff]: {
    request: VersionDiffRequestSchema,
    response: VersionDiffResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.knowledgeGetStatus]: {
    request: KnowledgeIndexStatusRequestSchema,
    response: KnowledgeIndexStatusResultSchema,
  },
  [IPC_INVOKE_CHANNELS.taskCancel]: {
    request: TaskCancelRequestSchema,
    response: TaskCancelResultSchema,
  },
  [IPC_INVOKE_CHANNELS.tabGetContext]: {
    request: TabGetContextRequestSchema,
    response: TabContextSchema,
  },
  [IPC_INVOKE_CHANNELS.tabGetState]: {
    request: TabGetStateRequestSchema,
    response: TabStateSchema,
  },
  [IPC_INVOKE_CHANNELS.tabStartSession]: {
    request: TabStartSessionRequestSchema,
    response: TabStateSchema,
  },
  [IPC_INVOKE_CHANNELS.tabOpenProject]: {
    request: TabOpenProjectRequestSchema,
    response: TabStateSchema,
  },
  [IPC_INVOKE_CHANNELS.tabActivate]: {
    request: TabIdRequestSchema,
    response: TabStateSchema,
  },
  [IPC_INVOKE_CHANNELS.tabClose]: {
    request: TabIdRequestSchema,
    response: TabOperationResultSchema,
  },
  [IPC_INVOKE_CHANNELS.tabEndSession]: {
    request: TabEndSessionRequestSchema,
    response: TabOperationResultSchema,
  },
  [IPC_INVOKE_CHANNELS.tabReportDirty]: {
    request: TabReportDirtyRequestSchema,
    response: TabStateSchema,
  },
  [IPC_INVOKE_CHANNELS.tabSetLocale]: {
    request: TabSetLocaleRequestSchema,
    response: TabStateSchema,
  },
  [IPC_INVOKE_CHANNELS.tabRequestLogout]: {
    request: TabRequestLogoutRequestSchema,
    response: TabOperationResultSchema,
  },
} as const;

export const IPC_EVENT_CONTRACTS = {
  [IPC_EVENT_CHANNELS.taskProgress]: TaskProgressEventSchema,
  [IPC_EVENT_CHANNELS.taskCancelled]: TaskCancelledEventSchema,
  [IPC_EVENT_CHANNELS.tabStateChanged]: TabStateChangedEventSchema,
  [IPC_EVENT_CHANNELS.tabLogoutRequested]: TabLogoutRequestedEventSchema,
  [IPC_EVENT_CHANNELS.projectChanged]: ProjectChangedEventSchema,
} as const;
