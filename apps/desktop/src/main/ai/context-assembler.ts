import type {
  AiAssembledContext,
  AiContextAssemblyRequest,
  KnowledgeIndexStatusResult,
  KnowledgeSearchHit,
} from "@author-copilot/contracts";
import { AiContextAssemblyRequestSchema } from "@author-copilot/contracts";

import type { KnowledgeService } from "../knowledge/index.js";
import type {
  ProjectDocument,
  ProjectService,
  ProjectStructureNode,
} from "../project/index.js";

type StructureEntry = ProjectStructureNode | ProjectDocument;

export interface AiContextAssemblerOptions {
  readonly projectService: Pick<
    ProjectService,
    "getStructure" | "readDocument"
  >;
  readonly knowledgeService: Pick<KnowledgeService, "getStatus" | "search">;
}

export class AiContextAssemblyError extends Error {
  readonly code: "current_document_not_found" | "invalid_selection";

  constructor(code: AiContextAssemblyError["code"], message: string) {
    super(message);
    this.name = "AiContextAssemblyError";
    this.code = code;
  }
}

function findStructurePath(
  nodes: readonly StructureEntry[],
  relativePath: string,
  ancestors: readonly StructureEntry[] = [],
): readonly StructureEntry[] | undefined {
  for (const node of nodes) {
    const path = [...ancestors, node];
    if (node.relativePath === relativePath) return path;
    if (node.kind !== "document") {
      const nested = findStructurePath(node.children, relativePath, path);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function currentSection(
  document: AiContextAssemblyRequest["currentDocument"],
): AiAssembledContext["sections"][0] {
  const lines = document.content.split("\n");
  const selection = document.selection;
  if (selection === undefined) {
    return {
      kind: "current",
      contextKind: "document",
      relativePath: document.relativePath,
      startLine: 1,
      endLine: Math.max(1, lines.length),
      text: document.content,
    };
  }
  if (selection.endLine > lines.length) {
    throw new AiContextAssemblyError(
      "invalid_selection",
      "The current selection is outside the supplied document content.",
    );
  }
  return {
    kind: "current",
    contextKind: "selection",
    relativePath: document.relativePath,
    startLine: selection.startLine,
    endLine: selection.endLine,
    text: lines.slice(selection.startLine - 1, selection.endLine).join("\n"),
  };
}

function degradedKnowledgeSection(
  status: KnowledgeIndexStatusResult,
  reason: "index_not_ready" | "permission_denied" | "retrieval_failed",
): AiAssembledContext["sections"][2] {
  return {
    kind: "knowledge",
    scope: "current_document",
    status: status.status,
    indexVersion: null,
    hits: [],
    degradationReason: reason,
  };
}

export class AiContextAssembler {
  private readonly options: AiContextAssemblerOptions;

  constructor(options: AiContextAssemblerOptions) {
    this.options = options;
  }

  async assemble(input: AiContextAssemblyRequest): Promise<AiAssembledContext> {
    const request = AiContextAssemblyRequestSchema.parse(input);
    const [structure] = await Promise.all([
      this.options.projectService.getStructure(request.projectId),
      this.options.projectService.readDocument(
        request.projectId,
        request.currentDocument.relativePath,
      ),
    ]);
    const path =
      findStructurePath(
        structure.nodes,
        request.currentDocument.relativePath,
      ) ??
      findStructurePath(
        structure.unclassified,
        request.currentDocument.relativePath,
      );
    if (path === undefined) {
      throw new AiContextAssemblyError(
        "current_document_not_found",
        "The current document is not part of the project structure.",
      );
    }

    const current = currentSection(request.currentDocument);
    const status = await this.options.knowledgeService.getStatus(
      request.projectId,
    );
    const knowledge = await this.assembleKnowledge(request, status);

    return {
      projectId: request.projectId,
      sections: [
        current,
        {
          kind: "structure",
          path: path.map((entry) => ({
            kind: entry.kind,
            name: entry.name,
            relativePath: entry.relativePath,
          })),
        },
        knowledge,
        {
          kind: "request",
          instruction: request.instruction,
          permissions: request.permissions,
        },
      ],
    };
  }

  private async assembleKnowledge(
    request: AiContextAssemblyRequest,
    status: KnowledgeIndexStatusResult,
  ): Promise<AiAssembledContext["sections"][2]> {
    if (!request.permissions.retrieveKnowledge) {
      return degradedKnowledgeSection(status, "permission_denied");
    }
    if (status.status !== "ready" || status.indexVersion === null) {
      return degradedKnowledgeSection(status, "index_not_ready");
    }

    try {
      const result = await this.options.knowledgeService.search(
        request.projectId,
        request.instruction.slice(0, 500),
        request.retrievalLimit,
      );
      if (
        result.status.status !== "ready" ||
        result.status.indexVersion === null
      ) {
        return degradedKnowledgeSection(result.status, "index_not_ready");
      }
      return {
        kind: "knowledge",
        scope: "full_book",
        status: "ready",
        indexVersion: result.status.indexVersion,
        hits: result.hits.map(
          (hit: KnowledgeSearchHit): KnowledgeSearchHit => ({ ...hit }),
        ),
        degradationReason: null,
      };
    } catch {
      const refreshedStatus = await this.options.knowledgeService
        .getStatus(request.projectId)
        .catch(() => status);
      return degradedKnowledgeSection(refreshedStatus, "retrieval_failed");
    }
  }
}
