import { createRequire } from "node:module";
import { dirname, isAbsolute } from "node:path";

import type {
  Options,
  SpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentTaskCapability } from "@author-copilot/contracts";
import type { NativeToolPolicy } from "./native-tool-policy.js";

export const DISALLOWED_AGENT_SDK_TOOLS = Object.freeze([
  "Agent",
  "Task",
  "Bash",
  "PowerShell",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "ToolSearch",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
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
    HOME: dirname(options.configDirectory),
    USERPROFILE: dirname(options.configDirectory),
  };
}

export function buildAgentSdkOptions(options: {
  readonly capability: AgentTaskCapability;
  readonly projectRoot: string;
  readonly configDirectory: string;
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly policy: NativeToolPolicy;
  readonly skills: readonly string[];
  readonly instructions?: string;
  readonly spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
  readonly sourceEnvironment?: NodeJS.ProcessEnv;
}): Options {
  if (!isAbsolute(options.projectRoot)) {
    throw new Error("The Agent project root must be absolute.");
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
    systemPrompt: [
      "You are Author Copilot, a writing assistant for authors, novelists and screenwriters. Use the available Skills before applying a matching writing workflow. Ground answers in the current workspace's manuscripts and creative assets, cite source paths, and distinguish confirmed facts from suggestions. Preserve the author's voice and require review of edits. Read an existing file before using Write or Edit. Workspace permission hooks are authoritative; never try to bypass them or access another workspace. Shell execution and external tools are not available.",
      options.instructions ?? "",
    ].join("\n\n"),
    ...(options.model ? { model: options.model } : {}),
    cwd: options.projectRoot,
    env: buildAgentSubprocessEnvironment(options),
    tools: ["Read", "Glob", "Grep", "Write", "Edit", "Skill"],
    allowedTools: [...options.capability.allowedTools],
    disallowedTools: [...DISALLOWED_AGENT_SDK_TOOLS],
    canUseTool: options.policy.canUseTool,
    permissionMode: "dontAsk",
    includePartialMessages: true,
    mcpServers: {},
    hooks: options.policy.hooks(),
    strictMcpConfig: true,
    settings: {
      claudeMdExcludes: ["**"],
      disableAllHooks: false,
      hooks: {},
      permissions: {
        deny: [...DISALLOWED_AGENT_SDK_TOOLS],
        additionalDirectories: [],
      },
      enabledMcpjsonServers: [],
      enableAllProjectMcpServers: false,
    },
    settingSources: ["project"],
    skills: [...options.skills],
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
