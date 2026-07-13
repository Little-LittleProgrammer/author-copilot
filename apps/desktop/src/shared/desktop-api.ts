import type {
  DocumentReadRequest,
  DocumentReadResponse,
  DocumentSaveRequest,
  DocumentSaveResponse,
  ProjectConfirmImportRequest,
  ProjectConfirmImportResponse,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectGetStructureRequest,
  ProjectGetStructureResponse,
  ProjectImportPreviewRequest,
  ProjectImportPreviewResponse,
  ProjectListResponse,
  RuntimeInfo,
} from "@author-copilot/contracts";

export interface AuthorCopilotApi {
  readonly system: {
    readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
  };
  readonly project: {
    readonly create: (
      request: ProjectCreateRequest,
    ) => Promise<ProjectCreateResponse>;
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
    readonly readDocument: (
      request: DocumentReadRequest,
    ) => Promise<DocumentReadResponse>;
    readonly saveDocument: (
      request: DocumentSaveRequest,
    ) => Promise<DocumentSaveResponse>;
  };
}
