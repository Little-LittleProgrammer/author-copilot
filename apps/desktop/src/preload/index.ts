import {
  AnthropicCredentialResponseSchema,
  DocumentReadResponseSchema,
  DocumentSaveResponseSchema,
  IPC_INVOKE_CHANNELS,
  KnowledgeSearchResponseSchema,
  KnowledgeStatusResponseSchema,
  KnowledgeTaskStartResponseSchema,
  ProjectConfirmImportResponseSchema,
  ProjectCreateResponseSchema,
  ProjectDeleteEntryResponseSchema,
  ProjectGetStructureResponseSchema,
  ProjectImportPreviewResponseSchema,
  ProjectListResponseSchema,
  ProjectRenameEntryResponseSchema,
  ProjectUpdateResponseSchema,
  RuntimeInfoSchema,
  IPC_EVENT_CHANNELS,
  ProjectChangedEventSchema,
  TabContextSchema,
  TabOperationResultSchema,
  TabStateSchema,
  TaskCancelResultSchema,
  TaskCancelledEventSchema,
  TaskProgressEventSchema,
  TaskRecoveryListResponseSchema,
  TaskRecoveryRestoreResponseSchema,
  VersionBranchListResponseSchema,
  VersionBranchSwitchResponseSchema,
  VersionCreateResponseSchema,
  VersionDiffResponseSchema,
  VersionListResponseSchema,
  type AnthropicCredentialSetRequest,
  type DocumentReadRequest,
  type DocumentSaveRequest,
  type KnowledgeIndexStatusRequest,
  type KnowledgeIndexTaskRequest,
  type KnowledgeSearchRequest,
  type ProjectConfirmImportRequest,
  type ProjectCreateRequest,
  type ProjectDeleteEntryRequest,
  type ProjectGetStructureRequest,
  type ProjectImportPreviewRequest,
  type ProjectRenameEntryRequest,
  type ProjectSummary,
  type ProjectUpdateRequest,
  type TabState,
  type TaskCancelRequest,
  type TaskCancelledEvent,
  type TaskProgressEvent,
  type TaskRecoveryListRequest,
  type TaskRecoveryRestoreRequest,
  type VersionBranchListRequest,
  type VersionBranchSwitchRequest,
  type VersionCreateRequest,
  type VersionDiffRequest,
  type VersionListRequest,
} from "@author-copilot/contracts";
import { contextBridge, ipcRenderer } from "electron";

import type { AuthorCopilotApi } from "../shared/desktop-api.js";

export type { AuthorCopilotApi } from "../shared/desktop-api.js";

function subscribe<T>(
  channel: string,
  parse: (value: unknown) => T,
  listener: (value: T) => void,
): () => void {
  const wrapped = (
    _event: Electron.IpcRendererEvent,
    payload: unknown,
  ): void => {
    listener(parse(payload));
  };
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: AuthorCopilotApi = Object.freeze({
  system: Object.freeze({
    getRuntimeInfo: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.runtimeGetInfo,
      );
      return RuntimeInfoSchema.parse(response);
    },
  }),
  credentials: Object.freeze({
    anthropic: Object.freeze({
      getStatus: async () => {
        const response: unknown = await ipcRenderer.invoke(
          IPC_INVOKE_CHANNELS.anthropicCredentialGetStatus,
          {},
        );
        return AnthropicCredentialResponseSchema.parse(response);
      },
      set: async (request: AnthropicCredentialSetRequest) => {
        const response: unknown = await ipcRenderer.invoke(
          IPC_INVOKE_CHANNELS.anthropicCredentialSet,
          request,
        );
        return AnthropicCredentialResponseSchema.parse(response);
      },
      delete: async () => {
        const response: unknown = await ipcRenderer.invoke(
          IPC_INVOKE_CHANNELS.anthropicCredentialDelete,
          {},
        );
        return AnthropicCredentialResponseSchema.parse(response);
      },
    }),
  }),
  project: Object.freeze({
    create: async (request: ProjectCreateRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.projectCreate,
        request,
      );
      return ProjectCreateResponseSchema.parse(response);
    },
    deleteEntry: async (request: ProjectDeleteEntryRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.projectDeleteEntry,
        request,
      );
      return ProjectDeleteEntryResponseSchema.parse(response);
    },
    update: async (request: ProjectUpdateRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.projectUpdate,
        request,
      );
      return ProjectUpdateResponseSchema.parse(response);
    },
    previewImport: async (request: ProjectImportPreviewRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.projectPreviewImport,
        request,
      );
      return ProjectImportPreviewResponseSchema.parse(response);
    },
    confirmImport: async (request: ProjectConfirmImportRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.projectConfirmImport,
        request,
      );
      return ProjectConfirmImportResponseSchema.parse(response);
    },
    list: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.projectList,
        {},
      );
      return ProjectListResponseSchema.parse(response);
    },
    getStructure: async (request: ProjectGetStructureRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.projectGetStructure,
        request,
      );
      return ProjectGetStructureResponseSchema.parse(response);
    },
    renameEntry: async (request: ProjectRenameEntryRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.projectRenameEntry,
        request,
      );
      return ProjectRenameEntryResponseSchema.parse(response);
    },
    readDocument: async (request: DocumentReadRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.documentRead,
        request,
      );
      return DocumentReadResponseSchema.parse(response);
    },
    saveDocument: async (request: DocumentSaveRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.documentSave,
        request,
      );
      return DocumentSaveResponseSchema.parse(response);
    },
  }),
  version: Object.freeze({
    create: async (request: VersionCreateRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.versionCreate,
        request,
      );
      return VersionCreateResponseSchema.parse(response);
    },
    list: async (request: VersionListRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.versionList,
        request,
      );
      return VersionListResponseSchema.parse(response);
    },
    diff: async (request: VersionDiffRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.versionDiff,
        request,
      );
      return VersionDiffResponseSchema.parse(response);
    },
    listBranches: async (request: VersionBranchListRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.versionBranchList,
        request,
      );
      return VersionBranchListResponseSchema.parse(response);
    },
    switchBranch: async (request: VersionBranchSwitchRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.versionBranchSwitch,
        request,
      );
      return VersionBranchSwitchResponseSchema.parse(response);
    },
  }),
  knowledge: Object.freeze({
    getStatus: async (request: KnowledgeIndexStatusRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.knowledgeGetStatus,
        request,
      );
      return KnowledgeStatusResponseSchema.parse(response);
    },
    initialize: async (request: KnowledgeIndexTaskRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.knowledgeInitialize,
        request,
      );
      return KnowledgeTaskStartResponseSchema.parse(response);
    },
    rebuild: async (request: KnowledgeIndexTaskRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.knowledgeRebuild,
        request,
      );
      return KnowledgeTaskStartResponseSchema.parse(response);
    },
    search: async (request: KnowledgeSearchRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.knowledgeSearch,
        request,
      );
      return KnowledgeSearchResponseSchema.parse(response);
    },
    cancel: async (request: TaskCancelRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.taskCancel,
        request,
      );
      return TaskCancelResultSchema.parse(response);
    },
    onProgress: (listener: (event: TaskProgressEvent) => void) =>
      subscribe(
        IPC_EVENT_CHANNELS.taskProgress,
        (value) => TaskProgressEventSchema.parse(value),
        listener,
      ),
    onCancelled: (listener: (event: TaskCancelledEvent) => void) =>
      subscribe(
        IPC_EVENT_CHANNELS.taskCancelled,
        (value) => TaskCancelledEventSchema.parse(value),
        listener,
      ),
  }),
  taskRecovery: Object.freeze({
    list: async (request: TaskRecoveryListRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.taskRecoveryList,
        request,
      );
      return TaskRecoveryListResponseSchema.parse(response);
    },
    restore: async (request: TaskRecoveryRestoreRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.taskRecoveryRestore,
        request,
      );
      return TaskRecoveryRestoreResponseSchema.parse(response);
    },
  }),
  tabs: Object.freeze({
    getContext: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabGetContext,
        {},
      );
      return TabContextSchema.parse(response);
    },
    getState: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabGetState,
        {},
      );
      return TabStateSchema.parse(response);
    },
    startSession: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabStartSession,
        {},
      );
      return TabStateSchema.parse(response);
    },
    openProject: async (projectId: string) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabOpenProject,
        { projectId },
      );
      return TabStateSchema.parse(response);
    },
    activate: async (tabId: string) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabActivate,
        { tabId },
      );
      return TabStateSchema.parse(response);
    },
    close: async (tabId: string) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabClose,
        { tabId },
      );
      return TabOperationResultSchema.parse(response);
    },
    endSession: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabEndSession,
        {},
      );
      return TabOperationResultSchema.parse(response);
    },
    reportDirty: async (dirty: boolean) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabReportDirty,
        { dirty },
      );
      return TabStateSchema.parse(response);
    },
    setLocale: async (locale: "en-US" | "zh-CN") => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabSetLocale,
        { locale },
      );
      return TabStateSchema.parse(response);
    },
    requestLogout: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.tabRequestLogout,
        {},
      );
      return TabOperationResultSchema.parse(response);
    },
    onStateChanged: (listener: (state: TabState) => void) =>
      subscribe(
        IPC_EVENT_CHANNELS.tabStateChanged,
        (value) => TabStateSchema.parse(value),
        listener,
      ),
    onLogoutRequested: (listener: () => void) =>
      subscribe(
        IPC_EVENT_CHANNELS.tabLogoutRequested,
        () => undefined,
        listener,
      ),
    onProjectChanged: (listener: (project: ProjectSummary) => void) =>
      subscribe(
        IPC_EVENT_CHANNELS.projectChanged,
        (value) => ProjectChangedEventSchema.parse(value),
        listener,
      ),
  }),
});

contextBridge.exposeInMainWorld("authorCopilot", api);
