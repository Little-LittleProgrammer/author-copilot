import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  agentDelete,
  agentWrite,
  createTaskSnapshot,
  readTaskSnapshot,
  restoreTaskSnapshot,
} from "./rollback.mjs";

function git(repoRoot, args) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: null,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString("utf8"));
  }
  return result.stdout;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "author-copilot-dirty-repo-"));
  const repoRoot = path.join(root, "project with spaces 中文");
  const snapshotDir = path.join(root, "application-data", "task-1");
  await mkdir(repoRoot, { recursive: true });
  git(repoRoot, ["init", "-q"]);
  git(repoRoot, ["config", "user.name", "Author Copilot Test"]);
  git(repoRoot, ["config", "user.email", "test@author-copilot.invalid"]);
  return {
    root,
    repoRoot,
    snapshotDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function commitFiles(repoRoot, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-qm", "baseline"]);
}

function status(repoRoot) {
  return git(repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
}

test("restores exact staged, unstaged, mixed, and untracked task-start state", async () => {
  const fx = await fixture();
  try {
    await commitFiles(fx.repoRoot, {
      "staged.md": "staged baseline\n",
      "unstaged.md": "unstaged baseline\n",
      "mixed.md": "mixed baseline\n",
      "delete-me.md": "tracked baseline\n",
    });

    await writeFile(path.join(fx.repoRoot, "staged.md"), "user staged\n");
    git(fx.repoRoot, ["add", "staged.md"]);
    await writeFile(path.join(fx.repoRoot, "unstaged.md"), "user unstaged\n");
    await writeFile(path.join(fx.repoRoot, "mixed.md"), "user staged mixed\n");
    git(fx.repoRoot, ["add", "mixed.md"]);
    await writeFile(
      path.join(fx.repoRoot, "mixed.md"),
      "user staged mixed\nuser unstaged mixed\n",
    );
    await writeFile(path.join(fx.repoRoot, "用户草稿.md"), "user untracked\n");

    const beforeStatus = status(fx.repoRoot);
    const beforeCachedDiff = git(fx.repoRoot, ["diff", "--cached", "--binary"]);
    const snapshot = await createTaskSnapshot(fx);
    assert.deepEqual(snapshot.baselineStatus.staged.sort(), [
      "mixed.md",
      "staged.md",
    ]);
    assert.deepEqual(snapshot.baselineStatus.unstaged.sort(), [
      "mixed.md",
      "unstaged.md",
    ]);
    assert.deepEqual(snapshot.baselineStatus.untracked, ["用户草稿.md"]);

    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "staged.md",
      content: "user staged\nagent change\n",
    });
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "unstaged.md",
      content: "user unstaged\nagent change\n",
    });
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "mixed.md",
      content: "user staged mixed\nuser unstaged mixed\nagent change\n",
    });
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "用户草稿.md",
      content: "user untracked\nagent change\n",
    });
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "agent/new-file.md",
      content: "agent created\n",
    });
    await agentDelete({
      snapshotDir: fx.snapshotDir,
      relativePath: "delete-me.md",
    });

    const restored = await restoreTaskSnapshot({ snapshotDir: fx.snapshotDir });
    assert.equal(restored.status, "complete");
    assert.deepEqual(status(fx.repoRoot), beforeStatus);
    assert.deepEqual(
      git(fx.repoRoot, ["diff", "--cached", "--binary"]),
      beforeCachedDiff,
    );
    assert.equal(
      await readFile(path.join(fx.repoRoot, "staged.md"), "utf8"),
      "user staged\n",
    );
    assert.equal(
      await readFile(path.join(fx.repoRoot, "unstaged.md"), "utf8"),
      "user unstaged\n",
    );
    assert.equal(
      await readFile(path.join(fx.repoRoot, "mixed.md"), "utf8"),
      "user staged mixed\nuser unstaged mixed\n",
    );
    await assert.rejects(
      readFile(path.join(fx.repoRoot, "agent/new-file.md")),
      /ENOENT/,
    );
    assert.equal(
      await readFile(path.join(fx.repoRoot, "delete-me.md"), "utf8"),
      "tracked baseline\n",
    );
  } finally {
    await fx.cleanup();
  }
});

test("removes Agent edits while preserving non-overlapping user edits on the same file", async () => {
  const fx = await fixture();
  try {
    await commitFiles(fx.repoRoot, {
      "scene.md": "title\nmiddle\nending\n",
    });
    await writeFile(
      path.join(fx.repoRoot, "scene.md"),
      "title from user before task\nmiddle\nending\n",
    );
    await createTaskSnapshot(fx);
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "scene.md",
      content: "title from user before task\nmiddle\nending from agent\n",
    });
    await writeFile(
      path.join(fx.repoRoot, "scene.md"),
      "title from user after agent\nmiddle\nending from agent\n",
    );

    const restored = await restoreTaskSnapshot({ snapshotDir: fx.snapshotDir });
    assert.equal(restored.status, "complete");
    assert.equal(
      await readFile(path.join(fx.repoRoot, "scene.md"), "utf8"),
      "title from user after agent\nmiddle\nending\n",
    );
  } finally {
    await fx.cleanup();
  }
});

test("leaves overlapping same-file edits untouched and reports a conflict", async () => {
  const fx = await fixture();
  try {
    await commitFiles(fx.repoRoot, { "scene.md": "line\nending\n" });
    await createTaskSnapshot(fx);
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "scene.md",
      content: "line\nagent ending\n",
    });
    const userContent = "line\nuser ending\n";
    await writeFile(path.join(fx.repoRoot, "scene.md"), userContent);

    const restored = await restoreTaskSnapshot({ snapshotDir: fx.snapshotDir });
    assert.equal(restored.status, "partial");
    assert.equal(restored.conflicts[0].reason, "overlapping-user-edit");
    assert.equal(
      await readFile(path.join(fx.repoRoot, "scene.md"), "utf8"),
      userContent,
    );
  } finally {
    await fx.cleanup();
  }
});

test("does not overwrite an index entry changed during the Agent task", async () => {
  const fx = await fixture();
  try {
    await commitFiles(fx.repoRoot, { "scene.md": "baseline\n" });
    await createTaskSnapshot(fx);
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "scene.md",
      content: "agent\n",
    });
    git(fx.repoRoot, ["add", "scene.md"]);
    const staged = git(fx.repoRoot, ["show", ":scene.md"]);

    const restored = await restoreTaskSnapshot({ snapshotDir: fx.snapshotDir });
    assert.equal(restored.status, "partial");
    assert.equal(restored.conflicts[0].reason, "index-entry-changed");
    assert.deepEqual(git(fx.repoRoot, ["show", ":scene.md"]), staged);
    assert.equal(
      await readFile(path.join(fx.repoRoot, "scene.md"), "utf8"),
      "agent\n",
    );
  } finally {
    await fx.cleanup();
  }
});

test("persists per-mutation progress so a partial restore can be retried", async () => {
  const fx = await fixture();
  try {
    await commitFiles(fx.repoRoot, { "one.md": "one\n", "two.md": "two\n" });
    await createTaskSnapshot(fx);
    const first = await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "one.md",
      content: "agent one\n",
    });
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "two.md",
      content: "agent two\n",
    });

    const partial = await restoreTaskSnapshot({
      snapshotDir: fx.snapshotDir,
      beforeApply: ({ mutation }) => {
        if (mutation.id === first.id) throw new Error("injected disk failure");
      },
    });
    assert.equal(partial.status, "partial");
    assert.equal(
      await readFile(path.join(fx.repoRoot, "one.md"), "utf8"),
      "agent one\n",
    );
    assert.equal(
      await readFile(path.join(fx.repoRoot, "two.md"), "utf8"),
      "two\n",
    );

    const retried = await restoreTaskSnapshot({ snapshotDir: fx.snapshotDir });
    assert.equal(retried.status, "complete");
    assert.equal(
      await readFile(path.join(fx.repoRoot, "one.md"), "utf8"),
      "one\n",
    );
    const manifest = await readTaskSnapshot(fx.snapshotDir);
    assert.ok(
      manifest.mutations.every((mutation) => mutation.state === "restored"),
    );
  } finally {
    await fx.cleanup();
  }
});

test("a write-ahead prepared mutation is recoverable after a pre-write failure", async () => {
  const fx = await fixture();
  try {
    await commitFiles(fx.repoRoot, { "scene.md": "baseline\n" });
    await createTaskSnapshot(fx);
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "scene.md",
      content: "agent\n",
      failAfterPrepare: true,
    });

    const restored = await restoreTaskSnapshot({ snapshotDir: fx.snapshotDir });
    assert.equal(restored.status, "complete");
    assert.deepEqual(restored.alreadyRestored, ["scene.md"]);
    assert.equal(
      await readFile(path.join(fx.repoRoot, "scene.md"), "utf8"),
      "baseline\n",
    );
  } finally {
    await fx.cleanup();
  }
});

test("blocks automatic restore when HEAD changes during the task", async () => {
  const fx = await fixture();
  try {
    await commitFiles(fx.repoRoot, { "scene.md": "baseline\n" });
    await createTaskSnapshot(fx);
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "scene.md",
      content: "agent\n",
    });
    await writeFile(path.join(fx.repoRoot, "user-commit.md"), "user commit\n");
    git(fx.repoRoot, ["add", "user-commit.md"]);
    git(fx.repoRoot, ["commit", "-qm", "user commit"]);

    const restored = await restoreTaskSnapshot({ snapshotDir: fx.snapshotDir });
    assert.equal(restored.status, "blocked");
    assert.equal(restored.conflicts[0].reason, "head-changed");
    assert.equal(
      await readFile(path.join(fx.repoRoot, "scene.md"), "utf8"),
      "agent\n",
    );
  } finally {
    await fx.cleanup();
  }
});

test("preserves a user-modified Agent-created file and reports ambiguity", async () => {
  const fx = await fixture();
  try {
    await commitFiles(fx.repoRoot, { "baseline.md": "baseline\n" });
    await createTaskSnapshot(fx);
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "new-scene.md",
      content: "agent draft\n",
    });
    const userContent = "agent draft\nuser continuation\n";
    await writeFile(path.join(fx.repoRoot, "new-scene.md"), userContent);

    const restored = await restoreTaskSnapshot({ snapshotDir: fx.snapshotDir });
    assert.equal(restored.status, "partial");
    assert.equal(
      restored.conflicts[0].reason,
      "create-delete-concurrent-change",
    );
    assert.equal(
      await readFile(path.join(fx.repoRoot, "new-scene.md"), "utf8"),
      userContent,
    );
  } finally {
    await fx.cleanup();
  }
});

test("reverses multiple Agent writes around an interleaved user edit", async () => {
  const fx = await fixture();
  try {
    const middle = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    await commitFiles(fx.repoRoot, { "scene.md": `title\n${middle}ending\n` });
    await createTaskSnapshot(fx);
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "scene.md",
      content: `title\n${middle}agent ending one\n`,
    });
    await writeFile(
      path.join(fx.repoRoot, "scene.md"),
      `user title\n${middle}agent ending one\n`,
    );
    await agentWrite({
      snapshotDir: fx.snapshotDir,
      relativePath: "scene.md",
      content: `user title\n${middle}agent ending two\n`,
    });

    const restored = await restoreTaskSnapshot({ snapshotDir: fx.snapshotDir });
    assert.equal(restored.status, "complete");
    assert.equal(
      await readFile(path.join(fx.repoRoot, "scene.md"), "utf8"),
      `user title\n${middle}ending\n`,
    );
  } finally {
    await fx.cleanup();
  }
});
