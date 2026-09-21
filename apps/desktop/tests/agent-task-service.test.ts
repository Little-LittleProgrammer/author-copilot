import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  AgentStartRequest,
  AgentTaskTerminalEvent,
} from "@author-copilot/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentCapabilityService,
  AgentTaskStartService,
  AgentTaskService,
} from "../src/main/ai/agent/index.js";
import { TaskSnapshotService } from "../src/main/git/task-snapshot-service.js";

const roots: string[] = [];
const exec = promisify(execFile);
const projectId = "10000000-0000-4000-8000-000000000001";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "agent-task-service-")),
  );
  roots.push(root);
  const projectRoot = join(root, "作品");
  await mkdir(projectRoot);
  await exec("git", ["init", "--initial-branch=main", projectRoot]);
  const projects = { getProjectRoot: async () => projectRoot };
  const snapshots = new TaskSnapshotService({
    gitExecutable: "git",
    isolationDirectory: join(root, "isolation"),
    snapshotsRoot: join(root, "snapshots"),
    resolveProjectRoot: projects.getProjectRoot,
  });
  const capabilities = new AgentCapabilityService({});
  const terminal = deferred<AgentTaskTerminalEvent>();
  const runtime = {
    execute: vi.fn(async () => terminal.promise),
    cancel: vi.fn(() => true),
    shutdown: vi.fn(),
  };
  const startService = new AgentTaskStartService({
    projectService: projects,
    taskSnapshotService: snapshots,
    capabilityService: capabilities,
  });
  const credentials = {
    getApiKey: vi.fn(async (): Promise<string | null> => "test-key"),
  };
  const options = {
    projects,
    snapshots,
    capabilities,
    runtime,
    startService,
    credentials,
    configRoot: join(root, "config"),
  };
  const service = new AgentTaskService(options);
  const request: AgentStartRequest = {
    projectId,
    prompt: "Edit the scene",
    readableFileTypes: ["markdown"],
    writableFileTypes: ["markdown"],
    allowedTools: ["mcp__author_copilot__write_text"],
    timeoutMs: 60_000,
  };
  return {
    service,
    options,
    terminal,
    runtime,
    request,
    capabilities,
    snapshots,
    projectRoot,
    root,
  };
}
function cancelled(taskId: string): AgentTaskTerminalEvent {
  return {
    taskId,
    projectId,
    type: "agent.task.cancelled",
    reason: "user",
    sequence: 1,
    timestamp: new Date().toISOString(),
  };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent task desktop lifecycle", () => {
  it("reserves the project before credential lookup and releases only its own start", async () => {
    const fx = await fixture();
    const key = deferred<string | null>();
    fx.options.credentials.getApiKey.mockImplementation(() => key.promise);
    const first = fx.service.start(fx.request, 1, () => undefined);
    await expect(
      fx.service.start(fx.request, 1, () => undefined),
    ).rejects.toMatchObject({ appError: { code: "CONFLICT" } });
    expect((await fx.service.getState(projectId)).running).toBe(true);
    fx.service.cancelOwner(1);
    key.resolve("key");
    await expect(first).rejects.toMatchObject({
      appError: { code: "CANCELLED" },
    });
    expect(fx.runtime.execute).not.toHaveBeenCalled();
    expect((await fx.service.getState(projectId)).running).toBe(false);
  });

  it("restricts cancellation to the owner and drains shutdown before making partial results recoverable", async () => {
    const fx = await fixture();
    const capability = await fx.service.start(fx.request, 1, () => undefined);
    await vi.waitFor(() => expect(fx.runtime.execute).toHaveBeenCalledOnce());
    await fx.snapshots.writeTaskFile(
      projectId,
      capability.taskId,
      "partial.md",
      "Agent partial",
    );
    expect(fx.service.cancel(projectId, capability.taskId, 2)).toBe(false);
    await expect(
      fx.service.restore(projectId, capability.taskId),
    ).rejects.toMatchObject({ appError: { code: "CONFLICT" } });
    let stopped = false;
    const shutdown = fx.service.shutdown().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(() =>
      fx.capabilities.authorizeTask({ projectId, taskId: capability.taskId }),
    ).toThrow();
    fx.terminal.resolve(cancelled(capability.taskId));
    await shutdown;
    expect(stopped).toBe(true);
    const recovered = new AgentTaskService({
      ...fx.options,
      capabilities: new AgentCapabilityService({}),
    });
    const state = await recovered.getState(projectId);
    expect(state.running).toBe(false);
    expect(state.event?.type).toBe("agent.task.cancelled");
    expect(state.review?.files[0]?.after).toBe("Agent partial");
    expect(await recovered.restore(projectId, capability.taskId)).toMatchObject(
      { status: "complete" },
    );
    await expect(
      readFile(join(fx.projectRoot, "partial.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists result-version failures across restart and retries without another SDK run", async () => {
    const fx = await fixture();
    const taskId = randomUUID();
    await fx.snapshots.createTaskSnapshot(projectId, taskId);
    await fx.snapshots.writeTaskFile(
      projectId,
      taskId,
      "partial.md",
      "kept content",
    );
    const state = await fx.service.getState(projectId);
    const directory = join(
      fx.projectRoot,
      ".git",
      "refs",
      "author-copilot",
      "tasks",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${taskId}.lock`), "locked");
    await expect(
      fx.service.retain(projectId, taskId, state.review?.reviewDigest ?? ""),
    ).rejects.toThrow();
    const restarted = new AgentTaskService({
      ...fx.options,
      capabilities: new AgentCapabilityService({}),
    });
    expect((await restarted.getState(projectId)).versionError?.code).toBe(
      "GIT_FAILED",
    );
    await rm(join(directory, `${taskId}.lock`));
    await restarted.retain(projectId, taskId, state.review?.reviewDigest ?? "");
    expect(fx.runtime.execute).not.toHaveBeenCalled();
    expect(await readFile(join(fx.projectRoot, "partial.md"), "utf8")).toBe(
      "kept content",
    );
  });

  it("does not carry authorization across a crash with an unfinished journal", async () => {
    const fx = await fixture();
    const taskId = randomUUID();
    await writeFile(join(fx.projectRoot, "draft.md"), "original draft");
    await fx.snapshots.createTaskSnapshot(projectId, taskId);
    await fx.snapshots.writeTaskFile(
      projectId,
      taskId,
      "draft.md",
      "partial after crash",
    );
    const recovered = new AgentTaskService({
      ...fx.options,
      capabilities: new AgentCapabilityService({}),
    });
    expect(await recovered.getState(projectId)).toMatchObject({
      running: false,
      taskId,
      review: {
        files: [{ before: "original draft", after: "partial after crash" }],
      },
    });
    expect(() =>
      fx.capabilities.authorizeTask({ projectId, taskId }),
    ).toThrow();
    await expect(
      recovered.start(fx.request, 1, () => undefined),
    ).rejects.toMatchObject({ code: "task_conflict" });
    expect((await recovered.restore(projectId, taskId)).status).toBe(
      "complete",
    );
    expect(await readFile(join(fx.projectRoot, "draft.md"), "utf8")).toBe(
      "original draft",
    );
  });

  it("preserves failed SDK results for review without automatically running again", async () => {
    const fx = await fixture();
    const capability = await fx.service.start(fx.request, 1, () => undefined);
    await vi.waitFor(() => expect(fx.runtime.execute).toHaveBeenCalledOnce());
    await fx.snapshots.writeTaskFile(
      projectId,
      capability.taskId,
      "partial.md",
      "partial",
    );
    fx.terminal.resolve({
      taskId: capability.taskId,
      projectId,
      sequence: 1,
      timestamp: new Date().toISOString(),
      type: "agent.task.failed",
      error: {
        code: "AI_UNAVAILABLE",
        message: "Provider failed",
        retryable: true,
      },
    } as AgentTaskTerminalEvent);
    await vi.waitFor(async () =>
      expect((await fx.service.getState(projectId)).running).toBe(false),
    );
    expect((await fx.service.getState(projectId)).event?.type).toBe(
      "agent.task.failed",
    );
    expect(fx.runtime.execute).toHaveBeenCalledOnce();
    const state = await fx.service.getState(projectId);
    const retained = await fx.service.retain(
      projectId,
      capability.taskId,
      state.review?.reviewDigest ?? "",
    );
    expect(retained).toMatch(/^[a-f0-9]{40,64}$/u);
    expect(fx.runtime.execute).toHaveBeenCalledOnce();
  });
});
