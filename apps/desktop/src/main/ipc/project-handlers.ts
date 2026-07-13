import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import {
  DocumentReadRequestSchema,
  DocumentReadResponseSchema,
  DocumentSaveRequestSchema,
  DocumentSaveResponseSchema,
  IPC_INVOKE_CHANNELS,
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
  type ProjectImportRecognizedNode,
  type ProjectStructureNode as ProjectStructureNodeDto,
  type ProjectSummary,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { assertTrustedIpcRequest } from "../ipc-policy.js";
import type { ProjectDirectoryPicker } from "../project-dialogs.js";
import type {
  ProjectService,
  ProjectDocument,
  ProjectStructureNode,
  RegisteredProject,
} from "../project/index.js";
import {
  cancelledOperation,
  projectOperationFailure,
} from "./project-result.js";

interface PreviewEntry {
  readonly rootPath: string;
  readonly template: "novel" | "screenplay";
  readonly expiresAt: number;
}

export interface ProjectIpcOptions {
  readonly trustedRendererUrl: string;
  readonly projectService: ProjectService;
  readonly directoryPicker: ProjectDirectoryPicker;
}

function authorize(
  event: IpcMainInvokeEvent,
  channel: string,
  args: readonly unknown[],
  trustedRendererUrl: string,
): void {
  const senderFrame = event.senderFrame;
  assertTrustedIpcRequest({
    channel,
    senderFrameUrl: senderFrame?.url ?? "",
    mainFrameUrl: event.sender.mainFrame.url,
    trustedRendererUrl,
    isMainFrame: senderFrame !== null && senderFrame === event.sender.mainFrame,
    args,
    expectedArgumentCount: 1,
  });
}

function summary(project: RegisteredProject): ProjectSummary {
  return {
    projectId: project.projectId,
    title: project.metadata.title,
    template: project.metadata.template,
    rootDisplayName: basename(project.rootPath),
  };
}

function importNode(
  node: ProjectStructureNode | ProjectDocument,
): ProjectImportRecognizedNode {
  if (node.kind === "document") {
    return {
      role: "scene",
      displayName: node.name,
      relativePath: node.relativePath,
      children: [],
    };
  }
  return {
    role: node.kind,
    displayName: node.name,
    relativePath: node.relativePath,
    children: node.children.map(importNode),
  };
}

function structureNode(
  node: ProjectStructureNode | ProjectDocument,
): ProjectStructureNodeDto {
  if (node.kind === "document") {
    return {
      kind: "document",
      role: "scene",
      displayName: node.name,
      relativePath: node.relativePath,
      children: [],
    };
  }
  return {
    kind: "directory",
    role: node.kind,
    displayName: node.name,
    relativePath: node.relativePath,
    children: node.children.map(structureNode),
  };
}

export function registerProjectIpcHandlers(options: ProjectIpcOptions): void {
  const previews = new Map<string, PreviewEntry>();

  const getPreview = (token: string): PreviewEntry | undefined => {
    const preview = previews.get(token);
    if (preview !== undefined && preview.expiresAt <= Date.now()) {
      previews.delete(token);
      return undefined;
    }
    return preview;
  };

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.projectCreate,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.projectCreate,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = ProjectCreateRequestSchema.parse(args[0]);
        const parentPath = await options.directoryPicker.chooseCreateParent();
        if (parentPath === undefined) {
          return ProjectCreateResponseSchema.parse(cancelledOperation());
        }
        const project = await options.projectService.createProject(
          parentPath,
          request.title,
          request.template,
        );
        return ProjectCreateResponseSchema.parse({
          ok: true,
          project: summary(project),
        });
      } catch (error) {
        return ProjectCreateResponseSchema.parse(
          projectOperationFailure(error),
        );
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.projectPreviewImport,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.projectPreviewImport,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = ProjectImportPreviewRequestSchema.parse(args[0]);
        const rootPath = await options.directoryPicker.chooseImportSource();
        if (rootPath === undefined) {
          return ProjectImportPreviewResponseSchema.parse(cancelledOperation());
        }
        const preview = await options.projectService.previewImport(
          rootPath,
          request.template,
        );
        const previewToken = randomUUID();
        previews.set(previewToken, {
          rootPath: preview.rootPath,
          template: preview.template,
          expiresAt: Date.now() + 15 * 60_000,
        });
        return ProjectImportPreviewResponseSchema.parse({
          ok: true,
          previewToken,
          sourceRoot: { displayName: basename(preview.rootPath) },
          template: preview.template,
          recognizedTree: preview.structure.nodes.map(importNode),
          unclassifiedFiles: preview.structure.unclassified.map((document) => ({
            displayName: document.name,
            relativePath: document.relativePath,
          })),
        });
      } catch (error) {
        return ProjectImportPreviewResponseSchema.parse(
          projectOperationFailure(error),
        );
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.projectConfirmImport,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.projectConfirmImport,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = ProjectConfirmImportRequestSchema.parse(args[0]);
        const preview = getPreview(request.previewToken);
        if (preview === undefined) {
          return ProjectConfirmImportResponseSchema.parse({
            ok: false,
            error: {
              code: "not_found",
              message: "The import preview expired. Preview the folder again.",
              retryable: true,
            },
          });
        }
        const project =
          request.mode === "copy"
            ? await (async () => {
                const destinationParent =
                  await options.directoryPicker.chooseCopyDestination();
                if (destinationParent === undefined) return undefined;
                return options.projectService.confirmImport({
                  mode: "copy",
                  rootPath: preview.rootPath,
                  template: preview.template,
                  destinationParent,
                });
              })()
            : await options.projectService.confirmImport({
                mode: "in-place",
                rootPath: preview.rootPath,
                template: preview.template,
                ...(request.reassignProjectId === undefined
                  ? {}
                  : { reassignProjectId: request.reassignProjectId }),
              });
        if (project === undefined) {
          return ProjectConfirmImportResponseSchema.parse(cancelledOperation());
        }
        previews.delete(request.previewToken);
        return ProjectConfirmImportResponseSchema.parse({
          ok: true,
          project: summary(project),
        });
      } catch (error) {
        return ProjectConfirmImportResponseSchema.parse(
          projectOperationFailure(error),
        );
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.projectList,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.projectList,
        args,
        options.trustedRendererUrl,
      );
      try {
        ProjectListRequestSchema.parse(args[0]);
        return ProjectListResponseSchema.parse({
          ok: true,
          projects: (await options.projectService.list()).map(summary),
        });
      } catch (error) {
        return ProjectListResponseSchema.parse(projectOperationFailure(error));
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.projectGetStructure,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.projectGetStructure,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = ProjectGetStructureRequestSchema.parse(args[0]);
        const structure = await options.projectService.getStructure(
          request.projectId,
        );
        const nodes = structure.nodes.map(structureNode);
        if (structure.unclassified.length > 0) {
          nodes.push({
            kind: "directory",
            role: "unclassified",
            displayName: "Unclassified",
            relativePath: "__unclassified__",
            children: structure.unclassified.map(structureNode),
          });
        }
        return ProjectGetStructureResponseSchema.parse({
          ok: true,
          projectId: request.projectId,
          nodes,
        });
      } catch (error) {
        return ProjectGetStructureResponseSchema.parse(
          projectOperationFailure(error),
        );
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.documentRead,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.documentRead,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = DocumentReadRequestSchema.parse(args[0]);
        const document = await options.projectService.readDocument(
          request.projectId,
          request.relativePath,
        );
        return DocumentReadResponseSchema.parse({
          ok: true,
          relativePath: request.relativePath,
          content: document.content,
          contentHash: document.hash,
          mtimeMs: document.mtimeMs,
        });
      } catch (error) {
        return DocumentReadResponseSchema.parse(projectOperationFailure(error));
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.documentSave,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.documentSave,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = DocumentSaveRequestSchema.parse(args[0]);
        const saved = await options.projectService.saveDocument(
          request.projectId,
          request.relativePath,
          request.content,
          request.expectedHash,
        );
        return DocumentSaveResponseSchema.parse({
          ok: true,
          contentHash: saved.hash,
          mtimeMs: saved.mtimeMs,
        });
      } catch (error) {
        return DocumentSaveResponseSchema.parse(projectOperationFailure(error));
      }
    },
  );
}
