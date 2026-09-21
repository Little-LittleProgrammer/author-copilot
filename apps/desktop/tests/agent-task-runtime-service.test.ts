import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTaskEvent } from "@author-copilot/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentCapabilityService,
  AgentProcessTerminationError,
  AgentTaskRuntimeService,
  type AgentFileToolService,
} from "../src/main/ai/agent/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const otherProjectId = "10000000-0000-4000-8000-000000000002";
const taskId = "20000000-0000-4000-8000-000000000001";
const otherTaskId = "20000000-0000-4000-8000-000000000002";

function grant(
  capabilityService: AgentCapabilityService,
  requestedProjectId: string = projectId,
  requestedTaskId: string = taskId,
  timeoutMs = 60_000,
) {
  return capabilityService.grant(
    {
      projectId: requestedProjectId,
      readableFileTypes: ["markdown"],
      writableFileTypes: ["markdown"],
      allowedTools: [
        "mcp__author_copilot__read_text",
        "mcp__author_copilot__write_text",
        "mcp__author_copilot__edit_text",
        "mcp__author_copilot__glob",
        "mcp__author_copilot__grep",
      ],
      timeoutMs,
    },
    requestedTaskId,
  );
}

function fileTools(): AgentFileToolService {
  return {
    drain: vi.fn(async () => undefined),
    readText: vi.fn(),
    writeText: vi.fn(),
    editText: vi.fn(),
    glob: vi.fn(),
    grep: vi.fn(),
  } as unknown as AgentFileToolService;
}

function request(
  requestedProjectId: string = projectId,
  requestedTaskId: string = taskId,
) {
  return {
    taskId: requestedTaskId,
    projectId: requestedProjectId,
    prompt: "只通过授权工具整理当前作品。",
    projectRoot: join(tmpdir(), "author-copilot-projects", requestedProjectId),
    configDirectory: join(
      tmpdir(),
      "author-copilot-agent-data",
      requestedTaskId,
    ),
    apiKey: "task-key",
    sourceEnvironment: {
      PATH: "/usr/bin",
      SHELL: "/bin/zsh",
      COMSPEC: "cmd.exe",
    },
  };
}

function successResult(summary = "已完成受控修改。"): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    result: summary,
    duration_ms: 120,
    num_turns: 2,
    total_cost_usd: 0.01,
    permission_denials: [],
  } as unknown as SDKMessage;
}

function failedResult(): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    errors: ["sensitive /absolute/path"],
  } as unknown as SDKMessage;
}

function processTree(termination: Promise<void> = Promise.resolve()) {
  const terminate = vi.fn(() => termination);
  return {
    tree: {
      spawn: vi.fn() as never,
      terminate,
    },
    terminate,
  };
}

function controlledQuery() {
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const close = vi.fn(release);
  return {
    close,
    query: {
      close,
      async *[Symbol.asyncIterator]() {
        await finished;
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentTaskRuntimeService", () => {
  it("emits ordered sanitized progress and one normalized success terminal", async () => {
    const capabilityService = new AgentCapabilityService({});
    grant(capabilityService);
    const tree = processTree();
    const close = vi.fn();
    const createQuery = vi.fn((input) => ({
      close,
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init" } as SDKMessage;
        yield { type: "assistant" } as SDKMessage;
        yield successResult();
      },
      input,
    }));
    const service = new AgentTaskRuntimeService({
      capabilityService,
      fileTools: fileTools(),
      createQuery,
      createProcessTree: () => tree.tree,
      now: () => new Date("2026-08-16T00:00:00.000Z"),
    });
    const events: AgentTaskEvent[] = [];

    const terminal = await service.execute(request(), (event) =>
      events.push(event),
    );

    expect(events.map((event) => event.type)).toEqual([
      "agent.task.started",
      "agent.task.progress",
      "agent.task.progress",
      "agent.task.progress",
      "agent.task.completed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(terminal).toMatchObject({
      type: "agent.task.completed",
      summary: "已完成受控修改。",
      durationMs: 120,
      numTurns: 2,
      totalCostUsd: 0.01,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(tree.terminate).toHaveBeenCalledOnce();
    const sdkOptions = createQuery.mock.calls[0]?.[0].options;
    expect(sdkOptions.abortController?.signal.aborted).toBe(true);
    expect(sdkOptions.spawnClaudeCodeProcess).toBe(tree.tree.spawn);
    expect(sdkOptions.executable).toBeUndefined();
    expect(sdkOptions.pathToClaudeCodeExecutable).toMatch(/claude(?:\.exe)?$/u);
    expect(sdkOptions.env).not.toHaveProperty("SHELL");
    expect(sdkOptions.env).not.toHaveProperty("COMSPEC");
  });

  it("normalizes user cancellation once and rejects duplicate cancellation", async () => {
    const capabilityService = new AgentCapabilityService({});
    grant(capabilityService);
    const controlled = controlledQuery();
    const tree = processTree();
    const service = new AgentTaskRuntimeService({
      capabilityService,
      fileTools: fileTools(),
      createQuery: () => controlled.query,
      createProcessTree: () => tree.tree,
    });
    const events: AgentTaskEvent[] = [];

    const execution = service.execute(request(), (event) => events.push(event));
    expect(service.cancel(taskId)).toBe(true);
    expect(service.cancel(taskId)).toBe(false);
    const terminal = await execution;

    expect(terminal).toMatchObject({
      type: "agent.task.cancelled",
      reason: "user",
    });
    expect(
      events.filter((event) =>
        [
          "agent.task.cancelled",
          "agent.task.completed",
          "agent.task.failed",
        ].includes(event.type),
      ),
    ).toHaveLength(1);
    expect(controlled.close).toHaveBeenCalledOnce();
  });

  it("distinguishes timeout from shutdown and closes every active Query", async () => {
    vi.useFakeTimers();
    const capabilityService = new AgentCapabilityService({});
    grant(capabilityService, projectId, taskId, 1_000);
    grant(capabilityService, otherProjectId, otherTaskId, 60_000);
    const first = controlledQuery();
    const second = controlledQuery();
    const createQuery = vi
      .fn()
      .mockReturnValueOnce(first.query)
      .mockReturnValueOnce(second.query);
    const service = new AgentTaskRuntimeService({
      capabilityService,
      fileTools: fileTools(),
      createQuery,
      createProcessTree: () => processTree().tree,
    });

    const timedOut = service.execute(request(), vi.fn());
    const shuttingDown = service.execute(
      request(otherProjectId, otherTaskId),
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    service.shutdown();

    await expect(timedOut).resolves.toMatchObject({
      type: "agent.task.cancelled",
      reason: "timeout",
    });
    await expect(shuttingDown).resolves.toMatchObject({
      type: "agent.task.cancelled",
      reason: "shutdown",
    });
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it("normalizes SDK failures without retrying a failed task", async () => {
    const capabilityService = new AgentCapabilityService({});
    grant(capabilityService);
    const close = vi.fn();
    const createQuery = vi.fn(() => ({
      close,
      async *[Symbol.asyncIterator]() {
        yield failedResult();
      },
    }));
    const service = new AgentTaskRuntimeService({
      capabilityService,
      fileTools: fileTools(),
      createQuery,
      createProcessTree: () => processTree().tree,
    });

    const terminal = await service.execute(request(), vi.fn());

    expect(terminal).toMatchObject({
      type: "agent.task.failed",
      error: {
        code: "AI_UNAVAILABLE",
        message: "The Agent failed during execution.",
      },
    });
    expect(JSON.stringify(terminal)).not.toContain("/absolute/path");
    expect(createQuery).toHaveBeenCalledOnce();
  });

  it("returns a sanitized failure when Query creation or tree cleanup fails", async () => {
    const capabilityService = new AgentCapabilityService({});
    grant(capabilityService);
    const createQuery = vi.fn(() => {
      throw new Error("spawn failed at /sensitive/path");
    });
    const service = new AgentTaskRuntimeService({
      capabilityService,
      fileTools: fileTools(),
      createQuery,
      createProcessTree: () => processTree().tree,
    });

    const spawnFailure = await service.execute(request(), vi.fn());

    expect(spawnFailure).toMatchObject({
      type: "agent.task.failed",
      error: { code: "AI_UNAVAILABLE" },
    });
    expect(JSON.stringify(spawnFailure)).not.toContain("/sensitive/path");
    expect(createQuery).toHaveBeenCalledOnce();

    grant(capabilityService, projectId, otherTaskId);
    const terminationFailure = new AgentProcessTerminationError();
    const cleanupService = new AgentTaskRuntimeService({
      capabilityService,
      fileTools: fileTools(),
      createQuery: () => ({
        close: vi.fn(),
        async *[Symbol.asyncIterator]() {
          yield successResult();
        },
      }),
      createProcessTree: () =>
        processTree(Promise.reject(terminationFailure)).tree,
    });

    await expect(
      cleanupService.execute(request(projectId, otherTaskId), vi.fn()),
    ).resolves.toMatchObject({
      type: "agent.task.failed",
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
