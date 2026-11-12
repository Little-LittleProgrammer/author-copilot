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
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceService } from "../src/main/workspace/workspace-service.js";
import { ProjectService, RegistryStore } from "../src/main/project/index.js";
import { CreativeNotesService } from "../src/main/creative-notes/creative-notes-service.js";
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "workspaces-"));
  roots.push(root);
  const workspace = new WorkspaceService(root);
  await workspace.selectIdentity("local");
  const projects: ProjectService = new ProjectService({
    registry: new RegistryStore(() => workspace.runtime("registry")),
    projectsRoot: () => workspace.projectsRoot,
    initializeProject: (path, title) =>
      workspace.initializeProject(path, title),
    onRegistryChanged: async () =>
      workspace.publishCatalog(await projects.list()),
  });
  return { root: await realpath(root), workspace, projects };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe("account and work workspaces", () => {
  it("isolates identities, catalogs and persistent runtime paths without migration", async () => {
    const { root, workspace, projects } = await fixture();
    const local = await projects.createProject("本地作品", "novel");
    expect(local.rootPath).toBe(
      join(root, "accounts", "local", "workspace", "projects", local.projectId),
    );
    expect(
      JSON.parse(await readFile(join(workspace.root, "projects.json"), "utf8")),
    ).toEqual([
      expect.objectContaining({
        title: "本地作品",
        path: `projects/${local.projectId}`,
      }),
    ]);
    const config = workspace.configDirectory;
    const historyPath = workspace.runtime("global-assistant.json");
    await workspace.selectIdentity("10000000-0000-4000-8000-000000000001");
    expect(await projects.list()).toEqual([]);
    await expect(projects.getProjectRoot(local.projectId)).rejects.toThrow(
      "not registered",
    );
    expect(workspace.configDirectory).not.toBe(config);
    expect(workspace.runtime("global-assistant.json")).not.toBe(historyPath);
    await projects.createProject("账号作品", "novel");
    await workspace.selectIdentity("local");
    expect(
      (await projects.list()).map((project) => project.metadata.title),
    ).toEqual(["本地作品"]);
    expect(workspace.configDirectory).toBe(config);
    await expect(workspace.selectIdentity("../../outside")).rejects.toThrow();
  });
  it("loads scenario-specific skills and uses the work override without granting the parent folder", async () => {
    const { workspace, projects } = await fixture();
    const work = await projects.createProject("我的作品", "novel");
    const global = await workspace.skills();
    expect(global.names).toContain("compare-works");
    const scoped = await workspace.skills(work.rootPath);
    expect(scoped.names).not.toContain("compare-works");
    expect(scoped.names).toEqual(
      expect.arrayContaining([
        "writing-techniques",
        "read-outline",
        "continue-story",
      ]),
    );
    const override = join(work.rootPath, ".claude", "skills", "read-outline");
    await mkdir(override, { recursive: true });
    await writeFile(
      join(override, "SKILL.md"),
      "---\nname: read-outline\ndescription: Use this book's outline\n---\nCustom book guidance.\n",
    );
    const loaded = await workspace.skills(work.rootPath);
    expect(loaded.names.filter((name) => name === "read-outline")).toHaveLength(
      1,
    );
    expect(loaded.readRoots).toContain(override);
    expect(loaded.readRoots).not.toContain(
      join(workspace.configDirectory, "skills", "read-outline"),
    );
    await writeFile(
      join(override, "SKILL.md"),
      "---\nname: read-outline\nhooks:\n  PreToolUse: unsafe\n---\ntext",
    );
    await expect(workspace.skills(work.rootPath)).rejects.toThrow(
      "Executable Skill",
    );
  });
  it("stores creative assets in the work and detects native edits as version changes", async () => {
    const { projects } = await fixture();
    const work = await projects.createProject("资产", "novel");
    const notes = new CreativeNotesService((id) => projects.getProjectRoot(id));
    const note = await notes.create({
      projectId: work.projectId,
      kind: "outline",
      title: "大纲",
      content: "初见。",
    });
    const path = join(work.rootPath, "创作资产", "资料.md");
    const content = await readFile(path, "utf8");
    expect(content).toContain("初见。");
    await writeFile(path, content.replace("初见。", "重逢。"));
    const next = (await notes.list({ projectId: work.projectId }))[0]!;
    expect(next.content).toBe("重逢。");
    expect(next.updatedAt).not.toBe(note.updatedAt);
    await expect(
      notes.update({
        projectId: work.projectId,
        noteId: note.id,
        kind: "outline",
        title: note.title,
        content: "旧界面编辑",
        expectedUpdatedAt: note.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await projects.getStructure(work.projectId)).unclassified).toEqual(
      [],
    );
  });
  it("updates unchanged shared Skills and preserves locally edited overrides", async () => {
    const { workspace, projects } = await fixture();
    const work = await projects.createProject("共享技能", "novel");
    await workspace.skills(work.rootPath);
    const shared = join(
      workspace.configDirectory,
      "skills",
      "writing-techniques",
      "SKILL.md",
    );
    const projected = join(
      work.rootPath,
      ".claude",
      "skills",
      "writing-techniques",
      "SKILL.md",
    );
    const original = await readFile(shared, "utf8");
    await writeFile(shared, original + "\nSHARED_UPDATE\n");
    await workspace.skills(work.rootPath);
    expect(await readFile(projected, "utf8")).toContain("SHARED_UPDATE");
    await writeFile(projected, original + "\nLOCAL_OVERRIDE\n");
    await writeFile(shared, original + "\nLATER_SHARED_UPDATE\n");
    const loaded = await workspace.skills(work.rootPath);
    expect(await readFile(projected, "utf8")).toContain("LOCAL_OVERRIDE");
    expect(await readFile(projected, "utf8")).not.toContain(
      "LATER_SHARED_UPDATE",
    );
    expect(
      loaded.readRoots.every((path) => path.startsWith(work.rootPath)),
    ).toBe(true);
  });
  it.skipIf(process.platform === "win32")(
    "rejects redirected Skill definitions",
    async () => {
      const { root, workspace, projects } = await fixture();
      const work = await projects.createProject("作品", "novel");
      const outside = join(root, "outside.md");
      await writeFile(
        outside,
        "---\nname: redirected\ndescription: unsafe\n---\ntext",
      );
      const directory = join(work.rootPath, ".claude", "skills", "redirected");
      await mkdir(directory);
      await symlink(outside, join(directory, "SKILL.md"));
      await expect(workspace.skills(work.rootPath)).rejects.toThrow(
        "Unsafe Skill",
      );
    },
  );
});
