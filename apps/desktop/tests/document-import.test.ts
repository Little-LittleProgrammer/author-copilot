import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertImportSourceUnchanged,
  MAX_IMPORT_BYTES,
  previewDocumentImport,
} from "../src/main/project/document-import.js";
import { buildDocumentImportPlan } from "../src/main/project/document-import-plan.js";
import { ProjectService, RegistryStore } from "../src/main/project/index.js";
import { projectOperationFailure } from "../src/main/ipc/project-result.js";

const roots: string[] = [];
async function fixture(name: string, content: string | Buffer) {
  const root = await mkdtemp(join(tmpdir(), "copilot-import-"));
  roots.push(root);
  const path = join(root, name);
  await writeFile(path, content);
  return { root, path };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("TXT and Word import", () => {
  it.each([
    [
      "UTF-8",
      Buffer.from("雨夜来信\r\n\r\n第二段。\r结尾"),
      "雨夜来信\n\n第二段。\n结尾",
    ],
    ["UTF-8 BOM", Buffer.from("\ufeff中文正文"), "中文正文"],
    [
      "UTF-16 LE",
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("中文\r\n段落", "utf16le"),
      ]),
      "中文\n段落",
    ],
    [
      "UTF-16 BE",
      Buffer.concat([
        Buffer.from([0xfe, 0xff]),
        Buffer.from("中文正文", "utf16le").swap16(),
      ]),
      "中文正文",
    ],
    [
      "GB18030",
      Buffer.from("d6d0cec4d5fdcec40d0ab5dab6feb6cea1a3", "hex"),
      "中文正文\n第二段。",
    ],
  ])(
    "decodes %s without changing paragraph content",
    async (_encoding, bytes, expected) => {
      const { path, root } = await fixture("我的作品.TXT", bytes);
      const result = await previewDocumentImport(path);
      expect(result).toMatchObject({
        title: "我的作品",
        format: "txt",
        content: expected,
      });
      expect(await readdir(root)).toEqual(["我的作品.TXT"]);
      expect(await readFile(path)).toEqual(bytes);
    },
  );

  it.each(["doc", "docx"] as const)(
    "extracts real %s Chinese body text",
    async (format) => {
      const result = await previewDocumentImport(
        join(import.meta.dirname, "fixtures/import", `chinese.${format}`),
      );
      expect(result.content).toContain("雨夜来信");
      expect(result.content).toContain("林舟推开旧书店的门。");
      expect(result.content).toContain("第二段保留中文、标点和 café。");
      expect(result.content).toMatch(/雨夜来信\n\n林舟/u);
    },
  );

  it.each([
    ["empty.txt", " \n\t", "empty"],
    ["binary.txt", Buffer.from([0, 1, 2, 3]), "unreadable"],
    ["bad.docx", "not a Word document", "unreadable"],
    ["bad.doc", "not a Word document", "unreadable"],
    ["unsupported.pdf", "not supported", "unsupported"],
    ["bad-utf16.txt", Buffer.from([0xff, 0xfe, 0x2d]), "unreadable"],
  ])(
    "rejects %s with an actionable, path-free error",
    async (name, content, reason) => {
      const { path } = await fixture(
        name as string,
        content as string | Buffer,
      );
      const error: unknown = await previewDocumentImport(path).catch(
        (value: unknown) => value,
      );
      const response = projectOperationFailure(error);
      expect(response.error).toMatchObject({
        code: "invalid_import",
        details: { reason },
      });
      expect(JSON.stringify(response)).not.toContain(path);
    },
  );

  it("rejects oversized input before extraction", async () => {
    const { path } = await fixture("large.txt", "");
    await truncate(path, MAX_IMPORT_BYTES + 1);
    await expect(previewDocumentImport(path)).rejects.toMatchObject({
      reason: "too_large",
    });
  });

  it("detects source changes after preview", async () => {
    const { path } = await fixture("原文.txt", "预览正文");
    const preview = await previewDocumentImport(path);
    await expect(assertImportSourceUnchanged(preview)).resolves.toBeUndefined();
    await writeFile(path, "修改正文");
    await expect(assertImportSourceUnchanged(preview)).rejects.toMatchObject({
      reason: "changed",
    });
  });

  it.each(["novel", "screenplay"] as const)(
    "creates a %s from the preview and preserves its source",
    async (template) => {
      const { root, path } = await fixture("原稿.txt", "原稿正文\n\n下一段。");
      const preview = await previewDocumentImport(path);
      const destination = join(root, "作品");
      await mkdir(destination);
      const service = new ProjectService({
        registry: new RegistryStore(join(root, "user")),
      });
      const project = await service.createProject(
        destination,
        preview.title,
        template,
        buildDocumentImportPlan(preview.content, template).documents,
      );
      const relative =
        template === "novel"
          ? "第一卷/第一章/01-正文.md"
          : "第一幕/01-第一场.md";
      expect(
        (await service.readDocument(project.projectId, relative)).content,
      ).toBe(preview.content);
      expect(
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ).toBe(preview.sourceHash);
      await expect(
        service.createProject(
          destination,
          preview.title,
          template,
          buildDocumentImportPlan("不能覆盖", template).documents,
        ),
      ).rejects.toThrow();
      expect(
        (await service.readDocument(project.projectId, relative)).content,
      ).toBe(preview.content);
    },
  );

  it("leaves no partial project when registration fails", async () => {
    const { root, path } = await fixture("原稿.txt", "正文");
    const registry = new RegistryStore(join(root, "registry"));
    registry.register = async () => {
      throw new Error("registry unavailable");
    };
    const service = new ProjectService({ registry });
    const preview = await previewDocumentImport(path);
    await expect(
      service.createProject(
        root,
        preview.title,
        "novel",
        buildDocumentImportPlan(preview.content, "novel").documents,
      ),
    ).rejects.toThrow("registry unavailable");
    expect(await readdir(root)).toEqual(["原稿.txt"]);
  });
});

describe("split document publication", () => {
  it.each(["novel", "screenplay"] as const)(
    "writes exactly the previewed %s files in source order",
    async (template) => {
      const { root } = await fixture("全本.txt", "");
      const content =
        "简介\n第一卷\n第一章 初见\n正文一\n第二章 初见\n正文二\n第二卷\n第一章 回家\n正文三";
      const plan = buildDocumentImportPlan(content, template);
      const service = new ProjectService({
        registry: new RegistryStore(join(root, "user")),
      });
      const project = await service.createProject(
        root,
        "分章作品",
        template,
        plan.documents,
      );
      const stored = await Promise.all(
        plan.documents.map(
          async (document) =>
            (
              await service.readDocument(
                project.projectId,
                document.relativePath,
              )
            ).content,
        ),
      );
      expect(stored.join("")).toBe(content);
      expect((await service.getStructure(project.projectId)).nodes).toEqual(
        plan.structure,
      );
    },
  );

  it("rejects unsafe or duplicate initial paths and rolls back partial writes", async () => {
    const { root } = await fixture("原稿.txt", "正文");
    const service = new ProjectService({
      registry: new RegistryStore(join(root, "user")),
    });
    for (const path of ["../escape/body.md", "第一卷/第一章/body.md"]) {
      await expect(
        service.createProject(root, "失败作品", "novel", [
          { relativePath: "第一卷/第一章/body.md", content: "已经暂存" },
          { relativePath: path, content: "无效内容" },
        ]),
      ).rejects.toThrow();
      expect(await readdir(root)).toEqual(["原稿.txt"]);
    }
  });
});
