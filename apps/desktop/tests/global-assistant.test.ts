import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskTerminalEvent } from "@author-copilot/contracts";
import { GlobalAssistantRequestSchema } from "@author-copilot/contracts";
import { WorkspaceService } from "../src/main/workspace/workspace-service.js";
import { GlobalAssistantService } from "../src/main/ai/global-assistant-service.js";
import { AgentCapabilityService } from "../src/main/ai/agent/capability-service.js";
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "global-assistant-"));
  roots.push(root);
  const workspace = new WorkspaceService(root);
  await workspace.selectIdentity("local");
  const release = vi.fn(async () => undefined);
  const providers = {
    snapshot: vi.fn(async () => ({
      selection: {
        mode: "custom" as const,
        providerId: "anthropic",
        model: "test",
      },
    })),
    resolve: vi.fn(async () => ({
      apiKey: "test-key",
      baseURL: "https://example.test",
      model: "test",
      platform: false,
      release,
    })),
  };
  const execute = vi.fn(
    async (input: {
      taskId: string;
      projectId: string;
    }): Promise<AgentTaskTerminalEvent> => ({
      type: "agent.task.completed",
      taskId: input.taskId,
      projectId: input.projectId,
      sequence: 0,
      timestamp: new Date().toISOString(),
      summary: "作品甲与作品乙的主题不同。",
      durationMs: 1,
      numTurns: 1,
      totalCostUsd: 0,
      permissionDenialCount: 0,
    }),
  );
  const cancel = vi.fn(() => true);
  const capabilities = new AgentCapabilityService({});
  const service = new GlobalAssistantService({
    workspace,
    capabilities,
    projects: { list: async () => [] },
    providers,
    runtime: { execute, cancel },
  });
  return {
    workspace,
    service,
    execute,
    cancel,
    providers,
    release,
    capabilities,
  };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe("account global assistant", () => {
  it("runs read-only native queries and persists history only within the selected identity", async () => {
    const fx = await fixture();
    const response = await fx.service.request(
      { action: "send", prompt: "比较两部作品" },
      1,
    );
    expect(response).toMatchObject({
      ok: true,
      running: false,
      messages: [
        { role: "user", content: "比较两部作品" },
        { role: "assistant", content: "作品甲与作品乙的主题不同。" },
      ],
    });
    expect(fx.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        readOnly: true,
        projectRoot: fx.workspace.root,
        configDirectory: fx.workspace.runtimeConfigDirectory,
      }),
      expect.any(Function),
    );
    expect(fx.release).toHaveBeenCalledOnce();
    await fx.workspace.selectIdentity("10000000-0000-4000-8000-000000000001");
    expect(await fx.service.request({ action: "get" }, 1)).toMatchObject({
      ok: true,
      messages: [],
    });
    await fx.workspace.selectIdentity("local");
    expect(await fx.service.request({ action: "get" }, 1)).toMatchObject({
      ok: true,
      messages: expect.any(Array),
    });
    await fx.service.request({ action: "clear" }, 1);
    expect(await fx.service.request({ action: "get" }, 1)).toMatchObject({
      ok: true,
      messages: [],
    });
  });
  it("cancels during provider setup, rejects duplicate sends and does not start the SDK afterward", async () => {
    const fx = await fixture();
    let resolveRoute!: (
      value: Awaited<ReturnType<typeof fx.providers.resolve>>,
    ) => void;
    const route = await fx.providers.resolve();
    fx.providers.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRoute = resolve;
        }),
    );
    const sending = fx.service.request(
      { action: "send", prompt: "查询剧情" },
      1,
    );
    await vi.waitFor(() =>
      expect(fx.providers.resolve).toHaveBeenCalledTimes(2),
    );
    await expect(
      fx.service.request({ action: "send", prompt: "另一个问题" }, 2),
    ).rejects.toThrow("already running");
    await fx.service.request({ action: "cancel" }, 2);
    expect(fx.cancel).not.toHaveBeenCalled();
    await fx.service.request({ action: "cancel" }, 1);
    resolveRoute(route);
    await sending;
    expect(fx.execute).not.toHaveBeenCalled();
    expect(await fx.service.request({ action: "get" }, 1)).toMatchObject({
      ok: true,
      running: false,
      messages: [],
    });
    expect(fx.release).toHaveBeenCalledOnce();
  });
  it("rejects renderer-supplied identity, directories and capabilities", () => {
    for (const extra of [
      { accountId: "another" },
      { cwd: "/outside" },
      { additionalDirectories: ["/outside"] },
      { allowedTools: ["Bash"] },
    ])
      expect(
        GlobalAssistantRequestSchema.safeParse({
          action: "send",
          prompt: "查询剧情",
          ...extra,
        }).success,
      ).toBe(false);
  });
});
