import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreativeNoteGenerationRequestSchema,
  CreativeNoteDraftSchema,
} from "../src/index.js";

describe("creative generation contracts", () => {
  const valid = {
    projectId: randomUUID(),
    requestId: randomUUID(),
    kind: "outline",
    instruction: "生成大纲",
    locale: "zh-CN",
    noteIds: [],
    documentPaths: [],
  };
  it("accepts generation without a current document and rejects secrets or filesystem options", () => {
    expect(CreativeNoteGenerationRequestSchema.safeParse(valid).success).toBe(
      true,
    );
    for (const extra of [
      { apiKey: "secret" },
      { rootPath: "/tmp" },
      { currentDocument: { content: "forged" } },
    ])
      expect(
        CreativeNoteGenerationRequestSchema.safeParse({ ...valid, ...extra })
          .success,
      ).toBe(false);
  });
  it("bounds references and rejects duplicates, traversal and stale-target-shaped inputs", () => {
    const id = randomUUID();
    for (const invalid of [
      { noteIds: [id, id] },
      { noteIds: Array.from({ length: 7 }, () => randomUUID()) },
      { documentPaths: ["../outside.md"] },
      { documentPaths: ["a.md", "a.md"] },
      { documentPaths: Array.from({ length: 9 }, (_, n) => `${n}.md`) },
      { target: { noteId: id } },
      { instruction: " " },
    ])
      expect(
        CreativeNoteGenerationRequestSchema.safeParse({ ...valid, ...invalid })
          .success,
      ).toBe(false);
  });
  it("requires nonempty bounded drafts and rejects tool-selected persistence fields", () => {
    expect(
      CreativeNoteDraftSchema.safeParse({
        kind: "note",
        title: "标题",
        content: "正文",
      }).success,
    ).toBe(true);
    for (const extra of [
      { content: " " },
      { title: "a".repeat(201) },
      { content: "a".repeat(100_001) },
      { save: true },
    ])
      expect(
        CreativeNoteDraftSchema.safeParse({
          kind: "note",
          title: "标题",
          content: "正文",
          ...extra,
        }).success,
      ).toBe(false);
  });
});
