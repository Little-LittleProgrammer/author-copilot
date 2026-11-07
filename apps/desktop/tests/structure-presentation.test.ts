import { describe, expect, it } from "vitest";
import type { ProjectStructureNode } from "@author-copilot/contracts";
import {
  presentImportNode,
  presentStructureNode,
} from "../src/renderer/src/features/project/structure-presentation.js";

const body: ProjectStructureNode = {
  kind: "document",
  role: "scene",
  displayName: "01-正文",
  relativePath: "0001-第一卷/0002-第2章 来信/01-正文.md",
  children: [],
};
const chapter: ProjectStructureNode = {
  kind: "directory",
  role: "chapter",
  displayName: "0002-第2章 来信",
  relativePath: "0001-第一卷/0002-第2章 来信",
  children: [body],
};

describe("chapter presentation", () => {
  it("opens an existing imported chapter by its real body path and mutates its directory", () => {
    expect(presentStructureNode(chapter)).toEqual({
      id: body.relativePath,
      path: body.relativePath,
      kind: "document",
      role: "chapter",
      name: "第2章 来信",
      children: [],
      entryPath: chapter.relativePath,
      namePrefix: "0002-",
    });
    expect(
      presentImportNode({
        ...chapter,
        role: "chapter",
        children: [{ ...body, role: "scene", children: [] }],
      }),
    ).toEqual({ name: "第2章 来信", children: [] });
  });

  it("keeps volumes expandable and exposes their chapters as leaves", () => {
    const volume = presentStructureNode({
      kind: "directory",
      role: "volume",
      displayName: "0001-第一卷",
      relativePath: "0001-第一卷",
      children: [chapter],
    });
    expect(volume).toMatchObject({
      name: "第一卷",
      kind: "group",
      role: "volume",
    });
    expect(volume.children?.[0]).toMatchObject({
      kind: "document",
      role: "chapter",
    });
  });

  it("preserves multiple documents and independently named manuscript sections", () => {
    const other = {
      ...body,
      displayName: "02-场景",
      relativePath: `${chapter.relativePath}/02-场景.md`,
    };
    for (const children of [[body, other], [other], []]) {
      const result = presentStructureNode({ ...chapter, children });
      expect(result.kind).toBe("group");
      expect(result.children).toHaveLength(children.length);
      expect(result.entryPath).toBeUndefined();
    }
    expect(presentStructureNode({ ...chapter, role: "act" }).kind).toBe(
      "group",
    );
  });
});
