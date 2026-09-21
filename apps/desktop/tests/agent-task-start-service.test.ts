import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentCapabilityService,
  AgentTaskStartError,
  AgentTaskStartService,
} from "../src/main/ai/agent/index.js";
import { TaskSnapshotService } from "../src/main/git/index.js";
import {
  InvalidProjectPathError,
  ProjectService,
  RegistryStore,
} from "../src/main/project/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";
const existingTaskId = "20000000-0000-4000-8000-000000000002";
const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

function request(requestedProjectId: string = projectId) {
  return {
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
    timeoutMs: 60_000,
  } as const;
}

async function execGit(
  repository: string,
  arguments_: readonly string[],
): Promise<void> {
  await execFileAsync("git", ["-C", repository, ...arguments_]);
}

async function fixture(): Promise<{
  readonly root: string;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly projectService: ProjectService;
  readonly snapshotService: TaskSnapshotService;
}> {
  const root = await mkdtemp(join(tmpdir(), "author-copilot-agent-start-"));
  temporaryRoots.push(root);
  const projects = join(root, "projects");
  await mkdir(projects);
  const projectService = new ProjectService({
    registry: new RegistryStore(join(root, "user-data")),
  });
  const project = await projectService.createProject(
    projects,
    "启动门禁",
    "novel",
  );
  await execGit(project.rootPath, ["init", "--initial-branch=main"]);
  const snapshotService = new TaskSnapshotService({
    gitExecutable: "git",
    isolationDirectory: join(root, "user-data", "git-isolation"),
    snapshotsRoot: join(root, "user-data", "task-snapshots"),
    resolveProjectRoot: (requestedProjectId) =>
      projectService.getProjectRoot(requestedProjectId),
  });
  return {
    root,
    projectId: project.projectId,
    projectRoot: project.rootPath,
    projectService,
    snapshotService,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("AgentTaskStartService", () => {
  it("rejects project traversal input before resolving any registered path", async () => {
    const getProjectRoot = vi.fn();
    const createTaskSnapshot = vi.fn();
    const service = new AgentTaskStartService({
      projectService: { getProjectRoot },
      taskSnapshotService: {
        createTaskSnapshot,
        closeTaskSnapshot: vi.fn(),
      },
      capabilityService: { grant: vi.fn() },
      createId: () => taskId,
    });

    await expect(
      service.start({ ...request(), projectId: "../../outside" }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(getProjectRoot).not.toHaveBeenCalled();
    expect(createTaskSnapshot).not.toHaveBeenCalled();
  });

  it("revalidates the registered root and snapshots before granting authority", async () => {
    const fx = await fixture();
    const capabilityService = new AgentCapabilityService({
      now: () => Date.parse("2026-08-16T00:00:00.000Z"),
    });
    const getProjectRoot = vi.spyOn(fx.projectService, "getProjectRoot");
    const createSnapshot = vi.spyOn(fx.snapshotService, "createTaskSnapshot");
    const grantCapability = vi.spyOn(capabilityService, "grant");
    const service = new AgentTaskStartService({
      projectService: fx.projectService,
      taskSnapshotService: fx.snapshotService,
      capabilityService,
      createId: () => taskId,
    });
    const grantRequest = request(fx.projectId);

    const result = await service.start(grantRequest);

    expect(result.capability.taskId).toBe(taskId);
    expect(result.snapshot).toMatchObject({
      taskId,
      affectedPaths: [],
      status: "active",
    });
    expect(getProjectRoot).toHaveBeenCalledWith(fx.projectId);
    expect(createSnapshot).toHaveBeenCalledWith(fx.projectId, taskId);
    expect(grantCapability).toHaveBeenCalledWith(grantRequest, taskId);
    expect(createSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      grantCapability.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    await expect(
      fx.snapshotService.listRecoveries(fx.projectId),
    ).resolves.toEqual([expect.objectContaining({ taskId })]);
  });

  it("does not grant authority when the project is not a Git repository", async () => {
    const fx = await fixture();
    await rm(join(fx.projectRoot, ".git"), { recursive: true, force: true });
    const capabilityService = new AgentCapabilityService({});
    const service = new AgentTaskStartService({
      projectService: fx.projectService,
      taskSnapshotService: fx.snapshotService,
      capabilityService,
      createId: () => taskId,
    });
    const grantRequest = request(fx.projectId);

    await expect(service.start(grantRequest)).rejects.toBeInstanceOf(Error);
    expect(() =>
      capabilityService.authorize({
        taskId,
        projectId: fx.projectId,
        tool: "mcp__author_copilot__grep",
      }),
    ).toThrow(expect.objectContaining({ code: "task_not_found" }));
  });

  it.skipIf(process.platform === "win32")(
    "rejects a registered root replaced by a symbolic link before snapshotting",
    async () => {
      const fx = await fixture();
      const movedRoot = `${fx.projectRoot}-moved`;
      await rename(fx.projectRoot, movedRoot);
      await symlink(movedRoot, fx.projectRoot, "dir");
      const capabilityService = new AgentCapabilityService({});
      const createSnapshot = vi.spyOn(fx.snapshotService, "createTaskSnapshot");
      const service = new AgentTaskStartService({
        projectService: fx.projectService,
        taskSnapshotService: fx.snapshotService,
        capabilityService,
        createId: () => taskId,
      });
      const grantRequest = request(fx.projectId);

      await expect(service.start(grantRequest)).rejects.toBeInstanceOf(
        InvalidProjectPathError,
      );
      expect(createSnapshot).not.toHaveBeenCalled();
    },
  );

  it("removes an empty snapshot if capability issuance fails", async () => {
    const fx = await fixture();
    const capabilityService = new AgentCapabilityService({});
    const grantRequest = request(fx.projectId);
    capabilityService.grant(grantRequest, existingTaskId);
    const service = new AgentTaskStartService({
      projectService: fx.projectService,
      taskSnapshotService: fx.snapshotService,
      capabilityService,
      createId: () => taskId,
    });

    await expect(service.start(grantRequest)).rejects.toMatchObject({
      code: "task_active",
    });
    await expect(
      fx.snapshotService.listRecoveries(fx.projectId),
    ).resolves.toEqual([]);
  });

  it("keeps a failed cleanup visible and never grants the new capability", async () => {
    const capabilityService = new AgentCapabilityService({});
    const grantRequest = request();
    capabilityService.grant(grantRequest, existingTaskId);
    const service = new AgentTaskStartService({
      projectService: { getProjectRoot: async () => realpath(tmpdir()) },
      taskSnapshotService: {
        createTaskSnapshot: async () => ({
          taskId,
          createdAt: "2026-08-16T00:00:00.000Z",
          affectedPaths: [],
          status: "active",
        }),
        closeTaskSnapshot: async () => {
          throw new Error("cleanup failed");
        },
      },
      capabilityService,
      createId: () => taskId,
    });

    await expect(service.start(grantRequest)).rejects.toBeInstanceOf(
      AgentTaskStartError,
    );
    expect(() =>
      capabilityService.authorize({
        taskId,
        projectId,
        tool: "mcp__author_copilot__grep",
      }),
    ).toThrow(expect.objectContaining({ code: "task_not_found" }));
  });
});
