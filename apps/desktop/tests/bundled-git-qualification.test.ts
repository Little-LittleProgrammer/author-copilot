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

import { afterEach, describe, expect, it } from "vitest";

import { GitService, TaskSnapshotService } from "../src/main/git/index.js";
import { resolveGitRuntime } from "../src/main/git-runtime.js";

const execFileAsync = promisify(execFile);
const projectId = "10000000-0000-4000-8000-000000000001";
const temporaryRoots: string[] = [];
const resourcesPath =
  process.env.AUTHOR_COPILOT_TEST_GIT_RESOURCES_PATH?.trim();
const gitRuntime = resolveGitRuntime({
  arch: process.arch,
  isPackaged: resourcesPath !== undefined && resourcesPath.length > 0,
  platform: process.platform,
  resourcesPath: resourcesPath || process.cwd(),
});
const gitEnvironment = {
  ...process.env,
  ...gitRuntime.environment,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

async function git(repoRoot: string, args: readonly string[]): Promise<Buffer> {
  const result = await execFileAsync(
    gitRuntime.executable,
    ["-C", repoRoot, ...args],
    { encoding: "buffer", env: gitEnvironment },
  );
  return result.stdout;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), "author-copilot-bundled-git-qualification-"),
  );
  temporaryRoots.push(root);
  return root;
}

async function initializeRepository(projectRoot: string): Promise<void> {
  await mkdir(projectRoot, { recursive: true });
  await git(projectRoot, ["init", "--initial-branch=main"]);
  await git(projectRoot, ["config", "user.name", "Author Copilot Test"]);
  await git(projectRoot, [
    "config",
    "user.email",
    "test@author-copilot.invalid",
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bundled Git production service qualification", () => {
  it("creates versions and switches exact local branches", async () => {
    const root = await temporaryRoot();
    const projectPath = join(root, "branch project 中文");
    await mkdir(projectPath, { recursive: true });
    const projectRoot = await realpath(projectPath);
    const documentPath = join(projectRoot, "第一章.md");
    await writeFile(documentPath, "main\n", "utf8");
    const service = new GitService({
      gitExecutable: gitRuntime.executable,
      hooksDirectory: join(root, "git-isolation"),
      resolveProjectRoot: async () => projectRoot,
      runtimeEnvironment: gitRuntime.environment,
    });

    await expect(
      service.createVersion(projectId, "main version"),
    ).resolves.toMatchObject({ created: true });
    await git(projectRoot, ["switch", "-c", "备选-结局"]);
    await writeFile(documentPath, "alternate\n", "utf8");
    await git(projectRoot, ["add", "--all"]);
    await git(projectRoot, ["commit", "-m", "alternate version"]);
    await git(projectRoot, ["switch", "main"]);

    await expect(service.listBranches(projectId)).resolves.toEqual({
      currentBranch: "main",
      branches: [
        { name: "main", current: true },
        { name: "备选-结局", current: false },
      ],
    });
    await expect(service.switchBranch(projectId, "备选-结局")).resolves.toEqual(
      {
        branchName: "备选-结局",
        switched: true,
      },
    );
    await expect(readFile(documentPath, "utf8")).resolves.toBe("alternate\n");

    await writeFile(join(projectRoot, "dirty.md"), "unsaved\n", "utf8");
    await expect(service.switchBranch(projectId, "main")).rejects.toMatchObject(
      {
        code: "dirty_repository",
      },
    );
    await expect(
      git(projectRoot, ["branch", "--show-current"]),
    ).resolves.toEqual(Buffer.from("备选-结局\n"));
  });

  it("restores Agent mutations to the exact dirty task-start state", async () => {
    const root = await temporaryRoot();
    const projectPath = join(root, "recovery project 中文");
    await initializeRepository(projectPath);
    const projectRoot = await realpath(projectPath);
    await writeFile(join(projectRoot, "staged.md"), "baseline\n", "utf8");
    await writeFile(join(projectRoot, "delete-me.md"), "keep me\n", "utf8");
    await git(projectRoot, ["add", "--all"]);
    await git(projectRoot, ["commit", "-m", "baseline"]);
    await writeFile(join(projectRoot, "staged.md"), "user staged\n", "utf8");
    await git(projectRoot, ["add", "staged.md"]);
    await writeFile(
      join(projectRoot, "用户草稿.md"),
      "user untracked\n",
      "utf8",
    );
    const beforeStatus = await git(projectRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const beforeIndex = await git(projectRoot, [
      "diff",
      "--cached",
      "--binary",
    ]);
    const taskId = randomUUID();
    const service = new TaskSnapshotService({
      gitExecutable: gitRuntime.executable,
      isolationDirectory: join(root, "git-isolation"),
      snapshotsRoot: join(root, "task-snapshots"),
      resolveProjectRoot: async () => projectRoot,
      runtimeEnvironment: gitRuntime.environment,
    });

    await service.createTaskSnapshot(projectId, taskId);
    await service.writeTaskFile(
      projectId,
      taskId,
      "staged.md",
      "user staged\nagent change\n",
    );
    await service.writeTaskFile(
      projectId,
      taskId,
      "用户草稿.md",
      "user untracked\nagent change\n",
    );
    await service.writeTaskFile(
      projectId,
      taskId,
      "agent/new.md",
      "agent created\n",
    );
    await service.deleteTaskFile(projectId, taskId, "delete-me.md");

    await expect(
      service.restoreTaskSnapshot(projectId, taskId),
    ).resolves.toMatchObject({
      status: "complete",
      conflicts: [],
      failures: [],
    });
    await expect(
      git(projectRoot, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
    ).resolves.toEqual(beforeStatus);
    await expect(
      git(projectRoot, ["diff", "--cached", "--binary"]),
    ).resolves.toEqual(beforeIndex);
    await expect(
      readFile(join(projectRoot, "staged.md"), "utf8"),
    ).resolves.toBe("user staged\n");
    await expect(
      readFile(join(projectRoot, "用户草稿.md"), "utf8"),
    ).resolves.toBe("user untracked\n");
    await expect(
      readFile(join(projectRoot, "delete-me.md"), "utf8"),
    ).resolves.toBe("keep me\n");
    await expect(
      readFile(join(projectRoot, "agent/new.md")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
