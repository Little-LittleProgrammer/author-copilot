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

import { afterEach, describe, expect, it } from "vitest";

import { ProjectService, RegistryStore } from "../src/main/project/index.js";

const roots: string[] = [];
const body = "第一卷/第一章/01-正文.md";

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "managed-workspace-"));
  roots.push(base);
  const userData = join(base, "用户数据");
  const registry = new RegistryStore(userData);
  const projects = new ProjectService({ registry });
  return { base, userData, registry, projects };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("managed workspaces", () => {
  it("preserves published works and imports when the derived catalog cannot be refreshed", async () => {
    const { base, registry } = await fixture();
    const projects = new ProjectService({
      registry,
      onRegistryChanged: async () => {
        throw new Error("catalog unavailable");
      },
    });
    const created = await projects.createProject("新作品", "novel");
    expect((await registry.get(created.projectId))?.rootPath).toBe(
      created.rootPath,
    );
    expect((await projects.readDocument(created.projectId, body)).content).toBe(
      "",
    );
    const source = join(base, "source");
    await mkdir(source);
    await writeFile(join(source, "笔记.md"), "导入内容");
    const imported = await projects.confirmImport({
      rootPath: source,
      template: "novel",
    });
    expect(
      (await projects.readDocument(imported.projectId, "笔记.md")).content,
    ).toBe("导入内容");
    expect(await readFile(join(source, "笔记.md"), "utf8")).toBe("导入内容");
  });
  it("keeps same-title works in separate folders and preserves their paths after renaming and restart", async () => {
    const { userData, projects } = await fixture();
    const first = await projects.createProject("同名作品", "novel");
    const second = await projects.createProject("同名作品", "novel");
    expect(first.rootPath).toBe(
      join(await realpath(userData), "projects", first.projectId),
    );
    expect(second.rootPath).toBe(
      join(await realpath(userData), "projects", second.projectId),
    );
    const before = await projects.readDocument(first.projectId, body);
    await projects.saveDocument(
      first.projectId,
      body,
      "第一部作品",
      before.hash,
    );
    await projects.updateProjectTitle(first.projectId, "新标题");
    const restarted = new ProjectService({
      registry: new RegistryStore(userData),
    });
    expect(await restarted.getProjectRoot(first.projectId)).toBe(
      first.rootPath,
    );
    expect((await restarted.readDocument(first.projectId, body)).content).toBe(
      "第一部作品",
    );
    expect((await restarted.readDocument(second.projectId, body)).content).toBe(
      "",
    );
  });

  it("rejects a registry entry redirected to another work", async () => {
    const { base, registry, projects } = await fixture();
    const first = await projects.createProject("作品一", "novel");
    const second = await projects.createProject("作品二", "novel");
    const otherData = new RegistryStore(join(base, "forged-registry"));
    await otherData.register({ ...first, rootPath: second.rootPath });
    // Simulate a changed registry after startup, bypassing RegistryStore's
    // duplicate-root validation to exercise the read boundary itself.
    await writeFile(
      registry.registryPath,
      await readFile(otherData.registryPath),
    );
    await expect(projects.getProjectRoot(first.projectId)).rejects.toThrow(
      "registered project root",
    );
    await expect(projects.readDocument(first.projectId, body)).rejects.toThrow(
      "registered project root",
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlink redirecting managed storage",
    async () => {
      const { base, userData, projects } = await fixture();
      await mkdir(userData);
      const outside = join(base, "outside");
      await mkdir(outside);
      await symlink(outside, join(userData, "projects"));
      await expect(projects.createProject("作品", "novel")).rejects.toThrow(
        "symbolic link",
      );
      expect(await readdir(outside)).toEqual([]);
    },
  );
});
