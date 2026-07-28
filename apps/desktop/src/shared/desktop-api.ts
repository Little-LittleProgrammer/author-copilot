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
  VersionCreateRequest,
  VersionCreateResponse,
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
  };
}
