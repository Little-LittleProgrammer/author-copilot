import { createHash } from "node:crypto";
import {
  CreativeNoteSchema,
  type CreativeNote,
} from "@author-copilot/contracts";
import { z } from "zod";

export const CREATIVE_ASSET_PATH = "创作资产/资料.md";
const HeaderSchema = z.strictObject({
  id: CreativeNoteSchema.shape.id,
  kind: CreativeNoteSchema.shape.kind,
  title: CreativeNoteSchema.shape.title,
  createdAt: CreativeNoteSchema.shape.createdAt,
  updatedAt: CreativeNoteSchema.shape.updatedAt,
  source: CreativeNoteSchema.shape.source,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
const digest = (content: string) =>
  createHash("sha256").update(content).digest("hex");
const marker = "<!-- /author-copilot-note -->";

export function serializeAssets(notes: readonly CreativeNote[]): string {
  if (
    notes.length > 500 ||
    new Set(notes.map((note) => note.id)).size !== notes.length
  )
    throw new Error("Invalid asset collection.");
  return (
    "# 创作资料\n\n<!-- author-copilot-assets-v1 -->\n\n" +
    notes
      .map(({ content, ...metadata }) => {
        if (content.includes(marker))
          throw new Error("The note contains a reserved asset delimiter.");
        return `<!-- author-copilot-note ${JSON.stringify({ ...metadata, contentHash: digest(content) })} -->\n${content}\n${marker}\n`;
      })
      .join("\n")
  );
}

export function parseAssets(content: string, mtimeMs: number): CreativeNote[] {
  if (
    !content.startsWith("# 创作资料\n\n<!-- author-copilot-assets-v1 -->\n\n")
  )
    throw new Error("Invalid creative asset document.");
  const notes: CreativeNote[] = [];
  const expression =
    /<!-- author-copilot-note (.+) -->\n([\s\S]*?)\n<!-- \/author-copilot-note -->\n?/gu;
  const rest = content.slice(
    content.indexOf("<!-- author-copilot-assets-v1 -->") +
      "<!-- author-copilot-assets-v1 -->".length,
  );
  if (rest.replace(expression, "").trim())
    throw new Error("Unexpected content outside asset entries.");
  for (const match of rest.matchAll(expression)) {
    const { contentHash, ...metadata } = HeaderSchema.parse(
      JSON.parse(match[1]!),
    );
    const body = match[2]!;
    notes.push(
      CreativeNoteSchema.parse({
        ...metadata,
        content: body,
        updatedAt:
          contentHash === digest(body)
            ? metadata.updatedAt
            : new Date(
                Math.max(mtimeMs, Date.parse(metadata.updatedAt) + 1),
              ).toISOString(),
      }),
    );
  }
  if (
    notes.length > 500 ||
    new Set(notes.map((note) => note.id)).size !== notes.length
  )
    throw new Error("Invalid asset collection.");
  return notes;
}

/** Native edits may revise content; evidence and identity remain application-owned. */
export function validateAssetEdit(before: string | null, after: string): void {
  const previous = before === null ? [] : parseAssets(before, 0);
  const next = parseAssets(after, 0);
  for (const note of next) {
    const original = previous.find((item) => item.id === note.id);
    if (
      !original ||
      JSON.stringify(original.source) !== JSON.stringify(note.source) ||
      original.kind !== note.kind ||
      original.createdAt !== note.createdAt
    )
      throw new Error(
        "Use the author's asset confirmation flow to create notes or change evidence.",
      );
  }
}
