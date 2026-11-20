import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreativeNoteGenerationRequestSchema,
  CreativeNoteDraftSchema,
  CreativeNoteCreateRequestSchema,
  FactExtractionContentSchema,
  CreativeFactsConfirmRequestSchema,
} from "../src/index.js";

describe("creative generation contracts", () => {
  it("bounds fact extraction and permits only valid sourced candidates for confirmation", () => {
    const fact = {
      id: randomUUID(),
      kind: "fact",
      title: "船长",
      content: "船长失去了左眼。",
      source: {
        relativePath: "第一章.md",
        contentHash: "a".repeat(64),
        capturedAt: "2026-11-07T00:00:00.000Z",
      },
    };
    expect(
      CreativeFactsConfirmRequestSchema.safeParse({
        projectId: randomUUID(),
        facts: [fact],
      }).success,
    ).toBe(true);
    expect(FactExtractionContentSchema.safeParse({ facts: [] }).success).toBe(
      true,
    );
    for (const facts of [
      [],
      [fact, fact],
      [{ ...fact, source: undefined }],
      [{ ...fact, content: " " }],
      [{ ...fact, content: "x".repeat(4001) }],
      [{ ...fact, kind: "summary" }],
      Array.from({ length: 13 }, () => ({ ...fact, id: randomUUID() })),
    ])
      expect(
        CreativeFactsConfirmRequestSchema.safeParse({
          projectId: randomUUID(),
          facts,
        }).success,
      ).toBe(false);
    expect(
      FactExtractionContentSchema.safeParse({
        facts: [{ title: "forged", content: "text", source: fact.source }],
      }).success,
    ).toBe(false);
    const request = {
      projectId: randomUUID(),
      requestId: randomUUID(),
      kind: "fact",
      instruction: "提取事实",
      locale: "zh-CN",
      noteIds: [],
      documentPaths: ["第一章.md"],
    };
    expect(CreativeNoteGenerationRequestSchema.safeParse(request).success).toBe(
      true,
    );
    for (const extra of [
      { documentPaths: [] },
      { documentPaths: ["a.md", "b.md"] },
      { noteIds: [randomUUID()] },
      {
        target: {
          noteId: randomUUID(),
          expectedUpdatedAt: fact.source.capturedAt,
        },
      },
    ])
      expect(
        CreativeNoteGenerationRequestSchema.safeParse({ ...request, ...extra })
          .success,
      ).toBe(false);
  });

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

  it("requires one source document for summaries and rejects ungrounded summary persistence", () => {
    const summary = { ...valid, kind: "summary", documentPaths: ["第一章.md"] };
    expect(CreativeNoteGenerationRequestSchema.safeParse(summary).success).toBe(
      true,
    );
    for (const extra of [
      { documentPaths: [] },
      { documentPaths: ["a.md", "b.md"] },
      { noteIds: [randomUUID()] },
    ])
      expect(
        CreativeNoteGenerationRequestSchema.safeParse({ ...summary, ...extra })
          .success,
      ).toBe(false);
    const source = {
      relativePath: "第一章.md",
      contentHash: "a".repeat(64),
      capturedAt: "2026-11-07T00:00:00.000Z",
    };
    const draft = { kind: "summary", title: "摘要", content: "事实", source };
    expect(CreativeNoteDraftSchema.safeParse(draft).success).toBe(true);
    expect(
      CreativeNoteCreateRequestSchema.safeParse({
        projectId: valid.projectId,
        ...draft,
      }).success,
    ).toBe(true);
    for (const extra of [
      { source: undefined },
      { source: { ...source, relativePath: "../secret.md" } },
      { source: { ...source, contentHash: "bad" } },
      { kind: "outline" },
    ]) {
      expect(
        CreativeNoteDraftSchema.safeParse({ ...draft, ...extra }).success,
      ).toBe(false);
      expect(
        CreativeNoteCreateRequestSchema.safeParse({
          projectId: valid.projectId,
          ...draft,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });
});
