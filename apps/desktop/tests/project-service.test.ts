import { randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DocumentConflictError,
  DuplicateProjectIdError,
  InvalidProjectPathError,
  ProjectService,
  RegistryStore,
  SymbolicLinkNotAllowedError,
  type ProjectMetadata,
} from "../src/main/project/index.js";

const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "作者 Copilot #[]-"));
  temporaryRoots.push(base);
  return base;
}

async function fixture(): Promise<{
  readonly base: string;
  readonly projects: string;
  readonly userData: string;
  readonly registry: RegistryStore;
  readonly service: ProjectService;
}> {
  const base = await temporaryDirectory();
  const projects = join(base, "作品 父目录 #1");
  const userData = join(base, "用户 数据");
  await mkdir(projects);
  return {
    base,
    projects,
    userData,
    registry: new RegistryStore(userData),
    service: new ProjectService({ registry: new RegistryStore(userData) }),
  };
}

function metadata(
  title: string,
  template: "novel" | "screenplay",
  projectId = randomUUID(),
): ProjectMetadata {
  return {
    schemaVersion: 1,
    projectId,
    title,
    template,
    createdAt: "2026-07-13T00:00:00.000Z",
  };
}

async function writeMetadata(
  rootPath: string,
  value: ProjectMetadata,
): Promise<void> {
  await writeFile(
    join(rootPath, "author-copilot.json"),
    `${JSON.stringify(value)}\n`,
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("ProjectService templates and registry", () => {
  it("creates a Chinese novel template and registers its canonical path", async () => {
    const { projects, userData, service } = await fixture();
    const project = await service.createProject(
      projects,
      "长夜之后 #1",
      "novel",
    );

    expect(
      await readFile(
        join(project.rootPath, "第一卷", "第一章", "01-正文.md"),
        "utf8",
      ),
    ).toBe("");
    expect(project.metadata).toMatchObject({
      projectId: project.projectId,
      title: "长夜之后 #1",
      template: "novel",
    });
    const registryFile = JSON.parse(
      await readFile(join(userData, "projects.json"), "utf8"),
    ) as { projects: Record<string, { rootPath: string }> };
    expect(registryFile.projects[project.projectId]?.rootPath).toBe(
      project.rootPath,
    );

    const structure = await service.getStructure(project.projectId);
    expect(structure.nodes[0]).toMatchObject({
      kind: "volume",
      name: "第一卷",
      children: [{ kind: "chapter", name: "第一章" }],
    });
  });

  it("creates the fixed screenplay template", async () => {
    const { projects, service } = await fixture();
    const project = await service.createProject(
      projects,
      "雨夜 剧本 & 草稿",
      "screenplay",
    );

    expect(
      await readFile(join(project.rootPath, "第一幕", "01-第一场.md"), "utf8"),
    ).toBe("");
    expect(
      (await service.getStructure(project.projectId)).nodes[0],
    ).toMatchObject({ kind: "act", name: "第一幕" });
    expect(await service.list()).toHaveLength(1);
  });
});

describe("ProjectService import", () => {
  it("keeps preview read-only and reports Markdown outside the template shape", async () => {
    const { projects, service } = await fixture();
    const source = join(projects, "旧作品");
    await mkdir(join(source, "第一卷", "第一章"), { recursive: true });
    await writeFile(join(source, "第一卷", "第一章", "01-开场.md"), "开场");
    await writeFile(join(source, "散落 笔记.md"), "不能丢");
    const before = await readdir(source, { recursive: true });

    const preview = await service.previewImport(source, "novel");

    expect(preview.metadataAction).toBe("create");
    expect(preview.structure.nodes).toHaveLength(1);
    expect(preview.structure.unclassified).toEqual([
      expect.objectContaining({ relativePath: "散落 笔记.md" }),
    ]);
    expect(await readdir(source, { recursive: true })).toEqual(before);
    await expect(
      lstat(join(source, "author-copilot.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const imported = await service.confirmImport({
      mode: "in-place",
      rootPath: source,
      template: "novel",
    });
    expect(
      JSON.parse(await readFile(join(source, "author-copilot.json"), "utf8")),
    ).toMatchObject({ projectId: imported.projectId, template: "novel" });
  });

  it("validates existing metadata and requires explicit duplicate-ID reassignment", async () => {
    const { projects, service } = await fixture();
    const original = join(projects, "原作");
    const duplicate = join(projects, "原作副本");
    await mkdir(original);
    const sharedMetadata = metadata("原作", "novel");
    await writeMetadata(original, sharedMetadata);
    await service.confirmImport({
      mode: "in-place",
      rootPath: original,
      template: "novel",
    });
    await cp(original, duplicate, { recursive: true });

    const preview = await service.previewImport(duplicate, "novel");
    expect(preview.metadataAction).toBe("none");
    expect(preview.duplicateRegistration?.rootPath).toBe(
      await realpath(original),
    );
    await expect(
      service.confirmImport({
        mode: "in-place",
        rootPath: duplicate,
        template: "novel",
      }),
    ).rejects.toBeInstanceOf(DuplicateProjectIdError);

    const reassigned = await service.confirmImport({
      mode: "in-place",
      rootPath: duplicate,
      template: "novel",
      reassignProjectId: true,
    });
    expect(reassigned.projectId).not.toBe(sharedMetadata.projectId);
    expect(
      JSON.parse(await readFile(join(original, "author-copilot.json"), "utf8")),
    ).toMatchObject({ projectId: sharedMetadata.projectId });
  });

  it("rejects invalid or unsupported existing metadata without rewriting it", async () => {
    const { projects, service } = await fixture();
    const source = join(projects, "损坏元数据");
    await mkdir(source);
    const rawMetadata = `${JSON.stringify({
      ...metadata("损坏元数据", "novel"),
      schemaVersion: 99,
    })}\n`;
    await writeFile(join(source, "author-copilot.json"), rawMetadata, "utf8");

    await expect(service.previewImport(source, "novel")).rejects.toThrow(
      "schemaVersion 99 is not supported",
    );
    expect(await readFile(join(source, "author-copilot.json"), "utf8")).toBe(
      rawMetadata,
    );
  });

  it("copies an import recursively as an independent project", async () => {
    const { projects, service } = await fixture();
    const source = join(projects, "源 项目");
    const destinationParent = join(projects, "目标目录");
    await mkdir(join(source, "第一幕"), { recursive: true });
    await mkdir(destinationParent);
    await writeFile(join(source, "第一幕", "01-咖啡馆.md"), "INT. CAFE");

    const copied = await service.confirmImport({
      mode: "copy",
      rootPath: source,
      template: "screenplay",
      destinationParent,
      title: "复制 剧本 #2",
    });

    expect(
      await readFile(join(copied.rootPath, "第一幕", "01-咖啡馆.md"), "utf8"),
    ).toBe("INT. CAFE");
    expect(copied.metadata.title).toBe("复制 剧本 #2");
    await expect(
      lstat(join(source, "author-copilot.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never deletes an existing copy destination when import fails", async () => {
    const { projects, service } = await fixture();
    const source = join(projects, "源项目");
    const destinationParent = join(projects, "目标目录");
    const existingDestination = join(destinationParent, "源项目");
    await mkdir(join(source, "第一幕"), { recursive: true });
    await writeFile(join(source, "第一幕", "01-开场.md"), "source", "utf8");
    await mkdir(existingDestination, { recursive: true });
    await writeFile(
      join(existingDestination, "用户已有文件.md"),
      "must survive",
      "utf8",
    );

    await expect(
      service.confirmImport({
        mode: "copy",
        rootPath: source,
        template: "screenplay",
        destinationParent,
      }),
    ).rejects.toThrow("destination folder already exists");

    expect(
      await readFile(join(existingDestination, "用户已有文件.md"), "utf8"),
    ).toBe("must survive");
    expect(
      (await readdir(destinationParent)).filter((name) =>
        name.endsWith(".importing"),
      ),
    ).toEqual([]);
  });

  it("rejects a copy destination nested inside the source", async () => {
    const { projects, service } = await fixture();
    const source = join(projects, "不能递归复制自身");
    await mkdir(source);
    await writeFile(join(source, "笔记.md"), "content");

    await expect(
      service.confirmImport({
        mode: "copy",
        rootPath: source,
        template: "novel",
        destinationParent: source,
        title: "子副本",
      }),
    ).rejects.toThrow("cannot be inside its source");
    await expect(lstat(join(source, "子副本"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks during recursive copy and removes the partial destination",
    async () => {
      const { projects, service } = await fixture();
      const source = join(projects, "带链接项目");
      const destinationParent = join(projects, "复制目标");
      await mkdir(source);
      await mkdir(destinationParent);
      await writeFile(join(source, "真实.md"), "content");
      await symlink(join(source, "真实.md"), join(source, "链接.md"));

      await expect(
        service.confirmImport({
          mode: "copy",
          rootPath: source,
          template: "novel",
          destinationParent,
          title: "不得创建",
        }),
      ).rejects.toBeInstanceOf(SymbolicLinkNotAllowedError);
      await expect(
        lstat(join(destinationParent, "不得创建")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});

describe("ProjectService document authorization and atomic save", () => {
  it("rejects traversal, absolute paths, metadata, .git, and symlink access", async () => {
    const { base, projects, service } = await fixture();
    const project = await service.createProject(
      projects,
      "受保护项目",
      "novel",
    );
    const outside = join(base, "outside.md");
    await writeFile(outside, "secret");

    await expect(
      service.readDocument(project.projectId, "../outside.md"),
    ).rejects.toBeInstanceOf(InvalidProjectPathError);
    await expect(
      service.readDocument(project.projectId, outside),
    ).rejects.toBeInstanceOf(InvalidProjectPathError);
    await expect(
      service.readDocument(project.projectId, "author-copilot.json"),
    ).rejects.toBeInstanceOf(InvalidProjectPathError);
    await expect(
      service.readDocument(project.projectId, ".git/config.md"),
    ).rejects.toBeInstanceOf(InvalidProjectPathError);

    if (process.platform !== "win32") {
      const linkPath = join(project.rootPath, "第一卷", "第一章", "link.md");
      await symlink(outside, linkPath);
      await expect(
        service.readDocument(project.projectId, "第一卷/第一章/link.md"),
      ).rejects.toBeInstanceOf(SymbolicLinkNotAllowedError);
    }
  });

  it("atomically saves with optimistic conflict checks, mode retention, cleanup, and an async event", async () => {
    const events: unknown[] = [];
    const { projects, userData } = await fixture();
    const service = new ProjectService({
      registry: new RegistryStore(userData),
      publishEvent: (event) => {
        events.push(event);
        return new Promise(() => undefined);
      },
    });
    const project = await service.createProject(projects, "原子保存", "novel");
    const relativePath = "第一卷/第一章/01-正文.md";
    const documentPath = join(
      project.rootPath,
      "第一卷",
      "第一章",
      "01-正文.md",
    );
    await chmod(documentPath, 0o640);
    const initial = await service.readDocument(project.projectId, relativePath);

    const saved = await service.saveDocument(
      project.projectId,
      relativePath,
      "第一版内容\n",
      initial.hash,
    );
    expect(await readFile(documentPath, "utf8")).toBe("第一版内容\n");
    expect((await stat(documentPath)).mode & 0o777).toBe(0o640);
    expect(saved.hash).not.toBe(initial.hash);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      type: "document-saved",
      projectId: project.projectId,
      relativePath,
      hash: saved.hash,
    });

    await expect(
      service.saveDocument(
        project.projectId,
        relativePath,
        "不应覆盖",
        initial.hash,
      ),
    ).rejects.toBeInstanceOf(DocumentConflictError);
    expect(await readFile(documentPath, "utf8")).toBe("第一版内容\n");
    expect(
      (await readdir(join(project.rootPath, "第一卷", "第一章"))).filter(
        (name) => name.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });
});

describe("ProjectService project and structure editing", () => {
  it("updates the displayed title without renaming the project folder", async () => {
    const { projects, userData, service } = await fixture();
    const project = await service.createProject(projects, "原书名", "novel");

    const updated = await service.updateProjectTitle(
      project.projectId,
      "新书名",
    );

    expect(updated.rootPath).toBe(project.rootPath);
    expect(updated.metadata.title).toBe("新书名");
    expect(
      JSON.parse(
        await readFile(join(project.rootPath, "author-copilot.json"), "utf8"),
      ),
    ).toMatchObject({ title: "新书名" });
    expect(
      JSON.parse(await readFile(join(userData, "projects.json"), "utf8")),
    ).toMatchObject({
      projects: { [project.projectId]: { metadata: { title: "新书名" } } },
    });
  });

  it("renames volumes, chapters, and documents while retaining storage extensions", async () => {
    const { projects, service } = await fixture();
    const project = await service.createProject(
      projects,
      "可编辑目录",
      "novel",
    );

    expect(await service.renameEntry(project.projectId, "第一卷", "序卷")).toBe(
      "序卷",
    );
    expect(
      await service.renameEntry(project.projectId, "序卷/第一章", "启程"),
    ).toBe("序卷/启程");
    expect(
      await service.renameEntry(
        project.projectId,
        "序卷/启程/01-正文.md",
        "相遇.md",
      ),
    ).toBe("序卷/启程/相遇.md");
    expect(
      await readFile(join(project.rootPath, "序卷", "启程", "相遇.md"), "utf8"),
    ).toBe("");
    expect(
      (await service.getStructure(project.projectId)).nodes[0],
    ).toMatchObject({
      name: "序卷",
      children: [
        {
          name: "启程",
          children: [{ name: "相遇", relativePath: "序卷/启程/相遇.md" }],
        },
      ],
    });
  });

  it("rejects unsafe and colliding structure names", async () => {
    const { projects, service } = await fixture();
    const project = await service.createProject(
      projects,
      "受保护目录",
      "novel",
    );
    await mkdir(join(project.rootPath, "已有卷"));

    await expect(
      service.renameEntry(project.projectId, "第一卷", "../逃逸"),
    ).rejects.toBeInstanceOf(InvalidProjectPathError);
    await expect(
      service.renameEntry(project.projectId, "第一卷", "已有卷"),
    ).rejects.toThrow("already exists");
    await expect(
      service.renameEntry(project.projectId, ".git", "配置"),
    ).rejects.toBeInstanceOf(InvalidProjectPathError);
  });

  it("deletes only recognized documents and structure directories", async () => {
    const { projects, service } = await fixture();
    const project = await service.createProject(
      projects,
      "可删除目录",
      "novel",
    );
    await mkdir(join(project.rootPath, "隐藏资料"));

    await expect(
      service.deleteEntry(project.projectId, "隐藏资料"),
    ).rejects.toBeInstanceOf(InvalidProjectPathError);
    await service.deleteEntry(project.projectId, "第一卷/第一章/01-正文.md");
    await expect(
      lstat(join(project.rootPath, "第一卷", "第一章", "01-正文.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const directoryProject = await service.createProject(
      projects,
      "删除整卷",
      "novel",
    );
    await service.deleteEntry(directoryProject.projectId, "第一卷");
    await expect(
      lstat(join(directoryProject.rootPath, "第一卷")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a structure directory when it contains a non-writing file", async () => {
    const { projects, service } = await fixture();
    const project = await service.createProject(
      projects,
      "包含资料的目录",
      "novel",
    );
    const chapterPath = join(project.rootPath, "第一卷", "第一章");
    const resourcePath = join(chapterPath, "人物关系.png");
    await writeFile(resourcePath, "image-placeholder", "utf8");

    await expect(
      service.deleteEntry(project.projectId, "第一卷"),
    ).rejects.toBeInstanceOf(InvalidProjectPathError);
    await expect(readFile(resourcePath, "utf8")).resolves.toBe(
      "image-placeholder",
    );
    await expect(
      readFile(join(chapterPath, "01-正文.md"), "utf8"),
    ).resolves.toBe("");
  });
});
