import type {
  DocumentReadResponse,
  DocumentSaveResponse,
  ProjectConfirmImportRequest,
  ProjectConfirmImportResponse,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectDeleteEntryRequest,
  ProjectDeleteEntryResponse,
  ProjectGetStructureResponse,
  ProjectImportPreviewRequest,
  ProjectImportRecognizedNode,
  ProjectImportPreviewResponse,
  ProjectListResponse,
  ProjectOperationFailure,
  ProjectRenameEntryRequest,
  ProjectRenameEntryResponse,
  ProjectStructureNode,
  ProjectUpdateRequest,
  ProjectUpdateResponse,
} from "@author-copilot/contracts";

import {
  ProjectApiError,
  type ImportPreview,
  type ProjectBridge,
  type ProjectSummary,
  type StructureNode,
} from "./types.js";

interface ProjectWindowApi {
  readonly project?: {
    readonly confirmImport: (
      input: ProjectConfirmImportRequest,
    ) => Promise<ProjectConfirmImportResponse>;
    readonly create: (
      input: ProjectCreateRequest,
    ) => Promise<ProjectCreateResponse>;
    readonly deleteEntry: (
      input: ProjectDeleteEntryRequest,
    ) => Promise<ProjectDeleteEntryResponse>;
    readonly update: (
      input: ProjectUpdateRequest,
    ) => Promise<ProjectUpdateResponse>;
    readonly getStructure: (input: {
      readonly projectId: string;
    }) => Promise<ProjectGetStructureResponse>;
    readonly list: () => Promise<ProjectListResponse>;
    readonly previewImport: (
      input: ProjectImportPreviewRequest,
    ) => Promise<ProjectImportPreviewResponse>;
    readonly readDocument: (input: {
      readonly projectId: string;
      readonly relativePath: string;
    }) => Promise<DocumentReadResponse>;
    readonly renameEntry: (
      input: ProjectRenameEntryRequest,
    ) => Promise<ProjectRenameEntryResponse>;
    readonly saveDocument: (input: {
      readonly content: string;
      readonly expectedHash: string;
      readonly projectId: string;
      readonly relativePath: string;
    }) => Promise<DocumentSaveResponse>;
  };
}

export function getProjectApi(): ProjectBridge | undefined {
  const raw = (window.authorCopilot as unknown as ProjectWindowApi).project;
  if (raw === undefined) return undefined;

  return {
    async confirmImport(input) {
      const response = await raw.confirmImport(input);
      return mapProject(unwrap(response).project);
    },
    async create(input) {
      const response = await raw.create({
        title: input.name,
        template: input.type,
      });
      return mapProject(unwrap(response).project);
    },
    async deleteEntry(input) {
      unwrap(
        await raw.deleteEntry({
          projectId: input.projectId,
          relativePath: input.path,
        }),
      );
    },
    async update(input) {
      const response = await raw.update(input);
      return mapProject(unwrap(response).project);
    },
    async getStructure(input) {
      const response = unwrap(await raw.getStructure(input));
      return response.nodes.map(mapStructureNode);
    },
    async list() {
      const response = unwrap(await raw.list());
      return response.projects.map(mapProject);
    },
    async previewImport(type) {
      const response = await raw.previewImport({ template: type });
      if (!response.ok && response.error.code === "cancelled") return null;
      const preview = unwrap(response);
      return mapPreview(preview);
    },
    async readDocument(input) {
      const response = unwrap(
        await raw.readDocument({
          projectId: input.projectId,
          relativePath: input.path,
        }),
      );
      return {
        content: response.content,
        path: response.relativePath,
        version: response.contentHash,
      };
    },
    async renameEntry(input) {
      const response = unwrap(
        await raw.renameEntry({
          name: input.name,
          projectId: input.projectId,
          relativePath: input.path,
        }),
      );
      return {
        path: response.relativePath,
        previousPath: response.previousRelativePath,
      };
    },
    async saveDocument(input) {
      const response = unwrap(
        await raw.saveDocument({
          content: input.content,
          expectedHash: input.expectedVersion,
          projectId: input.projectId,
          relativePath: input.path,
        }),
      );
      return {
        content: input.content,
        path: input.path,
        version: response.contentHash,
      };
    },
  };
}

function unwrap<T extends { readonly ok: boolean }>(
  response: T,
): Extract<T, { readonly ok: true }> {
  if (!response.ok) {
    const { error } = response as unknown as ProjectOperationFailure;
    throw new ProjectApiError(error.code, error.message);
  }
  return response as Extract<T, { readonly ok: true }>;
}

function mapProject(project: {
  readonly projectId: string;
  readonly rootDisplayName: string;
  readonly template: "novel" | "screenplay";
  readonly title: string;
}): ProjectSummary {
  return {
    id: project.projectId,
    name: project.title,
    rootDisplayName: project.rootDisplayName,
    type: project.template,
  };
}

function mapStructureNode(node: ProjectStructureNode): StructureNode {
  return {
    children: node.children.map(mapStructureNode),
    id: node.relativePath,
    kind: node.kind === "document" ? "document" : "group",
    name: node.displayName,
    role: node.role,
    path: node.relativePath,
  };
}

function countRecognized(
  nodes: readonly { readonly children: readonly unknown[] }[],
): number {
  return nodes.reduce(
    (count, node) =>
      count +
      1 +
      countRecognized(
        node.children as readonly { readonly children: readonly unknown[] }[],
      ),
    0,
  );
}

function mapPreview(
  preview: Extract<ProjectImportPreviewResponse, { readonly ok: true }>,
): ImportPreview {
  return {
    fileCount:
      countRecognized(preview.recognizedTree) +
      preview.unclassifiedFiles.length,
    name: preview.sourceRoot.displayName,
    previewToken: preview.previewToken,
    structure: preview.recognizedTree.map(mapImportNode),
    type: preview.template,
    unclassified: preview.unclassifiedFiles.map(
      ({ displayName }) => displayName,
    ),
  };
}

function mapImportNode(node: ProjectImportRecognizedNode): {
  readonly children: readonly ReturnType<typeof mapImportNode>[];
  readonly name: string;
} {
  return {
    name: node.displayName,
    children: node.children.map(mapImportNode),
  };
}

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error;
    if (typeof message === "string" && message.trim().length > 0)
      return message;
  }
  return fallback;
}
