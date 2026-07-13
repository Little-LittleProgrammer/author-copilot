import {
  DocumentReadResponseSchema,
  DocumentSaveResponseSchema,
  IPC_INVOKE_CHANNELS,
  ProjectConfirmImportResponseSchema,
  ProjectCreateResponseSchema,
  ProjectGetStructureResponseSchema,
  ProjectImportPreviewResponseSchema,
  ProjectListResponseSchema,
  RuntimeInfoSchema,
  type DocumentReadRequest,
  type DocumentSaveRequest,
  type ProjectConfirmImportRequest,
  type ProjectCreateRequest,
  type ProjectGetStructureRequest,
  type ProjectImportPreviewRequest,
} from "@author-copilot/contracts";
import { contextBridge, ipcRenderer } from "electron";

import type { AuthorCopilotApi } from "../shared/desktop-api.js";

export type { AuthorCopilotApi } from "../shared/desktop-api.js";

const api: AuthorCopilotApi = Object.freeze({
  system: Object.freeze({
    getRuntimeInfo: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.runtimeGetInfo,
      );
      return RuntimeInfoSchema.parse(response);
    },
  }),
  project: Object.freeze({
    create: async (request: ProjectCreateRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.projectCreate,
        request,
      );
      return ProjectCreateResponseSchema.parse(response);
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
});

contextBridge.exposeInMainWorld("authorCopilot", api);
