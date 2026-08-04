import type {
  AnthropicCredentialResponse,
  AnthropicCredentialSetRequest,
  DocumentReadRequest,
  DocumentReadResponse,
  DocumentSaveRequest,
  DocumentSaveResponse,
  KnowledgeIndexStatusRequest,
  KnowledgeIndexTaskRequest,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
  KnowledgeStatusResponse,
  KnowledgeTaskStartResponse,
  ProjectConfirmImportRequest,
  ProjectConfirmImportResponse,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectDeleteEntryRequest,
  ProjectDeleteEntryResponse,
  ProjectGetStructureRequest,
  ProjectGetStructureResponse,
  ProjectImportPreviewRequest,
  ProjectImportPreviewResponse,
  ProjectListResponse,
  ProjectRenameEntryRequest,
  ProjectRenameEntryResponse,
  ProjectUpdateRequest,
  ProjectUpdateResponse,
  RuntimeInfo,
  ProjectSummary,
  TabContext,
  TabOperationResult,
  TabState,
  TaskCancelRequest,
  TaskCancelResult,
  TaskCancelledEvent,
  TaskProgressEvent,
  TaskRecoveryListRequest,
  TaskRecoveryListResponse,
  TaskRecoveryRestoreRequest,
  TaskRecoveryRestoreResponse,
  VersionBranchListRequest,
  VersionBranchListResponse,
  VersionBranchSwitchRequest,
  VersionBranchSwitchResponse,
  VersionCreateRequest,
  VersionCreateResponse,
  VersionDiffRequest,
  VersionDiffResponse,
  VersionListRequest,
  VersionListResponse,
} from "@author-copilot/contracts";

export interface AuthorCopilotApi {
  readonly system: {
    readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
  };
  readonly credentials: {
    readonly anthropic: {
      readonly getStatus: () => Promise<AnthropicCredentialResponse>;
      readonly set: (
        request: AnthropicCredentialSetRequest,
      ) => Promise<AnthropicCredentialResponse>;
      readonly delete: () => Promise<AnthropicCredentialResponse>;
    };
  };
  readonly project: {
    readonly create: (
      request: ProjectCreateRequest,
    ) => Promise<ProjectCreateResponse>;
    readonly deleteEntry: (
      request: ProjectDeleteEntryRequest,
    ) => Promise<ProjectDeleteEntryResponse>;
    readonly update: (
      request: ProjectUpdateRequest,
    ) => Promise<ProjectUpdateResponse>;
    readonly previewImport: (
      request: ProjectImportPreviewRequest,
    ) => Promise<ProjectImportPreviewResponse>;
    readonly confirmImport: (
      request: ProjectConfirmImportRequest,
    ) => Promise<ProjectConfirmImportResponse>;
    readonly list: () => Promise<ProjectListResponse>;
    readonly getStructure: (
      request: ProjectGetStructureRequest,
    ) => Promise<ProjectGetStructureResponse>;
    readonly renameEntry: (
      request: ProjectRenameEntryRequest,
    ) => Promise<ProjectRenameEntryResponse>;
    readonly readDocument: (
      request: DocumentReadRequest,
    ) => Promise<DocumentReadResponse>;
    readonly saveDocument: (
      request: DocumentSaveRequest,
    ) => Promise<DocumentSaveResponse>;
  };
  readonly version: {
    readonly create: (
      request: VersionCreateRequest,
    ) => Promise<VersionCreateResponse>;
    readonly list: (
      request: VersionListRequest,
    ) => Promise<VersionListResponse>;
    readonly diff: (
      request: VersionDiffRequest,
    ) => Promise<VersionDiffResponse>;
    readonly listBranches: (
      request: VersionBranchListRequest,
    ) => Promise<VersionBranchListResponse>;
    readonly switchBranch: (
      request: VersionBranchSwitchRequest,
    ) => Promise<VersionBranchSwitchResponse>;
  };
  readonly knowledge: {
    readonly getStatus: (
      request: KnowledgeIndexStatusRequest,
    ) => Promise<KnowledgeStatusResponse>;
    readonly initialize: (
      request: KnowledgeIndexTaskRequest,
    ) => Promise<KnowledgeTaskStartResponse>;
    readonly rebuild: (
      request: KnowledgeIndexTaskRequest,
    ) => Promise<KnowledgeTaskStartResponse>;
    readonly search: (
      request: KnowledgeSearchRequest,
    ) => Promise<KnowledgeSearchResponse>;
    readonly cancel: (request: TaskCancelRequest) => Promise<TaskCancelResult>;
    readonly onProgress: (
      listener: (event: TaskProgressEvent) => void,
    ) => () => void;
    readonly onCancelled: (
      listener: (event: TaskCancelledEvent) => void,
    ) => () => void;
  };
  readonly taskRecovery: {
    readonly list: (
      request: TaskRecoveryListRequest,
    ) => Promise<TaskRecoveryListResponse>;
    readonly restore: (
      request: TaskRecoveryRestoreRequest,
    ) => Promise<TaskRecoveryRestoreResponse>;
  };
  readonly tabs: {
    readonly getContext: () => Promise<TabContext>;
    readonly getState: () => Promise<TabState>;
    readonly startSession: () => Promise<TabState>;
    readonly openProject: (projectId: string) => Promise<TabState>;
    readonly activate: (tabId: string) => Promise<TabState>;
    readonly close: (tabId: string) => Promise<TabOperationResult>;
    readonly endSession: () => Promise<TabOperationResult>;
    readonly reportDirty: (dirty: boolean) => Promise<TabState>;
    readonly setLocale: (locale: "en-US" | "zh-CN") => Promise<TabState>;
    readonly requestLogout: () => Promise<TabOperationResult>;
    readonly onStateChanged: (
      listener: (state: TabState) => void,
    ) => () => void;
    readonly onLogoutRequested: (listener: () => void) => () => void;
    readonly onProjectChanged: (
      listener: (project: ProjectSummary) => void,
    ) => () => void;
  };
}
