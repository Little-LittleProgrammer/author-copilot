import {
  AgentToolNameSchema,
  type AgentToolName,
} from "@author-copilot/contracts";

import type { TaskSnapshotService } from "../../git/index.js";
import type {
  ProjectDocument,
  ProjectService,
  ProjectStructureNode,
} from "../../project/index.js";
import type { AgentCapabilityService } from "./capability-service.js";

const MAX_READ_CHARACTERS = 200_000;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_QUERY_CHARACTERS = 256;

export interface AgentFileToolServiceOptions {
  readonly capabilityService: Pick<
    AgentCapabilityService,
    "authorize" | "authorizeFilePath"
  >;
  readonly projectService: Pick<
    ProjectService,
    "getStructure" | "readDocument"
  >;
  readonly taskSnapshotService: Pick<TaskSnapshotService, "writeTaskFile">;
}

export interface AgentToolContext {
  readonly taskId: string;
  readonly projectId: string;
}

export interface AgentReadTextResult {
  readonly relativePath: string;
  readonly content: string;
  readonly hash: string;
}

export interface AgentWriteTextResult {
  readonly relativePath: string;
  readonly written: true;
}

export interface AgentGrepMatch {
  readonly relativePath: string;
  readonly line: number;
  readonly text: string;
}

function documentPaths(
  nodes: readonly (ProjectStructureNode | ProjectDocument)[],
): string[] {
  return nodes.flatMap((node) =>
    node.kind === "document"
      ? [node.relativePath]
      : documentPaths(node.children),
  );
}

function globExpression(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.length > 512 ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/u.test(normalized) ||
    normalized
      .split("/")
      .some((segment) => segment === ".." || segment.startsWith("."))
  ) {
    throw new Error("The Agent glob pattern is invalid.");
  }

  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? "";
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_RESULTS) {
    throw new Error("The Agent search result limit is invalid.");
  }
  return limit;
}

function authorize(
  service: Pick<AgentCapabilityService, "authorize">,
  context: AgentToolContext,
  tool: AgentToolName,
  relativePath?: string,
): void {
  service.authorize({
    ...context,
    tool,
    ...(relativePath === undefined ? {} : { relativePath }),
  });
}

function readablePaths(
  service: Pick<AgentCapabilityService, "authorizeFilePath">,
  context: AgentToolContext,
  paths: readonly string[],
): string[] {
  return paths.filter((relativePath) => {
    try {
      service.authorizeFilePath({
        ...context,
        access: "read",
        relativePath,
      });
      return true;
    } catch {
      return false;
    }
  });
}

export class AgentFileToolService {
  private readonly pendingWrites = new Map<string, Set<Promise<unknown>>>();

  constructor(private readonly options: AgentFileToolServiceOptions) {}

  async drain(taskId: string): Promise<void> {
    const pending = this.pendingWrites.get(taskId);
    if (pending !== undefined) await Promise.allSettled([...pending]);
  }

  private trackWrite<T>(
    taskId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const pending =
      this.pendingWrites.get(taskId) ?? new Set<Promise<unknown>>();
    this.pendingWrites.set(taskId, pending);
    const result = operation();
    pending.add(result);
    const cleanup = (): void => {
      pending.delete(result);
      if (pending.size === 0) this.pendingWrites.delete(taskId);
    };
    void result.then(cleanup, cleanup);
    return result;
  }

  async readText(
    context: AgentToolContext,
    relativePath: string,
  ): Promise<AgentReadTextResult> {
    authorize(
      this.options.capabilityService,
      context,
      "mcp__author_copilot__read_text",
      relativePath,
    );
    const document = await this.options.projectService.readDocument(
      context.projectId,
      relativePath,
    );
    if (document.content.length > MAX_READ_CHARACTERS) {
      throw new Error("The Agent document exceeds the read limit.");
    }
    return { relativePath, content: document.content, hash: document.hash };
  }

  writeText(
    context: AgentToolContext,
    input: {
      readonly relativePath: string;
      readonly content: string;
      readonly expectedHash: string | null;
    },
  ): Promise<AgentWriteTextResult> {
    return this.trackWrite(context.taskId, async () => {
      authorize(
        this.options.capabilityService,
        context,
        "mcp__author_copilot__write_text",
        input.relativePath,
      );
      const assertAuthorized = (): void =>
        authorize(
          this.options.capabilityService,
          context,
          "mcp__author_copilot__write_text",
          input.relativePath,
        );
      assertAuthorized();
      await this.options.taskSnapshotService.writeTaskFile(
        context.projectId,
        context.taskId,
        input.relativePath,
        input.content,
        input.expectedHash,
        assertAuthorized,
      );
      return { relativePath: input.relativePath, written: true };
    });
  }

  editText(
    context: AgentToolContext,
    input: {
      readonly relativePath: string;
      readonly expectedHash: string;
      readonly startOffset: number;
      readonly endOffset: number;
      readonly expectedText: string;
      readonly replacementText: string;
    },
  ): Promise<AgentWriteTextResult> {
    return this.trackWrite(context.taskId, async () => {
      authorize(
        this.options.capabilityService,
        context,
        "mcp__author_copilot__edit_text",
        input.relativePath,
      );
      const document = await this.options.projectService.readDocument(
        context.projectId,
        input.relativePath,
      );
      if (
        document.hash !== input.expectedHash ||
        !Number.isInteger(input.startOffset) ||
        !Number.isInteger(input.endOffset) ||
        input.startOffset < 0 ||
        input.endOffset < input.startOffset ||
        input.endOffset > document.content.length ||
        document.content.slice(input.startOffset, input.endOffset) !==
          input.expectedText
      ) {
        throw new Error("The Agent edit baseline no longer matches the file.");
      }
      const content =
        document.content.slice(0, input.startOffset) +
        input.replacementText +
        document.content.slice(input.endOffset);
      const assertAuthorized = (): void =>
        authorize(
          this.options.capabilityService,
          context,
          "mcp__author_copilot__edit_text",
          input.relativePath,
        );
      assertAuthorized();
      await this.options.taskSnapshotService.writeTaskFile(
        context.projectId,
        context.taskId,
        input.relativePath,
        content,
        input.expectedHash,
        assertAuthorized,
      );
      return { relativePath: input.relativePath, written: true };
    });
  }

  async glob(
    context: AgentToolContext,
    pattern: string,
    limit?: number,
  ): Promise<readonly string[]> {
    authorize(
      this.options.capabilityService,
      context,
      "mcp__author_copilot__glob",
    );
    const matcher = globExpression(pattern);
    const maximum = boundedLimit(limit);
    const structure = await this.options.projectService.getStructure(
      context.projectId,
    );
    return readablePaths(
      this.options.capabilityService,
      context,
      documentPaths([...structure.nodes, ...structure.unclassified]),
    )
      .filter((relativePath) => matcher.test(relativePath))
      .slice(0, maximum);
  }

  async grep(
    context: AgentToolContext,
    input: {
      readonly query: string;
      readonly caseSensitive?: boolean;
      readonly limit?: number;
    },
  ): Promise<readonly AgentGrepMatch[]> {
    authorize(
      this.options.capabilityService,
      context,
      "mcp__author_copilot__grep",
    );
    if (
      input.query.length === 0 ||
      input.query.length > MAX_SEARCH_QUERY_CHARACTERS
    ) {
      throw new Error("The Agent grep query is invalid.");
    }
    const maximum = boundedLimit(input.limit);
    const query = input.caseSensitive ? input.query : input.query.toLowerCase();
    const structure = await this.options.projectService.getStructure(
      context.projectId,
    );
    const matches: AgentGrepMatch[] = [];
    for (const relativePath of readablePaths(
      this.options.capabilityService,
      context,
      documentPaths([...structure.nodes, ...structure.unclassified]),
    )) {
      const document = await this.options.projectService.readDocument(
        context.projectId,
        relativePath,
      );
      const lines = document.content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const candidate = input.caseSensitive ? line : line.toLowerCase();
        if (!candidate.includes(query)) continue;
        matches.push({
          relativePath,
          line: index + 1,
          text: line.slice(0, 500),
        });
        if (matches.length >= maximum) return matches;
      }
    }
    return matches;
  }

  static isKnownTool(toolName: string): toolName is AgentToolName {
    return AgentToolNameSchema.safeParse(toolName).success;
  }
}
