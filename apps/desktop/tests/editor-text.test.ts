import { describe, expect, it } from "vitest";
import {
  findTextMatches,
  formatManuscript,
} from "../src/renderer/src/features/editor/editor-text.js";

describe("writing toolbar text operations", () => {
  it("finds literal non-overlapping matches and handles empty queries", () => {
    expect(findTextMatches("雨夜.*雨夜.*", ".*")).toEqual([2, 6]);
    expect(findTextMatches("aaaa", "aa")).toEqual([0, 2]);
    expect(findTextMatches("雨夜", "")).toEqual([]);
    expect(findTextMatches("Rain rain", "rain")).toEqual([5]);
  });
  it("indents prose with paragraph spacing and is idempotent", () => {
    const result = formatManuscript("  雨夜。\n她推开门。\n\n　　灯亮了。");
    expect(result).toBe("　　雨夜。\n\n　　她推开门。\n\n　　灯亮了。");
    expect(formatManuscript(result)).toBe(result);
  });
  it("preserves Markdown headings, lists, hard breaks, tables, and fenced code", () => {
    const blocks = [
      "# 标题",
      "- 第一项\n  - 子项",
      "第一行  \n第二行",
      "| A | B |\n| - | - |",
      "```ts\nconst a = 1;\n  \n    a;\n```",
      "标题\n===",
      "    indented code",
    ];
    for (const block of blocks) expect(formatManuscript(block)).toBe(block);
  });
  it("preserves CRLF newlines and an empty document", () => {
    expect(formatManuscript("雨夜。\r\n她推开门。\r\n")).toBe(
      "　　雨夜。\r\n\r\n　　她推开门。",
    );
    expect(formatManuscript("")).toBe("");
  });
});
