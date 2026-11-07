import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  AGENT_MCP_SERVER_NAME,
  AgentCapabilityService,
  DISALLOWED_AGENT_SDK_TOOLS,
  buildAgentSdkOptions,
  buildAgentSubprocessEnvironment,
} from "../src/main/ai/agent/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";
const projectRoot = join(tmpdir(), "author-copilot-projects", "book");
const configDirectory = join(tmpdir(), "author-copilot-data", "agent", "task");

function fixture() {
  const capabilityService = new AgentCapabilityService({});
  const capability = capabilityService.grant(
    {
      projectId,
      readableFileTypes: ["markdown"],
      writableFileTypes: ["markdown"],
      allowedTools: [
        "mcp__author_copilot__read_text",
        "mcp__author_copilot__write_text",
        "mcp__author_copilot__edit_text",
        "mcp__author_copilot__glob",
        "mcp__author_copilot__grep",
      ],
      timeoutMs: 60_000,
    },
    taskId,
  );
  const mcpServer = {
    type: "sdk" as const,
    name: AGENT_MCP_SERVER_NAME,
    instance: {} as never,
  };
  return { capabilityService, capability, mcpServer };
}

describe("Agent SDK policy", () => {
  it("disables built-ins, settings, plugins, arbitrary MCP, and subagents", () => {
    const fx = fixture();
    const options = buildAgentSdkOptions({
      ...fx,
      projectRoot,
      configDirectory,
      apiKey: "test-key",
      sourceEnvironment: { PATH: "/usr/bin", SECRET_TOKEN: "must-not-pass" },
    });

    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual(fx.capability.allowedTools);
    expect(options.disallowedTools).toEqual(DISALLOWED_AGENT_SDK_TOOLS);
    expect(options.disallowedTools).toEqual(
      expect.arrayContaining([
        "Bash",
        "PowerShell",
        "WebFetch",
        "WebSearch",
        "Task",
        "Agent",
      ]),
    );
    expect(options.strictMcpConfig).toBe(true);
    expect(options.mcpServers).toEqual({
      [AGENT_MCP_SERVER_NAME]: fx.mcpServer,
    });
    expect(options.settingSources).toEqual([]);
    expect(options.plugins).toEqual([]);
    expect(options.skills).toEqual([]);
    expect(options.agents).toEqual({});
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.persistSession).toBe(false);
    expect(options.env).not.toHaveProperty("SECRET_TOKEN");
  });

  it("rechecks every SDK permission request against the active capability", async () => {
    const fx = fixture();
    const options = buildAgentSdkOptions({
      ...fx,
      projectRoot,
      configDirectory,
      apiKey: "test-key",
      sourceEnvironment: {},
    });
    const canUseTool = options.canUseTool;
    if (canUseTool === undefined) throw new Error("Missing permission gate.");
    const permissionOptions = {
      signal: new AbortController().signal,
      requestId: "request-1",
      toolUseID: "tool-1",
    };

    await expect(
      canUseTool("Bash", { command: "pwd" }, permissionOptions),
    ).resolves.toMatchObject({ behavior: "deny" });
    await expect(
      canUseTool(
        "mcp__foreign__read",
        { relativePath: "正文.md" },
        permissionOptions,
      ),
    ).resolves.toMatchObject({ behavior: "deny" });
    await expect(
      canUseTool(
        "mcp__author_copilot__read_text",
        { relativePath: "第一卷/正文.md" },
        permissionOptions,
      ),
    ).resolves.toMatchObject({ behavior: "allow" });
    await expect(
      canUseTool(
        "mcp__author_copilot__read_text",
        { relativePath: "../outside.md" },
        permissionOptions,
      ),
    ).resolves.toMatchObject({ behavior: "deny" });
  });

  it("uses an allowlisted replacement environment outside the project", () => {
    expect(
      buildAgentSubprocessEnvironment({
        apiKey: "task-key",
        configDirectory,
        sourceEnvironment: {
          PATH: "/usr/bin",
          SHELL: "/bin/zsh",
          COMSPEC: "cmd.exe",
          AWS_SECRET_ACCESS_KEY: "secret",
        },
      }),
    ).toEqual({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "task-key",
      CLAUDE_AGENT_SDK_CLIENT_APP: "author-copilot/0.0.0",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CONFIG_DIR: configDirectory,
      HOME: configDirectory,
      USERPROFILE: configDirectory,
    });
    const fx = fixture();
    expect(() =>
      buildAgentSdkOptions({
        ...fx,
        projectRoot,
        configDirectory: join(projectRoot, ".agent"),
        apiKey: "test-key",
        sourceEnvironment: {},
      }),
    ).toThrow("outside the project");
  });
});
