import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fileUtils from "../src/main/project/file-utils.js";
import { ProjectService, RegistryStore } from "../src/main/project/index.js";
import { GitService } from "../src/main/git/git-service.js";

const exec = promisify(execFile);
const roots: string[] = [];
const path = "第一卷/第一章/01-正文.md";
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "writing-safety-")));
  roots.push(root);
  const service = new ProjectService({
    registry: new RegistryStore(join(root, "runtime")),
  });
  const project = await service.createProject("安全测试", "novel");
  const baseHash = (await service.readDocument(project.projectId, path)).hash;
  const put = (content: string, revision = randomUUID()) =>
    service.draft({
      action: "put",
      projectId: project.projectId,
      relativePath: path,
      baseHash,
      content,
      revision,
    });
  return { root, service, project, baseHash, put };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("writing safety", () => {
  it("clears a redundant draft after the manuscript saved but before cleanup completed", async () => {
    const { project, put, service, baseHash } = await fixture();
    await put("保存完成内容");
    await service.saveDocument(
      project.projectId,
      path,
      "保存完成内容",
      baseHash,
    );
    expect(
      await service.draft({ action: "list", projectId: project.projectId }),
    ).toEqual([]);
  });

  it("keeps the previous durable draft if a later disk write fails", async () => {
    const { project, put, service } = await fixture();
    await put("可恢复内容");
    vi.spyOn(fileUtils, "atomicWriteFile").mockRejectedValueOnce(
      Object.assign(new Error("disk full"), { code: "ENOSPC" }),
    );
    await expect(put("写入失败内容")).rejects.toThrow("disk full");
    expect(
      await service.draft({ action: "list", projectId: project.projectId }),
    ).toMatchObject([{ content: "可恢复内容" }]);
  });

  it("persists drafts across restart and ignores stale cleanup after newer input", async () => {
    const { root, project, put, service } = await fixture();
    const [first] = await put("第一份草稿");
    const [latest] = await put("最新草稿");
    await service.draft({
      action: "delete",
      projectId: project.projectId,
      relativePath: path,
      revision: first!.revision,
    });
    const restarted = new ProjectService({
      registry: new RegistryStore(join(root, "runtime")),
    });
    expect(
      await restarted.draft({ action: "list", projectId: project.projectId }),
    ).toEqual([latest]);
    expect(
      (await restarted.readDocument(project.projectId, path)).content,
    ).toBe("");
    await restarted.draft({
      action: "delete",
      projectId: project.projectId,
      relativePath: path,
      revision: latest!.revision,
    });
    expect(
      await restarted.draft({ action: "list", projectId: project.projectId }),
    ).toEqual([]);
  });

  it("keeps conflict drafts and missing-source drafts without overwriting manuscript", async () => {
    const { project, put, service } = await fixture();
    await put("未保存输入");
    await writeFile(join(project.rootPath, path), "外部改稿");
    expect(
      (await service.draft({ action: "list", projectId: project.projectId }))[0]
        ?.content,
    ).toBe("未保存输入");
    expect((await service.readDocument(project.projectId, path)).content).toBe(
      "外部改稿",
    );
    await rm(join(project.rootPath, path));
    expect(
      await service.draft({ action: "list", projectId: project.projectId }),
    ).toHaveLength(1);
  });

  it("backs up assets, Skills, Git history, branches and drafts, then restores an independent work", async () => {
    const { root, project, put, service, baseHash } = await fixture();
    await mkdir(join(project.rootPath, "创作资产"));
    await writeFile(join(project.rootPath, "创作资产/资料.md"), "人物设定");
    await mkdir(join(project.rootPath, ".claude/skills/voice"), {
      recursive: true,
    });
    await writeFile(
      join(project.rootPath, ".claude/skills/voice/SKILL.md"),
      "作者文风",
    );
    await service.saveDocument(project.projectId, path, "基线正文", baseHash);
    const git = new GitService({
      gitExecutable: "git",
      hooksDirectory: join(root, "hooks"),
      resolveProjectRoot: async () => project.rootPath,
    });
    await git.createVersion(project.projectId, "基线");
    await exec("git", ["-C", project.rootPath, "branch", "alternate"]);
    const head = (
      await exec("git", ["-C", project.rootPath, "rev-parse", "HEAD"])
    ).stdout;
    await put("备份中的草稿");
    const backups = join(root, "backups");
    await mkdir(backups);
    const result = await service.backupProject(project.projectId, backups);
    const source = join(backups, result.directoryName);
    const restored = await service.confirmImport({
      rootPath: source,
      template: "novel",
    });
    expect(restored.projectId).not.toBe(project.projectId);
    expect((await service.readDocument(restored.projectId, path)).content).toBe(
      "基线正文",
    );
    expect(
      await readFile(join(restored.rootPath, "创作资产/资料.md"), "utf8"),
    ).toBe("人物设定");
    expect(
      await readFile(
        join(restored.rootPath, ".claude/skills/voice/SKILL.md"),
        "utf8",
      ),
    ).toBe("作者文风");
    expect(
      (await exec("git", ["-C", restored.rootPath, "rev-parse", "HEAD"]))
        .stdout,
    ).toBe(head);
    expect(
      (
        await exec("git", [
          "-C",
          restored.rootPath,
          "branch",
          "--list",
          "alternate",
        ])
      ).stdout,
    ).toContain("alternate");
    expect(
      await service.draft({ action: "list", projectId: restored.projectId }),
    ).toMatchObject([
      { projectId: restored.projectId, content: "备份中的草稿" },
    ]);
    await expect(
      service.backupProject(project.projectId, restored.rootPath),
    ).rejects.toThrow();
    expect(
      (await service.backupProject(project.projectId, backups)).directoryName,
    ).not.toBe(result.directoryName);
    await writeFile(join(source, path), "损坏的备份");
    await expect(
      service.confirmImport({ rootPath: source, template: "novel" }),
    ).rejects.toThrow("incomplete or changed");
    expect(await service.list()).toHaveLength(2);
  });

  it("rejects redirected backup content without leaving a completed backup", async () => {
    const { root, project, service } = await fixture();
    await symlink(
      join(root, "runtime"),
      join(project.rootPath, "outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const backups = join(root, "backups");
    await mkdir(backups);
    await expect(
      service.backupProject(project.projectId, backups),
    ).rejects.toThrow();
    expect(await readdir(backups)).toEqual([]);
  });
});
