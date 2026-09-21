import { createRequire } from "node:module";
import { isAbsolute, relative, sep } from "node:path";

import type {
  CanUseTool,
  McpSdkServerConfigWithInstance,
  Options,
  SpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import {
  AgentToolNameSchema,
  type AgentTaskCapability,
} from "@author-copilot/contracts";

import type { AgentCapabilityService } from "./capability-service.js";
import { AGENT_MCP_SERVER_NAME } from "./tool-server.js";

export const DISALLOWED_AGENT_SDK_TOOLS = Object.freeze([
  "Agent",
  "AskUserQuestion",
  "Bash",
  "Edit",
  "EnterPlanMode",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "NotebookEdit",
  "PowerShell",
  "Read",
  "Skill",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
]);

const PASSTHROUGH_ENVIRONMENT = Object.freeze([
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "Path",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "WINDIR",
]);

function isInside(parent: string, child: string): boolean {
  const result = relative(parent, child);
  return (
    result === "" ||
    (result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result))
  );
}

export function buildAgentSubprocessEnvironment(options: {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly configDirectory: string;
  readonly sourceEnvironment?: NodeJS.ProcessEnv;
}): Readonly<Record<string, string>> {
  if (options.apiKey.trim().length === 0) {
    throw new Error("The Agent API key is missing.");
  }
  if (!isAbsolute(options.configDirectory)) {
    throw new Error("The Agent config directory must be absolute.");
  }
  const source = options.sourceEnvironment ?? process.env;
  const environment: Record<string, string> = {};
  for (const name of PASSTHROUGH_ENVIRONMENT) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return {
    ...environment,
    ANTHROPIC_API_KEY: options.apiKey,
    ...(options.baseURL ? { ANTHROPIC_BASE_URL: options.baseURL } : {}),
    ...(options.model
      ? {
          ANTHROPIC_MODEL: options.model,
          ANTHROPIC_SMALL_FAST_MODEL: options.model,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: options.model,
          ANTHROPIC_DEFAULT_SONNET_MODEL: options.model,
          ANTHROPIC_DEFAULT_OPUS_MODEL: options.model,
        }
      : {}),
    CLAUDE_AGENT_SDK_CLIENT_APP: "author-copilot/0.0.0",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CONFIG_DIR: options.configDirectory,
    HOME: options.configDirectory,
    USERPROFILE: options.configDirectory,
  };
}

function permissionGate(options: {
  readonly capability: AgentTaskCapability;
  readonly capabilityService: Pick<AgentCapabilityService, "authorize">;
}): CanUseTool {
  return async (toolName, input) => {
    const tool = AgentToolNameSchema.safeParse(toolName);
    if (!tool.success) {
      return {
        behavior: "deny",
        message: "The requested Agent tool is not authorized.",
      };
    }
    try {
      const relativePath =
        typeof input.relativePath === "string" ? input.relativePath : undefined;
      options.capabilityService.authorize({
        taskId: options.capability.taskId,
        projectId: options.capability.projectId,
        tool: tool.data,
        ...(relativePath === undefined ? {} : { relativePath }),
      });
      return { behavior: "allow", updatedInput: input };
    } catch {
      return {
        behavior: "deny",
        message: "The requested Agent tool is outside the task capability.",
      };
    }
  };
}

export function buildAgentSdkOptions(options: {
  readonly capability: AgentTaskCapability;
  readonly capabilityService: Pick<AgentCapabilityService, "authorize">;
  readonly projectRoot: string;
  readonly configDirectory: string;
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly mcpServer: McpSdkServerConfigWithInstance;
  readonly spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
  readonly sourceEnvironment?: NodeJS.ProcessEnv;
}): Options {
  if (!isAbsolute(options.projectRoot)) {
    throw new Error("The Agent project root must be absolute.");
  }
  if (isInside(options.projectRoot, options.configDirectory)) {
    throw new Error("The Agent config directory must be outside the project.");
  }
  return {
    pathToClaudeCodeExecutable: createRequire(
      import.meta.resolve("@anthropic-ai/claude-agent-sdk"),
    )
      .resolve(
        `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${process.platform === "win32" ? "claude.exe" : "claude"}`,
      )
      .replace(/([\\/])app\.asar([\\/])/u, "$1app.asar.unpacked$2"),
    maxTurns: 32,
    ...(options.model ? { model: options.model } : {}),
    cwd: options.projectRoot,
    env: buildAgentSubprocessEnvironment(options),
    tools: [],
    allowedTools: [...options.capability.allowedTools],
    disallowedTools: [...DISALLOWED_AGENT_SDK_TOOLS],
    canUseTool: permissionGate(options),
    permissionMode: "dontAsk",
    mcpServers: { [AGENT_MCP_SERVER_NAME]: options.mcpServer },
    strictMcpConfig: true,
    settingSources: [],
    skills: [],
    plugins: [],
    agents: {},
    additionalDirectories: [],
    enableFileCheckpointing: false,
    persistSession: false,
    ...(options.spawnClaudeCodeProcess === undefined
      ? {}
      : { spawnClaudeCodeProcess: options.spawnClaudeCodeProcess }),
  };
}
