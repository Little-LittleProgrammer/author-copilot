import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentCapabilityService,
  NativeToolPolicy,
} from "../src/main/ai/agent/index.js";
import { TaskSnapshotService } from "../src/main/git/task-snapshot-service.js";
const roots: string[] = [];
async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "native-policy-"));
  roots.push(temporary);
  const root = await realpath(temporary);
  const project = join(root, "work");
  await mkdir(project);
  await promisify(execFile)("git", ["init", "--initial-branch=main", project]);
  const projectId = randomUUID(),
    taskId = randomUUID();
  const capabilities = new AgentCapabilityService({});
  const capability = capabilities.grant(
    {
      projectId,
      allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Skill"],
      readableFileTypes: ["markdown"],
      writableFileTypes: ["markdown"],
      timeoutMs: 60000,
    },
    taskId,
  );
  const snapshots = new TaskSnapshotService({
    gitExecutable: "git",
    isolationDirectory: join(root, "hooks-disabled"),
    snapshotsRoot: join(root, "snapshots"),
    resolveProjectRoot: async () => project,
  });
  await writeFile(join(project, "正文.md"), "雨夜。\n");
  await snapshots.createTaskSnapshot(projectId, taskId);
  const policy = new NativeToolPolicy({
    capabilityService: capabilities,
    capability,
    projectRoot: project,
    skills: ["read-outline"],
    skillReadRoots: [],
    snapshots,
  });
  const hook = async (
    event: "PreToolUse" | "PostToolUse" | "PostToolUseFailure",
    tool: string,
    input: Record<string, unknown>,
    id = "operation",
  ) => {
    const callback = policy.hooks()[event]![0]!.hooks[0]!;
    return callback(
      {
        hook_event_name: event,
        tool_name: tool,
        tool_input: input,
        tool_use_id: id,
        session_id: taskId,
        cwd: project,
        transcript_path: "",
      } as HookInput,
      id,
      { signal: new AbortController().signal },
    );
  };
  return {
    root,
    project,
    projectId,
    taskId,
    snapshots,
    policy,
    hook,
    capabilities,
  };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe("native tool workspace hooks", () => {
  it("records before execution, verifies native writes and restores only Agent changes", async () => {
    const fx = await fixture();
    const input = { file_path: join(fx.project, "正文.md") };
    await fx.hook("PreToolUse", "Read", input, "read");
    await fx.hook("PostToolUse", "Read", input, "read");
    const edit = { ...input, old_string: "雨夜", new_string: "清晨" };
    const allowed = await fx.hook("PreToolUse", "Edit", edit);
    expect(allowed).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    const before = await fx.snapshots.getTaskReview(fx.projectId, fx.taskId);
    expect(before.review.files).toEqual([
      expect.objectContaining({
        path: "正文.md",
        before: "雨夜。\n",
        after: "雨夜。\n",
      }),
    ]);
    await writeFile(input.file_path, "清晨。\n");
    await fx.hook("PostToolUse", "Edit", edit);
    expect(
      (await fx.snapshots.getTaskReview(fx.projectId, fx.taskId)).review.files,
    ).toEqual([
      expect.objectContaining({
        path: "正文.md",
        before: "雨夜。\n",
        after: "清晨。\n",
      }),
    ]);
    await fx.snapshots.restoreTaskSnapshot(fx.projectId, fx.taskId);
    expect(await readFile(input.file_path, "utf8")).toBe("雨夜。\n");
  });
  it("requires a fresh read and rejects outside paths, policies, shells and other skills", async () => {
    const fx = await fixture();
    expect(
      await fx.hook("PreToolUse", "Write", {
        file_path: "正文.md",
        content: "overwrite",
      }),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    for (const path of [
      join(fx.root, "other.md"),
      "../other.md",
      ".claude/settings.json",
      ".git/HEAD",
      "CLAUDE.md",
      "claude.md",
    ])
      expect(
        await fx.hook("PreToolUse", "Write", {
          file_path: path,
          content: "unsafe",
        }),
      ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(
      await fx.hook("PreToolUse", "Bash", { command: "cat ../other.md" }),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(
      await fx.hook("PreToolUse", "Skill", { skill: "compare-works" }),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    for (const pattern of ["../*.md", "/outside/**/*.md", "C:/outside/*.md"]) {
      expect(await fx.hook("PreToolUse", "Glob", { pattern })).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
    }
    await fx.hook("PreToolUse", "Read", { file_path: "正文.md" }, "read");
    await writeFile(join(fx.project, "正文.md"), "作者的新稿");
    await fx.hook("PostToolUse", "Read", { file_path: "正文.md" }, "read");
    expect(
      await fx.hook("PreToolUse", "Write", {
        file_path: "正文.md",
        content: "lost update",
      }),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(await readFile(join(fx.project, "正文.md"), "utf8")).toBe(
      "作者的新稿",
    );
  });
  it("retains a prepared mutation across missing post hooks and recovers a new file", async () => {
    const fx = await fixture();
    const input = { file_path: "新章.md", content: "新正文" };
    expect(await fx.hook("PreToolUse", "Write", input)).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    await writeFile(join(fx.project, "新章.md"), input.content);
    await fx.policy.drain();
    await fx.snapshots.restoreTaskSnapshot(fx.projectId, fx.taskId);
    await expect(readFile(join(fx.project, "新章.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it.skipIf(process.platform === "win32")(
    "rejects symlink escapes",
    async () => {
      const fx = await fixture();
      await writeFile(join(fx.root, "secret.md"), "secret");
      await symlink(join(fx.root, "secret.md"), join(fx.project, "link.md"));
      expect(
        await fx.hook("PreToolUse", "Read", { file_path: "link.md" }),
      ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      expect(
        await fx.hook("PreToolUse", "Grep", { pattern: "secret", path: "." }),
      ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    },
  );
});
