import { z } from "zod";
import {
  AnthropicCredentialDeleteRequestSchema,
  AnthropicCredentialResponseSchema,
  AnthropicCredentialSetRequestSchema,
  AnthropicCredentialStatusRequestSchema,
} from "./ai-credentials.js";
import {
  AiChatCancelRequestSchema,
  AiChatCancelResponseSchema,
  AiChatEventSchema,
  AiChatStartRequestSchema,
  AiChatStartResponseSchema,
} from "./ai-chat.js";

import {
  KnowledgeIndexStatusRequestSchema,
  KnowledgeSearchRequestSchema,
  KnowledgeSearchResponseSchema,
  KnowledgeStatusResponseSchema,
  KnowledgeTaskStartResponseSchema,
  KnowledgeIndexTaskRequestSchema,
} from "./index-status.js";
import {
  TaskRecoveryListRequestSchema,
  TaskRecoveryListResponseSchema,
  TaskRecoveryRestoreRequestSchema,
  TaskRecoveryRestoreResponseSchema,
} from "./task-recovery.js";
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
  VersionBranchListRequestSchema,
  VersionBranchListResponseSchema,
  VersionBranchSwitchRequestSchema,
  VersionBranchSwitchResponseSchema,
  VersionCreateRequestSchema,
  VersionCreateResponseSchema,
  VersionDiffRequestSchema,
  VersionDiffResponseSchema,
  VersionListRequestSchema,
  VersionListResponseSchema,
} from "./version.js";

export const IPC_INVOKE_CHANNELS = {
  runtimeGetInfo: "app:get-runtime-info",
  anthropicCredentialGetStatus: "ai-credential:anthropic-status",
  anthropicCredentialSet: "ai-credential:anthropic-set",
  anthropicCredentialDelete: "ai-credential:anthropic-delete",
  aiChatStart: "ai-chat:start",
  aiChatCancel: "ai-chat:cancel",
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
  versionBranchList: "version:branch-list",
  versionBranchSwitch: "version:branch-switch",
  taskRecoveryList: "task-recovery:list",
  taskRecoveryRestore: "task-recovery:restore",
  knowledgeGetStatus: "knowledge:get-status",
  knowledgeInitialize: "knowledge:initialize",
  knowledgeRebuild: "knowledge:rebuild",
  knowledgeSearch: "knowledge:search",
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
  aiChatEvent: "ai-chat:event",
  taskProgress: "task:progress",
  taskCancelled: "task:cancelled",
  tabStateChanged: "tabs:state-changed",
  tabLogoutRequested: "tabs:logout-requested",
  projectChanged: "project:changed",
} as const;

export const IPC_INVOKE_CHANNEL_NAMES = [
  IPC_INVOKE_CHANNELS.runtimeGetInfo,
  IPC_INVOKE_CHANNELS.anthropicCredentialGetStatus,
  IPC_INVOKE_CHANNELS.anthropicCredentialSet,
  IPC_INVOKE_CHANNELS.anthropicCredentialDelete,
  IPC_INVOKE_CHANNELS.aiChatStart,
  IPC_INVOKE_CHANNELS.aiChatCancel,
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
  IPC_INVOKE_CHANNELS.versionBranchList,
  IPC_INVOKE_CHANNELS.versionBranchSwitch,
  IPC_INVOKE_CHANNELS.taskRecoveryList,
  IPC_INVOKE_CHANNELS.taskRecoveryRestore,
  IPC_INVOKE_CHANNELS.knowledgeGetStatus,
  IPC_INVOKE_CHANNELS.knowledgeInitialize,
  IPC_INVOKE_CHANNELS.knowledgeRebuild,
  IPC_INVOKE_CHANNELS.knowledgeSearch,
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
  IPC_EVENT_CHANNELS.aiChatEvent,
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

export const IPC_INVOKE_CONTRACTS = {
  [IPC_INVOKE_CHANNELS.runtimeGetInfo]: {
    request: RuntimeInfoRequestSchema,
    response: RuntimeInfoSchema,
  },
  [IPC_INVOKE_CHANNELS.anthropicCredentialGetStatus]: {
    request: AnthropicCredentialStatusRequestSchema,
    response: AnthropicCredentialResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.anthropicCredentialSet]: {
    request: AnthropicCredentialSetRequestSchema,
    response: AnthropicCredentialResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.anthropicCredentialDelete]: {
    request: AnthropicCredentialDeleteRequestSchema,
    response: AnthropicCredentialResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.aiChatStart]: {
    request: AiChatStartRequestSchema,
    response: AiChatStartResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.aiChatCancel]: {
    request: AiChatCancelRequestSchema,
    response: AiChatCancelResponseSchema,
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
  [IPC_INVOKE_CHANNELS.versionBranchList]: {
    request: VersionBranchListRequestSchema,
    response: VersionBranchListResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.versionBranchSwitch]: {
    request: VersionBranchSwitchRequestSchema,
    response: VersionBranchSwitchResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.taskRecoveryList]: {
    request: TaskRecoveryListRequestSchema,
    response: TaskRecoveryListResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.taskRecoveryRestore]: {
    request: TaskRecoveryRestoreRequestSchema,
    response: TaskRecoveryRestoreResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.knowledgeGetStatus]: {
    request: KnowledgeIndexStatusRequestSchema,
    response: KnowledgeStatusResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.knowledgeInitialize]: {
    request: KnowledgeIndexTaskRequestSchema,
    response: KnowledgeTaskStartResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.knowledgeRebuild]: {
    request: KnowledgeIndexTaskRequestSchema,
    response: KnowledgeTaskStartResponseSchema,
  },
  [IPC_INVOKE_CHANNELS.knowledgeSearch]: {
    request: KnowledgeSearchRequestSchema,
    response: KnowledgeSearchResponseSchema,
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
  [IPC_EVENT_CHANNELS.aiChatEvent]: AiChatEventSchema,
  [IPC_EVENT_CHANNELS.taskProgress]: TaskProgressEventSchema,
  [IPC_EVENT_CHANNELS.taskCancelled]: TaskCancelledEventSchema,
  [IPC_EVENT_CHANNELS.tabStateChanged]: TabStateChangedEventSchema,
  [IPC_EVENT_CHANNELS.tabLogoutRequested]: TabLogoutRequestedEventSchema,
  [IPC_EVENT_CHANNELS.projectChanged]: ProjectChangedEventSchema,
} as const;
