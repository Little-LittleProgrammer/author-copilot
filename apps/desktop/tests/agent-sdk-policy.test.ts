import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildAgentSdkOptions,
  buildAgentSubprocessEnvironment,
  AgentCapabilityService,
  NativeToolPolicy,
} from "../src/main/ai/agent/index.js";
const projectRoot = join(tmpdir(), "books", "book");
const configDirectory = join(tmpdir(), "account", "workspace", ".claude");
function fixture() {
  const capabilityService = new AgentCapabilityService({});
  const capability = capabilityService.grant(
    {
      projectId: "10000000-0000-4000-8000-000000000001",
      readableFileTypes: ["markdown"],
      writableFileTypes: ["markdown"],
      allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Skill"],
      timeoutMs: 60000,
    },
    "20000000-0000-4000-8000-000000000001",
  );
  const policy = new NativeToolPolicy({
    capabilityService,
    capability,
    projectRoot,
    skills: ["read-outline"],
    skillReadRoots: [],
    snapshots: {
      prepareNativeMutation: vi.fn(),
      completeNativeMutation: vi.fn(),
    },
  });
  return { capabilityService, capability, policy, skills: ["read-outline"] };
}
describe("native Agent SDK options", () => {
  it("loads persistent account/project skills with native tools and Main-owned hooks", () => {
    const fx = fixture();
    const options = buildAgentSdkOptions({
      ...fx,
      projectRoot,
      configDirectory,
      apiKey: "test-key",
      sourceEnvironment: { PATH: "/usr/bin", SECRET_TOKEN: "secret" },
    });
    expect(options.cwd).toBe(projectRoot);
    expect(options.tools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Write",
      "Edit",
      "Skill",
    ]);
    expect(options.settingSources).toEqual(["project"]);
    expect(options.skills).toEqual(["read-outline"]);
    expect(options.additionalDirectories).toEqual([]);
    expect(options.mcpServers).toEqual({});
    expect(options.strictMcpConfig).toBe(true);
    expect(options.plugins).toEqual([]);
    expect(options.agents).toEqual({});
    expect(options.hooks?.PreToolUse).toHaveLength(1);
    expect(options.hooks?.PostToolUse).toHaveLength(1);
    expect(options.disallowedTools).toEqual(
      expect.arrayContaining(["Bash", "PowerShell", "Agent", "NotebookEdit"]),
    );
    expect(options.env?.HOME).toBe(dirname(configDirectory));
    expect(options.env?.CLAUDE_CONFIG_DIR).toBe(configDirectory);
    expect(options.env).not.toHaveProperty("SECRET_TOKEN");
    expect(options.persistSession).toBe(false);
  });
  it("denies shell, arbitrary MCP, unlisted skills and revoked task capabilities", async () => {
    const fx = fixture();
    const options = {
      signal: new AbortController().signal,
      requestId: "request",
      toolUseID: "tool",
    };
    for (const tool of ["Bash", "mcp__foreign__read", "NotebookEdit"])
      expect(
        await fx.policy.canUseTool(tool, { command: "pwd" }, options),
      ).toMatchObject({ behavior: "deny" });
    expect(
      await fx.policy.canUseTool("Skill", { skill: "compare-works" }, options),
    ).toMatchObject({ behavior: "deny" });
    expect(
      await fx.policy.canUseTool("Skill", { skill: "read-outline" }, options),
    ).toMatchObject({ behavior: "allow" });
    fx.capabilityService.revoke(fx.capability.taskId);
    expect(
      await fx.policy.canUseTool("Skill", { skill: "read-outline" }, options),
    ).toMatchObject({ behavior: "deny" });
  });
  it("replaces the host environment and rejects nonabsolute configuration paths", () => {
    const environment = buildAgentSubprocessEnvironment({
      apiKey: "key",
      configDirectory,
      sourceEnvironment: {
        PATH: "/usr/bin",
        AWS_SECRET_ACCESS_KEY: "secret",
        SHELL: "/bin/zsh",
      },
    });
    expect(environment.HOME).toBe(dirname(configDirectory));
    expect(environment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(environment).not.toHaveProperty("SHELL");
    expect(() =>
      buildAgentSubprocessEnvironment({
        apiKey: "key",
        configDirectory: ".claude",
      }),
    ).toThrow("absolute");
  });
});
