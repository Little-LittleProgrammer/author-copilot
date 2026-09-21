import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ContentHashSchema,
  RelativeProjectPathSchema,
  type AgentTaskCapability,
  type AgentToolName,
} from "@author-copilot/contracts";
import { z } from "zod";

import type {
  AgentFileToolService,
  AgentToolContext,
} from "./file-tool-service.js";

export const AGENT_MCP_SERVER_NAME = "author_copilot";

type AgentSdkMcpToolDefinition = SdkMcpToolDefinition<
  Record<string, z.ZodType>
>;

function eraseToolSchema<Schema extends Record<string, z.ZodType>>(
  definition: SdkMcpToolDefinition<Schema>,
): AgentSdkMcpToolDefinition {
  // SDK MCP servers intentionally collect tools with different input schemas.
  // Each handler is checked against its concrete schema before this boundary.
  return definition as unknown as AgentSdkMcpToolDefinition;
}

const FULL_TOOL_NAME_BY_SHORT_NAME = {
  read_text: "mcp__author_copilot__read_text",
  write_text: "mcp__author_copilot__write_text",
  edit_text: "mcp__author_copilot__edit_text",
  glob: "mcp__author_copilot__glob",
  grep: "mcp__author_copilot__grep",
} as const satisfies Readonly<Record<string, AgentToolName>>;

function success(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

async function safeResult(operation: () => Promise<unknown>) {
  try {
    return success(await operation());
  } catch {
    return {
      content: [
        {
          type: "text" as const,
          text: "The controlled Agent file operation was rejected.",
        },
      ],
      isError: true,
    };
  }
}

export function createAgentToolDefinitions(
  context: AgentToolContext,
  fileTools: AgentFileToolService,
): readonly AgentSdkMcpToolDefinition[] {
  return [
    eraseToolSchema(
      tool(
        "read_text",
        "Read one authorized Markdown document and return its content hash.",
        { relativePath: RelativeProjectPathSchema },
        ({ relativePath }) =>
          safeResult(() => fileTools.readText(context, relativePath)),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
    ),
    eraseToolSchema(
      tool(
        "write_text",
        "Write one authorized Markdown document through the task mutation ledger. Use null expectedHash only when creating a new file.",
        {
          relativePath: RelativeProjectPathSchema,
          content: z.string().max(1_000_000),
          expectedHash: ContentHashSchema.nullable(),
        },
        (input) => safeResult(() => fileTools.writeText(context, input)),
        { alwaysLoad: true },
      ),
    ),
    eraseToolSchema(
      tool(
        "edit_text",
        "Apply one offset-based edit to an authorized Markdown document after checking its hash and expected source text.",
        {
          relativePath: RelativeProjectPathSchema,
          expectedHash: ContentHashSchema,
          startOffset: z.number().int().nonnegative(),
          endOffset: z.number().int().nonnegative(),
          expectedText: z.string().max(200_000),
          replacementText: z.string().max(200_000),
        },
        (input) => safeResult(() => fileTools.editText(context, input)),
        { alwaysLoad: true },
      ),
    ),
    eraseToolSchema(
      tool(
        "glob",
        "List authorized Markdown document paths matching a bounded glob pattern.",
        {
          pattern: z.string().min(1).max(512),
          limit: z.number().int().min(1).max(100).optional(),
        },
        ({ pattern, limit }) =>
          safeResult(() => fileTools.glob(context, pattern, limit)),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
    ),
    eraseToolSchema(
      tool(
        "grep",
        "Search authorized Markdown documents for a literal bounded query.",
        {
          query: z.string().min(1).max(256),
          caseSensitive: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        ({ query, caseSensitive, limit }) =>
          safeResult(() =>
            fileTools.grep(context, {
              query,
              ...(caseSensitive === undefined ? {} : { caseSensitive }),
              ...(limit === undefined ? {} : { limit }),
            }),
          ),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
    ),
  ];
}

export function createAgentMcpServer(options: {
  readonly capability: AgentTaskCapability;
  readonly fileTools: AgentFileToolService;
}): McpSdkServerConfigWithInstance {
  const context = {
    taskId: options.capability.taskId,
    projectId: options.capability.projectId,
  };
  const allowed = new Set(options.capability.allowedTools);
  const tools = createAgentToolDefinitions(context, options.fileTools).filter(
    (definition) => {
      const fullName =
        FULL_TOOL_NAME_BY_SHORT_NAME[
          definition.name as keyof typeof FULL_TOOL_NAME_BY_SHORT_NAME
        ];
      return fullName !== undefined && allowed.has(fullName);
    },
  );
  return createSdkMcpServer({
    name: AGENT_MCP_SERVER_NAME,
    version: "1.0.0",
    instructions:
      "Only these application-owned Markdown tools are authorized. Paths and writes are revalidated by the main process for every call.",
    tools,
    alwaysLoad: true,
  });
}
