import { describe, expect, it } from "vitest";
import {
  buildDocumentImportPlan,
  MAX_IMPORT_DOCUMENTS,
} from "../src/main/project/document-import-plan.js";

function split(content: string) {
  const plan = buildDocumentImportPlan(content, "novel");
  expect(plan.documents.map((document) => document.content).join("")).toBe(
    content,
  );
  expect(
    new Set(
      plan.documents.map((document) => document.relativePath.toLowerCase()),
    ).size,
  ).toBe(plan.documents.length);
  return plan;
}

describe("regular-expression chapter splitting", () => {
  it("classifies Arabic chapter headings as chapters, not volumes", () => {
    const plan = split(
      "第1章 只手遮天的沧澜帮！遇袭中魂穿？\n洛樱市，临近傍晚。\n第2章 看见来信\n他打开了来信。",
    );
    expect(plan.matchedChapterCount).toBe(2);
    expect(plan.structure).toHaveLength(1);
    expect(plan.structure[0]?.kind).toBe("volume");
    expect(plan.structure[0]?.children.map((node) => node.kind)).toEqual([
      "chapter",
      "chapter",
    ]);
  });
  it("preserves preamble, volumes, headings, whitespace and the final paragraph", () => {
    const text =
      "书名与简介\n\n第一卷 雨夜\n卷前文字\n\n第一章 来信\n正文甲\n\n第二章 门外的人？\n正文乙\n\n第二卷 归途\n序章\n正文丙\n番外一\n最后一行";
    const plan = split(text);
    expect(plan.matchedChapterCount).toBe(4);
    expect(plan.documents).toHaveLength(5);
    expect(plan.structure.map((node) => node.name)).toEqual([
      "0001-第一卷",
      "0002-第一卷 雨夜",
      "0003-第二卷 归途",
    ]);
    expect(plan.documents[0]?.content).toBe("书名与简介\n\n");
    expect(plan.documents[1]?.content).toBe(
      "第一卷 雨夜\n卷前文字\n\n第一章 来信\n正文甲\n\n",
    );
    expect(plan.documents.at(-1)?.content).toBe("番外一\n最后一行");
  });

  it("recognizes Chinese numerals, Arabic and full-width digits, English and Markdown headings", () => {
    const text =
      "\n  第十二章 初见\nA\n第１３节 重逢\nB\n第2回 转折\nC\n## Chapter IV: The letter\nD\nEpilogue\nE\n楔子\nF\n后记\nG";
    const plan = split(text);
    expect(plan.matchedChapterCount).toBe(7);
    expect(plan.documents).toHaveLength(7);
  });

  it("does not treat prose mentions, long lines or incomplete English headings as chapter starts", () => {
    const text =
      "他在第一章里读到一封信。\n第一章讲述了故事的起因。\nChapter one discusses the plot in a sentence.\n第一章 " +
      "很长的正文".repeat(25);
    const plan = split(text);
    expect(plan.matchedChapterCount).toBe(0);
    expect(plan.documents).toEqual([
      { relativePath: "第一卷/第一章/01-正文.md", content: text },
    ]);
  });

  it("keeps repeated titles, reserved characters, and numeric chapter order collision-free", () => {
    const text =
      "第一章 ../来信:门/外?\nA\n第一章 ../来信:门/外?\nB\n第十章\nC\n第二章\nD";
    const plan = split(text);
    expect(plan.documents).toHaveLength(4);
    expect(
      plan.documents.map((document) => document.relativePath).sort(),
    ).toEqual(plan.documents.map((document) => document.relativePath));
    for (const document of plan.documents) {
      expect(document.relativePath.split("/")).toHaveLength(3);
      expect(document.relativePath).not.toMatch(/[<>:"\\|?*]/u);
    }
  });

  it("preserves adjacent empty chapters and text between consecutive volume headings", () => {
    const plan = split(
      "第一卷\n第二卷\n第一章\n第二章\n末尾卷前说明\n第三卷\n尾声\n",
    );
    expect(plan.matchedChapterCount).toBe(3);
    expect(plan.documents).toHaveLength(4);
    expect(plan.documents[0]?.content).toBe("第一卷\n");
  });

  it("keeps unsplit and volume-only documents whole", () => {
    const text = "第一章\n正文\n第二章\n结尾";
    expect(buildDocumentImportPlan(text, "novel", false).documents).toEqual([
      { relativePath: "第一卷/第一章/01-正文.md", content: text },
    ]);
    expect(split("第一卷\n只有卷标题的正文").documents).toHaveLength(1);
  });

  it("maps screenplay acts and scenes to the existing two-level layout", () => {
    const text =
      "第一幕 开端\n第一场 雨夜\n场景一\n第二场 门口\n场景二\nAct II: Arrival\nScene 1: Home\n场景三";
    const plan = buildDocumentImportPlan(text, "screenplay");
    expect(plan.matchedChapterCount).toBe(3);
    expect(plan.documents.map((document) => document.content).join("")).toBe(
      text,
    );
    expect(plan.structure.map((node) => node.kind)).toEqual(["act", "act"]);
    expect(
      plan.documents.every(
        (document) => document.relativePath.split("/").length === 2,
      ),
    ).toBe(true);
  });

  it("bounds generated documents instead of truncating content", () => {
    const text = Array.from(
      { length: MAX_IMPORT_DOCUMENTS + 1 },
      (_, index) => `第${index + 1}章\n正文\n`,
    ).join("");
    expect(() => buildDocumentImportPlan(text, "novel")).toThrow(
      expect.objectContaining({ reason: "too_many_chapters" }),
    );
  });
});
