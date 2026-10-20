import { describe, expect, it } from "vitest";
import {
  AiChatStartRequestSchema,
  AgentStartRequestSchema,
  CreativeNoteReferencesSchema,
  ConversationSchema,
} from "../src/index.js";

const id = "10000000-0000-4000-8000-000000000001";
const reference = {
  id,
  kind: "outline",
  title: "Opening",
  content: "Rain",
  updatedAt: "2026-10-07T00:00:00.000Z",
  originalContentLength: 4,
};

describe("creative note reference contracts", () => {
  it("bounds count and content, requires honest truncation metadata and rejects duplicates and extra fields", () => {
    expect(CreativeNoteReferencesSchema.parse([reference])).toEqual([
      reference,
    ]);
    for (const notes of [
      [reference, reference],
      [
        {
          ...reference,
          content: "x".repeat(4_001),
          originalContentLength: 4_001,
        },
      ],
      [{ ...reference, originalContentLength: 3 }],
      [{ ...reference, path: "/private" }],
      Array.from({ length: 7 }, (_, i) => ({
        ...reference,
        id: `10000000-0000-4000-8000-00000000000${i}`,
      })),
    ]) {
      expect(CreativeNoteReferencesSchema.safeParse(notes).success).toBe(false);
    }
  });

  it("carries the same snapshots through Ask, Agent and durable conversation messages", () => {
    const creativeNotes = [reference];
    expect(
      AiChatStartRequestSchema.parse({
        projectId: id,
        currentDocument: { relativePath: "chapter.md", content: "Text" },
        instruction: "Continue",
        creativeNotes,
      }).creativeNotes,
    ).toEqual(creativeNotes);
    expect(
      AgentStartRequestSchema.parse({
        projectId: id,
        prompt: "Continue",
        readableFileTypes: ["markdown"],
        writableFileTypes: ["markdown"],
        allowedTools: ["mcp__author_copilot__write_text"],
        timeoutMs: 60_000,
        creativeNotes,
      }).creativeNotes,
    ).toEqual(creativeNotes);
    expect(
      ConversationSchema.parse({
        id,
        projectId: id,
        title: "Continue",
        mode: "ask",
        updatedAt: reference.updatedAt,
        messages: [
          {
            id,
            role: "user",
            mode: "ask",
            status: "complete",
            content: "Continue",
            creativeNotes,
          },
        ],
      }).messages[0]?.creativeNotes,
    ).toEqual(creativeNotes);
  });
});
