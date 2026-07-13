export type ProjectType = "novel" | "screenplay";

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly rootDisplayName: string;
  readonly type: ProjectType;
}

export interface StructureNode {
  readonly children?: readonly StructureNode[];
  readonly id: string;
  readonly kind: "document" | "group";
  readonly name: string;
  readonly path?: string;
}

export interface DocumentSnapshot {
  readonly content: string;
  readonly path: string;
  readonly version: string;
}

export interface ImportPreview {
  readonly fileCount: number;
  readonly name: string;
  readonly previewToken: string;
  readonly structure: readonly ImportPreviewNode[];
  readonly type: ProjectType;
  readonly unclassified: readonly string[];
}

export interface ImportPreviewNode {
  readonly children: readonly ImportPreviewNode[];
  readonly name: string;
}

export class ProjectApiError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectApiError";
    this.code = code;
  }
}

export interface ProjectBridge {
  readonly confirmImport: (input: {
    readonly mode: "copy" | "in_place";
    readonly previewToken: string;
    readonly reassignProjectId?: boolean;
  }) => Promise<ProjectSummary>;
  readonly create: (input: {
    readonly name: string;
    readonly type: ProjectType;
  }) => Promise<ProjectSummary>;
  readonly getStructure: (input: {
    readonly projectId: string;
  }) => Promise<readonly StructureNode[]>;
  readonly list: () => Promise<readonly ProjectSummary[]>;
  readonly previewImport: (type: ProjectType) => Promise<ImportPreview | null>;
  readonly readDocument: (input: {
    readonly path: string;
    readonly projectId: string;
  }) => Promise<DocumentSnapshot>;
  readonly saveDocument: (input: {
    readonly content: string;
    readonly expectedVersion: string;
    readonly path: string;
    readonly projectId: string;
  }) => Promise<DocumentSnapshot>;
}
