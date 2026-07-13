import type {
  ProjectMetadata,
  ProjectTemplate,
} from "@author-copilot/project-schema";

export type { ProjectMetadata, ProjectTemplate };

export interface RegisteredProject {
  readonly projectId: string;
  readonly rootPath: string;
  readonly metadata: ProjectMetadata;
  readonly registeredAt: string;
}

export interface ProjectDocument {
  readonly kind: "document";
  readonly name: string;
  readonly relativePath: string;
}

export interface ProjectStructureNode {
  readonly kind: "volume" | "chapter" | "act";
  readonly name: string;
  readonly relativePath: string;
  readonly children: readonly (ProjectStructureNode | ProjectDocument)[];
}

export interface ProjectStructure {
  readonly projectId: string;
  readonly template: ProjectTemplate;
  readonly nodes: readonly ProjectStructureNode[];
  readonly unclassified: readonly ProjectDocument[];
}

export interface ImportPreview {
  readonly rootPath: string;
  readonly template: ProjectTemplate;
  readonly metadata: ProjectMetadata;
  readonly metadataAction: "none" | "create" | "migrate";
  readonly duplicateRegistration?: RegisteredProject;
  readonly structure: Omit<ProjectStructure, "projectId">;
}

export type ConfirmImportOptions =
  | {
      readonly mode: "in-place";
      readonly rootPath: string;
      readonly template: ProjectTemplate;
      readonly reassignProjectId?: boolean;
    }
  | {
      readonly mode: "copy";
      readonly rootPath: string;
      readonly template: ProjectTemplate;
      readonly destinationParent: string;
      readonly title?: string;
    };

export interface ReadDocumentResult {
  readonly content: string;
  readonly hash: string;
  readonly mtimeMs: number;
  readonly mode: number;
}

export interface SaveDocumentResult {
  readonly hash: string;
  readonly mtimeMs: number;
}

export interface DocumentSavedEvent {
  readonly type: "document-saved";
  readonly projectId: string;
  readonly relativePath: string;
  readonly hash: string;
  readonly mtimeMs: number;
}

export type ProjectEventPublisher = (
  event: DocumentSavedEvent,
) => void | Promise<void>;
