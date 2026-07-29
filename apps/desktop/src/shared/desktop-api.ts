import type {
  DocumentReadRequest,
  DocumentReadResponse,
  DocumentSaveRequest,
  DocumentSaveResponse,
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
