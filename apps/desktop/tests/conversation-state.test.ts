import { randomUUID } from "node:crypto";
import type { ConversationMessage } from "@author-copilot/contracts";
import { describe, expect, it } from "vitest";
import {
  conversationHistory,
  creativeNoteReferences,
} from "../src/renderer/src/features/assistant/conversation-state.js";
import {
  lineDiff,
  splitDiff,
} from "../src/renderer/src/features/assistant/line-diff.js";

const message = (
  role: ConversationMessage["role"],
  content: string,
  status: ConversationMessage["status"] = "complete",
): ConversationMessage => ({
  id: randomUUID(),
  role,
  content,
  status,
  mode: "ask",
});
describe("conversation continuity", () => {
  it("captures bounded note snapshots and carries shortened references into later turns", () => {
    const note = {
      id: randomUUID(),
      kind: "outline" as const,
      title: "Opening",
      content: "x".repeat(5_000),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const creativeNotes = creativeNoteReferences([note]);
    expect(creativeNotes[0]?.content).toHaveLength(4_000);
    expect(creativeNotes[0]?.originalContentLength).toBe(5_000);
    note.content = "Changed";
    expect(creativeNotes[0]?.content).toHaveLength(4_000);
    const history = conversationHistory([
      { ...message("user", "Continue"), creativeNotes },
      message("assistant", "A storm arrives"),
    ]);
    expect(history[0]?.creativeNotes?.[0]).toMatchObject({
      title: "Opening",
      originalContentLength: 5_000,
    });
    expect(history[0]?.creativeNotes?.[0]?.content).toHaveLength(500);
    expect(creativeNotes[0]?.content).toHaveLength(4_000);
  });
  it("carries completed Ask and Agent turns while excluding interrupted requests and marking undone edits", () => {
    expect(
      conversationHistory([
        message("user", "old request"),
        message("assistant", "partial", "interrupted"),
        message("user", "new request"),
        {
          ...message("assistant", "edited the scene"),
          mode: "agent",
          resolution: "undone",
        },
      ]),
    ).toEqual([
      { role: "user", content: "new request" },
      {
        role: "assistant",
        content: "edited the scene\n[The user undid these file changes.]",
      },
    ]);
  });
  it("bounds history by complete turns for both provider paths", () => {
    const messages = Array.from({ length: 20 }, (_, i) => [
      message("user", `request ${i}`),
      message("assistant", "x".repeat(30_000)),
    ]).flat();
    const history = conversationHistory(messages);
    expect(history).toHaveLength(12);
    expect(history[0]?.content).toBe("request 14");
    expect(history.every((entry) => entry.content.length <= 8_000)).toBe(true);
  });
});
describe("change previews", () => {
  it("aligns replacements side by side on the same row", () => {
    expect(
      splitDiff(lineDiff("same\nold\ntail", "same\nnew\ntail")),
    ).toMatchObject([
      { left: { text: "same" }, right: { text: "same" } },
      {
        left: { text: "old", type: "remove" },
        right: { text: "new", type: "add" },
      },
      { left: { text: "tail" }, right: { text: "tail" } },
    ]);
  });

  it.each([
    ["one\nold\nthree", "one\nnew\nthree"],
    [null, "new file"],
    ["deleted file", null],
    ["same", "same"],
    ["a\nb\nc\nd", "a\nx\nc\ny\nd"],
    [Array(600).fill("old").join("\n"), Array(600).fill("new").join("\n")],
  ])(
    "reconstructs both file versions without losing lines",
    (before, after) => {
      const lines = lineDiff(before, after);
      expect(
        lines
          .filter((line) => line.type !== "add")
          .map((line) => line.text)
          .join("\n"),
      ).toBe(before ?? "");
      expect(
        lines
          .filter((line) => line.type !== "remove")
          .map((line) => line.text)
          .join("\n"),
      ).toBe(after ?? "");
    },
  );
});
