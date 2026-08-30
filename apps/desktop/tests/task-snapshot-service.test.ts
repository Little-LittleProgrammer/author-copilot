import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { TaskSnapshotService } from "../src/main/git/task-snapshot-service.js";
import type { TaskSnapshotError } from "../src/main/git/task-snapshot-service.js";

const execFileAsync = promisify(execFile);
const projectId = "10000000-0000-4000-8000-000000000001";
const temporaryRoots: string[] = [];

interface Fixture {
  readonly projectRoot: string;
  readonly service: TaskSnapshotService;
  readonly taskId: string;
}

async function git(repoRoot: string, args: readonly string[]): Promise<Buffer> {
  const result = await execFileAsync("git", ["-C", repoRoot, ...args], {
    encoding: "buffer",
  });
  return result.stdout;
}

async function fixture(
  options: {
    readonly maxFileBytes?: number;
    readonly maxTaskBytes?: number;
  } = {},
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "author-copilot-task-snapshot-"));
  temporaryRoots.push(root);
  const projectPath = join(root, "project with spaces 中文");
  await mkdir(projectPath, { recursive: true });
  const projectRoot = await realpath(projectPath);
  await execFileAsync("git", ["init", "--initial-branch=main", projectRoot]);
  await git(projectRoot, ["config", "user.name", "Author Copilot Test"]);
  await git(projectRoot, [
    "config",
    "user.email",
    "test@author-copilot.invalid",
  ]);
  return {
    projectRoot,
    taskId: randomUUID(),
    service: new TaskSnapshotService({
      gitExecutable: "git",
      isolationDirectory: join(root, "application-data", "git-isolation"),
      snapshotsRoot: join(root, "application-data", "task-snapshots"),
      resolveProjectRoot: async (requestedProjectId) => {
        expect(requestedProjectId).toBe(projectId);
        return projectRoot;
      },
      ...options,
    }),
  };
}

async function commitFiles(
  projectRoot: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(projectRoot, relativePath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  await git(projectRoot, ["add", "."]);
  await git(projectRoot, ["commit", "-m", "baseline"]);
}

async function status(projectRoot: string): Promise<Buffer> {
  return git(projectRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("TaskSnapshotService", () => {
  it("restores the exact dirty task-start state without changing the index", async () => {
    const fx = await fixture();
    await commitFiles(fx.projectRoot, {
      "staged.md": "staged baseline\n",
      "unstaged.md": "unstaged baseline\n",
      "mixed.md": "mixed baseline\n",
      "delete-me.md": "tracked baseline\n",
    });
    await writeFile(join(fx.projectRoot, "staged.md"), "user staged\n");
    await git(fx.projectRoot, ["add", "staged.md"]);
    await writeFile(join(fx.projectRoot, "unstaged.md"), "user unstaged\n");
    await writeFile(join(fx.projectRoot, "mixed.md"), "user staged mixed\n");
    await git(fx.projectRoot, ["add", "mixed.md"]);
    await writeFile(
      join(fx.projectRoot, "mixed.md"),
      "user staged mixed\nuser unstaged mixed\n",
    );
    await writeFile(join(fx.projectRoot, "用户草稿.md"), "user untracked\n");
    const beforeStatus = await status(fx.projectRoot);
    const beforeCachedDiff = await git(fx.projectRoot, [
      "diff",
      "--cached",
      "--binary",
    ]);

    await fx.service.createTaskSnapshot(projectId, fx.taskId);
    await fx.service.writeTaskFile(
      projectId,
      fx.taskId,
      "staged.md",
      "user staged\nagent change\n",
    );
    await fx.service.writeTaskFile(
      projectId,
      fx.taskId,
      "unstaged.md",
      "user unstaged\nagent change\n",
    );
    await fx.service.writeTaskFile(
      projectId,
      fx.taskId,
      "mixed.md",
      "user staged mixed\nuser unstaged mixed\nagent change\n",
    );
    await fx.service.writeTaskFile(
      projectId,
      fx.taskId,
      "用户草稿.md",
      "user untracked\nagent change\n",
    );
    await fx.service.writeTaskFile(
      projectId,
      fx.taskId,
      "agent/new-file.md",
      "agent created\n",
    );
    await fx.service.deleteTaskFile(projectId, fx.taskId, "delete-me.md");

    const result = await fx.service.restoreTaskSnapshot(projectId, fx.taskId);

    expect(result.status).toBe("complete");
    expect(await status(fx.projectRoot)).toEqual(beforeStatus);
    expect(await git(fx.projectRoot, ["diff", "--cached", "--binary"])).toEqual(
      beforeCachedDiff,
    );
    await expect(
      readFile(join(fx.projectRoot, "agent/new-file.md")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(fx.projectRoot, "delete-me.md"), "utf8"),
    ).resolves.toBe("tracked baseline\n");
    await expect(lstat(join(fx.projectRoot, "agent"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("removes Agent edits while preserving a later non-overlapping user edit", async () => {
    const fx = await fixture();
    const middle = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    await commitFiles(fx.projectRoot, {
      "scene.md": `title\n${middle}ending\n`,
    });
    await writeFile(
      join(fx.projectRoot, "scene.md"),
      `title before task\n${middle}ending\n`,
    );
    await fx.service.createTaskSnapshot(projectId, fx.taskId);
    await fx.service.writeTaskFile(
      projectId,
      fx.taskId,
      "scene.md",
      `title before task\n${middle}agent ending\n`,
    );
    await writeFile(
      join(fx.projectRoot, "scene.md"),
      `title after agent\n${middle}agent ending\n`,
    );

    const result = await fx.service.restoreTaskSnapshot(projectId, fx.taskId);

    expect(result.status).toBe("complete");
    await expect(
      readFile(join(fx.projectRoot, "scene.md"), "utf8"),
    ).resolves.toBe(`title after agent\n${middle}ending\n`);
  });

  it("leaves overlapping edits untouched and supports an idempotent retry", async () => {
    const fx = await fixture();
    await commitFiles(fx.projectRoot, {
      "one.md": "one\n",
      "scene.md": "line\nending\n",
    });
    await fx.service.createTaskSnapshot(projectId, fx.taskId);
    await fx.service.writeTaskFile(
      projectId,
      fx.taskId,
      "one.md",
      "agent one\n",
    );
    await fx.service.writeTaskFile(
      projectId,
      fx.taskId,
      "scene.md",
      "line\nagent ending\n",
    );
    const userContent = "line\nuser ending\n";
    await writeFile(join(fx.projectRoot, "scene.md"), userContent);

    const partial = await fx.service.restoreTaskSnapshot(projectId, fx.taskId);

    expect(partial.status).toBe("partial");
    expect(partial.conflicts).toEqual([
      { path: "scene.md", reason: "overlapping_user_edit" },
    ]);
    await expect(
      readFile(join(fx.projectRoot, "scene.md"), "utf8"),
    ).resolves.toBe(userContent);
    await expect(
      readFile(join(fx.projectRoot, "one.md"), "utf8"),
    ).resolves.toBe("one\n");

    await writeFile(join(fx.projectRoot, "scene.md"), "line\nagent ending\n");
    const retried = await fx.service.restoreTaskSnapshot(projectId, fx.taskId);
    expect(retried.status).toBe("complete");
    expect(retried.alreadyRestoredPaths).not.toContain("one.md");
    await expect(
      readFile(join(fx.projectRoot, "scene.md"), "utf8"),
    ).resolves.toBe("line\nending\n");
  });

  it("blocks changed index entries and changed HEAD without modifying files", async () => {
    const indexFx = await fixture();
    await commitFiles(indexFx.projectRoot, { "scene.md": "baseline\n" });
    await indexFx.service.createTaskSnapshot(projectId, indexFx.taskId);
    await indexFx.service.writeTaskFile(
      projectId,
      indexFx.taskId,
      "scene.md",
      "agent\n",
    );
    await git(indexFx.projectRoot, ["add", "scene.md"]);
    const indexResult = await indexFx.service.restoreTaskSnapshot(
      projectId,
      indexFx.taskId,
    );
    expect(indexResult.conflicts).toEqual([
      { path: "scene.md", reason: "index_entry_changed" },
    ]);
    await expect(
      readFile(join(indexFx.projectRoot, "scene.md"), "utf8"),
    ).resolves.toBe("agent\n");

    const headFx = await fixture();
    await commitFiles(headFx.projectRoot, { "scene.md": "baseline\n" });
    await headFx.service.createTaskSnapshot(projectId, headFx.taskId);
    await headFx.service.writeTaskFile(
      projectId,
      headFx.taskId,
      "scene.md",
      "agent\n",
    );
    await writeFile(join(headFx.projectRoot, "user.md"), "user\n");
    await git(headFx.projectRoot, ["add", "user.md"]);
    await git(headFx.projectRoot, ["commit", "-m", "user commit"]);
    const headResult = await headFx.service.restoreTaskSnapshot(
      projectId,
      headFx.taskId,
    );
    expect(headResult.status).toBe("blocked");
    expect(headResult.conflicts).toEqual([
      { path: null, reason: "head_changed" },
    ]);
    await expect(
      readFile(join(headFx.projectRoot, "scene.md"), "utf8"),
    ).resolves.toBe("agent\n");
  });

  it("rejects paths outside the capability and enforces snapshot budgets", async () => {
    const fx = await fixture({ maxFileBytes: 8, maxTaskBytes: 16 });
    await commitFiles(fx.projectRoot, { "scene.md": "base\n" });
    await fx.service.createTaskSnapshot(projectId, fx.taskId);
    await expect(
      fx.service.writeTaskFile(projectId, fx.taskId, "../outside.md", "no"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<TaskSnapshotError>>({
        code: "unsafe_path",
      }),
    );
    await symlink(
      join(fx.projectRoot, "scene.md"),
      join(fx.projectRoot, "link.md"),
    );
    await expect(
      fx.service.writeTaskFile(projectId, fx.taskId, "link.md", "no"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<TaskSnapshotError>>({
        code: "unsafe_path",
      }),
    );
    for (const unsafePath of ["CON.md", ".git /config", "chapter.md:secret"]) {
      await expect(
        fx.service.writeTaskFile(projectId, fx.taskId, unsafePath, "no"),
      ).rejects.toEqual(
        expect.objectContaining<Partial<TaskSnapshotError>>({
          code: "unsafe_path",
        }),
      );
    }
    await expect(
      fx.service.writeTaskFile(projectId, fx.taskId, "large.md", "123456789"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<TaskSnapshotError>>({
        code: "budget_exceeded",
      }),
    );
  });

  it("allows only one open task snapshot per project", async () => {
    const fx = await fixture();
    await commitFiles(fx.projectRoot, { "scene.md": "base\n" });
    await fx.service.createTaskSnapshot(projectId, fx.taskId);
    await expect(fx.service.listRecoveries(projectId)).resolves.toEqual([
      expect.objectContaining({ taskId: fx.taskId, affectedPaths: [] }),
    ]);

    await expect(
      fx.service.createTaskSnapshot(projectId, randomUUID()),
    ).rejects.toEqual(
      expect.objectContaining<Partial<TaskSnapshotError>>({
        code: "task_conflict",
      }),
    );

    await expect(
      fx.service.restoreTaskSnapshot(projectId, fx.taskId),
    ).resolves.toMatchObject({ status: "complete" });
    await expect(fx.service.listRecoveries(projectId)).resolves.toEqual([]);
    await expect(
      fx.service.createTaskSnapshot(projectId, randomUUID()),
    ).resolves.toMatchObject({ affectedPaths: [] });
  });
});
