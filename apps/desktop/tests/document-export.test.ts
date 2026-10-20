import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WordExtractor from "word-extractor";
import { ProjectService, RegistryStore } from "../src/main/project/index.js";
import {
  DocumentExportError,
  suggestedExportName,
  writeManuscriptExport,
  type ManuscriptSnapshot,
} from "../src/main/project/document-export.js";
import { renderManuscript } from "../src/main/project/document-export-worker.js";
import * as files from "../src/main/project/file-utils.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(template: "novel" | "screenplay" = "novel") {
  const base = await mkdtemp(join(tmpdir(), "export-"));
  roots.push(base);
  const service = new ProjectService({
    registry: new RegistryStore(join(base, ".data")),
  });
  const project = await service.createProject(
    base,
    "测试作品",
    template,
    template === "novel"
      ? [
          {
            relativePath: "0001-第一卷/0001-第一章/01-正文.md",
            content: "首章正文\n\n第二段 < & > 🎉",
          },
          {
            relativePath: "0001-第一卷/0001-第一章/第二场.md",
            content: "同章另一场",
          },
          {
            relativePath: "0001-第一卷/0002-第二章/01-正文.md",
            content: "次章正文",
          },
          {
            relativePath: "0002-第二卷/第一章/01-正文.md",
            content: "第二卷正文",
          },
        ]
      : [
          { relativePath: "第一幕/第一场.md", content: "甲：你好。" },
          { relativePath: "第一幕/第二场.md", content: "乙：再会。" },
        ],
  );
  return {
    base,
    service,
    project,
    request: {
      projectId: project.projectId,
      scope: "project" as const,
      format: "txt" as const,
      locale: "zh-CN" as const,
    },
  };
}

describe("manuscript export", () => {
  it("uses persisted directory order, removes import prefixes and excludes unclassified files", async () => {
    const { service, project, request } = await fixture();
    await writeFile(join(project.rootPath, "随记.md"), "不应交稿");
    await service.moveEntry(project.projectId, "0001-第一卷/0002-第二章", "up");
    const snapshot = await service.prepareExport(request);
    const txt = (await renderManuscript(snapshot, "txt")).toString();
    expect(snapshot.documentCount).toBe(4);
    expect(txt.indexOf("次章正文")).toBeLessThan(txt.indexOf("首章正文"));
    expect(txt).toContain("第二段 < & > 🎉");
    expect(txt).not.toContain("不应交稿");
    expect(txt).not.toContain("0001-");
    expect(txt).not.toContain("01-正文");
    const headings = snapshot.blocks.filter(
      (block) => block.kind === "heading",
    );
    expect(headings.find((block) => block.text === "第一章")?.pageBreak).toBe(
      true,
    );
    expect(headings.find((block) => block.text === "第二卷")?.pageBreak).toBe(
      true,
    );
  });

  it("exports every scene in the current novel chapter and only the current screenplay scene", async () => {
    const { service, request } = await fixture();
    const chapter = await service.prepareExport({
      ...request,
      scope: "chapter",
      relativePath: "0001-第一卷/0001-第一章/01-正文.md",
    });
    expect(chapter.documentCount).toBe(2);
    expect(chapter.fileTitle).toBe("测试作品-第一章");
    expect((await renderManuscript(chapter, "md")).toString()).toContain(
      "## 第一章",
    );
    expect((await renderManuscript(chapter, "md")).toString()).not.toContain(
      "次章正文",
    );
    const screenplay = await fixture("screenplay");
    const scene = await screenplay.service.prepareExport({
      ...screenplay.request,
      scope: "chapter",
      relativePath: "第一幕/第二场.md",
    });
    expect(scene.documentCount).toBe(1);
    expect((await renderManuscript(scene, "txt")).toString()).toContain(
      "乙：再会。",
    );
    const whole = await screenplay.service.prepareExport(screenplay.request);
    expect(
      whole.blocks.find((block) => block.text === "第二场")?.pageBreak,
    ).toBe(true);
  });

  it("generates readable Word text with Unicode, headings and chapter page breaks", async () => {
    const { service, request } = await fixture();
    const snapshot = await service.prepareExport(request);
    const bytes = await renderManuscript(snapshot, "docx");
    const document = await new WordExtractor().extract(bytes);
    expect(document.getBody()).toContain("第二段 < & > 🎉");
    expect(document.getBody()).toContain("第二卷");
    expect(document.getBody()).not.toContain("01-正文");
    // Inspect the actual OOXML package using the independent extractor's ZIP reader.
    const { default: unzip } = await import("node:zlib");
    let offset = 0;
    let xml = "";
    while (
      offset + 30 < bytes.length &&
      bytes.readUInt32LE(offset) === 0x04034b50
    ) {
      const size = bytes.readUInt32LE(offset + 18);
      const nameLength = bytes.readUInt16LE(offset + 26);
      const extraLength = bytes.readUInt16LE(offset + 28);
      const name = bytes
        .subarray(offset + 30, offset + 30 + nameLength)
        .toString();
      const start = offset + 30 + nameLength + extraLength;
      if (name === "word/document.xml")
        xml = unzip
          .inflateRawSync(bytes.subarray(start, start + size))
          .toString();
      offset = start + size;
    }
    expect(xml).toContain("w:pageBreakBefore");
    expect(xml).toContain("Heading2");
    expect(xml).toContain("&lt; &amp; &gt;");
  });

  it("writes all formats in the background and atomically replaces an approved delivery file", async () => {
    const { base, service, request } = await fixture();
    const snapshot = await service.prepareExport(request);
    for (const format of ["txt", "md", "docx"] as const) {
      const path = join(base, `交稿.${format}`);
      await writeFile(path, "previous delivery");
      expect(await writeManuscriptExport(snapshot, format, path, [])).toBe(
        `交稿.${format}`,
      );
      const bytes = await readFile(path);
      if (format === "docx")
        expect((await new WordExtractor().extract(bytes)).getBody()).toContain(
          "次章正文",
        );
      else expect(bytes.toString()).toContain("首章正文");
    }
    expect(
      (await readdir(base)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("rejects project destinations, symlink destinations, wrong extensions and unknown ranges", async () => {
    const { base, service, project, request } = await fixture();
    const snapshot = await service.prepareExport(request);
    const original = join(
      project.rootPath,
      "0001-第一卷/0001-第一章/01-正文.md",
    );
    await expect(
      writeManuscriptExport(snapshot, "md", original, [project.rootPath]),
    ).rejects.toMatchObject({ reason: "destination" });
    const linked = join(base, "linked.md");
    await symlink(original, linked);
    await expect(
      writeManuscriptExport(snapshot, "md", linked, []),
    ).rejects.toMatchObject({ reason: "destination" });
    await expect(
      writeManuscriptExport(snapshot, "docx", join(base, "wrong.txt"), []),
    ).rejects.toMatchObject({ reason: "destination" });
    await expect(
      service.prepareExport({
        ...request,
        scope: "chapter",
        relativePath: "../private.md",
      }),
    ).rejects.toBeInstanceOf(DocumentExportError);
    await expect(
      service.prepareExport({
        ...request,
        scope: "chapter",
        relativePath: "0001-第一卷",
      }),
    ).rejects.toMatchObject({ reason: "empty" });
    expect(await readFile(original, "utf8")).toContain("首章正文");
  });

  it("keeps previous output intact when publication fails", async () => {
    const { base, service, request } = await fixture();
    const snapshot = await service.prepareExport(request);
    const path = join(base, "交稿.txt");
    await writeFile(path, "previous delivery");
    const atomicWrite = files.atomicWriteFile;
    vi.spyOn(files, "atomicWriteFile").mockImplementation((path, bytes, mode) =>
      atomicWrite(path, bytes, mode, () => {
        throw new Error("publication failed");
      }),
    );
    await expect(
      writeManuscriptExport(snapshot, "txt", path, []),
    ).rejects.toThrow("publication failed");
    expect(await readFile(path, "utf8")).toBe("previous delivery");
    expect(
      (await readdir(base)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("preserves an external change or newly created destination made during export", async () => {
    const { base, service, request } = await fixture();
    const snapshot = await service.prepareExport(request);
    const atomicWrite = files.atomicWriteFile;
    vi.spyOn(files, "atomicWriteFile").mockImplementation(
      (path, bytes, mode, beforeReplace) =>
        atomicWrite(path, bytes, mode, async () => {
          await writeFile(path, "external change");
          await beforeReplace?.();
        }),
    );
    for (const exists of [true, false]) {
      const path = join(base, exists ? "existing.txt" : "new.txt");
      if (exists) await writeFile(path, "previous delivery");
      await expect(
        writeManuscriptExport(snapshot, "txt", path, []),
      ).rejects.toMatchObject({ reason: "changed" });
      expect(await readFile(path, "utf8")).toBe("external change");
    }
    expect(
      (await readdir(base)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("excludes linked manuscripts and refuses malformed text and active Agent work", async () => {
    const { base, service, project, request } = await fixture();
    const external = join(base, "private.md");
    await writeFile(external, "private external content");
    const path = join(project.rootPath, "0001-第一卷/0001-第一章/01-正文.md");
    await rm(path);
    await symlink(external, path);
    const snapshot = await service.prepareExport(request);
    expect(snapshot.documentCount).toBe(3);
    expect((await renderManuscript(snapshot, "txt")).toString()).not.toContain(
      "private external content",
    );
    await rm(path);
    await writeFile(path, "invalid\u0000text");
    await expect(service.prepareExport(request)).rejects.toMatchObject({
      reason: "failed",
    });
    const busy = new ProjectService({
      registry: new RegistryStore(join(base, ".data")),
      assertCanMutate: () => {
        throw new Error("Agent is running");
      },
    });
    await expect(busy.prepareExport(request)).rejects.toThrow(
      "Agent is running",
    );
  });

  it("rejects oversized, unclassified and empty ranges without changing the work", async () => {
    const { service, project, request } = await fixture();
    await writeFile(join(project.rootPath, "随记.md"), "only notes");
    await expect(
      service.prepareExport({
        ...request,
        scope: "chapter",
        relativePath: "随记.md",
      }),
    ).rejects.toMatchObject({ reason: "empty" });
    const path = join(project.rootPath, "0001-第一卷/0001-第一章/01-正文.md");
    await writeFile(path, "a".repeat(20 * 1024 * 1024 + 1));
    await expect(service.prepareExport(request)).rejects.toMatchObject({
      reason: "too_large",
    });
    const empty = await service.createProject(
      join(project.rootPath, ".."),
      "空作品",
      "novel",
    );
    await service.deleteEntry(empty.projectId, "第一卷");
    await expect(
      service.prepareExport({ ...request, projectId: empty.projectId }),
    ).rejects.toMatchObject({ reason: "empty" });
  });

  it("sanitizes delivery names without exposing or interpreting title paths", () => {
    const snapshot = { fileTitle: "../bad/name:*?" } as ManuscriptSnapshot;
    expect(suggestedExportName(snapshot, "docx")).toBe(".._bad_name___.docx");
    expect(suggestedExportName({ ...snapshot, fileTitle: "CON" }, "txt")).toBe(
      "_CON.txt",
    );
    expect(
      Buffer.byteLength(
        suggestedExportName(
          { ...snapshot, fileTitle: "😀".repeat(100) },
          "docx",
        ),
      ),
    ).toBeLessThan(220);
  });
});
