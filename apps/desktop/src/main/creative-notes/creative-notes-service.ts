import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CreativeNoteCreateRequestSchema,
  CreativeNoteDeleteRequestSchema,
  CreativeNoteSchema,
  CreativeNoteUpdateRequestSchema,
  CreativeNotesProjectRequestSchema,
  CreativeFactsConfirmRequestSchema,
  type CreativeFactsConfirmRequest,
  type CreativeNote,
  type CreativeNoteCreateRequest,
  type CreativeNoteDeleteRequest,
  type CreativeNoteUpdateRequest,
  type CreativeNotesProjectRequest,
} from "@author-copilot/contracts";
import { atomicWriteFile } from "../project/file-utils.js";

import {
  CREATIVE_ASSET_PATH,
  parseAssets,
  serializeAssets,
} from "./asset-document.js";

export class CreativeNotesServiceError extends Error {
  constructor(public readonly code: "not_found" | "conflict") {
    super(
      code === "not_found"
        ? "The creative note was not found."
        : "The creative note was changed elsewhere.",
    );
    this.name = "CreativeNotesServiceError";
  }
}

/** Canonical Markdown assets shared by the editor and Claude Skills. */
export class CreativeNotesService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly resolveProjectRoot: (projectId: string) => Promise<string>,
    private readonly assertCanMutate?: (projectId: string) => void,
  ) {}

  list(request: CreativeNotesProjectRequest): Promise<readonly CreativeNote[]> {
    return this.enqueue(async () => {
      const { projectId } = CreativeNotesProjectRequestSchema.parse(request);
      return this.read(projectId).then((notes) => this.sort(notes));
    });
  }

  create(request: CreativeNoteCreateRequest): Promise<CreativeNote> {
    return this.enqueue(async () => {
      const parsed = CreativeNoteCreateRequestSchema.parse(request);
      const now = new Date().toISOString();
      const note = CreativeNoteSchema.parse({
        id: randomUUID(),
        kind: parsed.kind,
        title: parsed.title,
        content: parsed.content,
        ...(parsed.source ? { source: parsed.source } : {}),
        createdAt: now,
        updatedAt: now,
      });
      const notes = await this.read(parsed.projectId);
      await this.write(parsed.projectId, [...notes, note]);
      return note;
    });
  }

  /** Confirm one reviewed batch atomically. Stable candidate IDs make retries safe. */
  confirmFacts(
    request: CreativeFactsConfirmRequest,
  ): Promise<readonly CreativeNote[]> {
    return this.enqueue(async () => {
      const parsed = CreativeFactsConfirmRequestSchema.parse(request);
      const notes = await this.read(parsed.projectId);
      const now = new Date().toISOString();
      const confirmed = parsed.facts.map((fact) => {
        const existing = notes.find((note) => note.id === fact.id);
        if (existing) {
          if (
            existing.kind !== "fact" ||
            existing.title !== fact.title ||
            existing.content !== fact.content ||
            existing.source?.relativePath !== fact.source.relativePath ||
            existing.source.contentHash !== fact.source.contentHash ||
            existing.source.capturedAt !== fact.source.capturedAt
          )
            throw new CreativeNotesServiceError("conflict");
          return existing;
        }
        return CreativeNoteSchema.parse({
          ...fact,
          createdAt: now,
          updatedAt: now,
        });
      });
      const existingIds = new Set(notes.map((note) => note.id));
      const added = confirmed.filter((note) => !existingIds.has(note.id));
      if (added.length)
        await this.write(parsed.projectId, [...notes, ...added]);
      return confirmed;
    });
  }

  update(request: CreativeNoteUpdateRequest): Promise<CreativeNote> {
    return this.enqueue(async () => {
      const parsed = CreativeNoteUpdateRequestSchema.parse(request);
      const notes = await this.read(parsed.projectId);
      const index = notes.findIndex((note) => note.id === parsed.noteId);
      if (index < 0) throw new CreativeNotesServiceError("not_found");
      const previous = notes[index]!;
      if (previous.updatedAt !== parsed.expectedUpdatedAt)
        throw new CreativeNotesServiceError("conflict");
      // Manual fact edits retain the original evidence snapshot.
      if (
        previous.kind === "fact" &&
        (parsed.kind !== "fact" ||
          parsed.source?.relativePath !== previous.source?.relativePath ||
          parsed.source?.contentHash !== previous.source?.contentHash ||
          parsed.source?.capturedAt !== previous.source?.capturedAt)
      )
        throw new CreativeNotesServiceError("conflict");
      const updatedAt = new Date(
        Math.max(Date.now(), Date.parse(previous.updatedAt) + 1),
      ).toISOString();
      const note = CreativeNoteSchema.parse({
        id: previous.id,
        kind: parsed.kind,
        title: parsed.title,
        content: parsed.content,
        ...(parsed.source ? { source: parsed.source } : {}),
        createdAt: previous.createdAt,
        updatedAt,
      });
      const next = [...notes];
      next[index] = note;
      await this.write(parsed.projectId, next);
      return note;
    });
  }

  delete(request: CreativeNoteDeleteRequest): Promise<boolean> {
    return this.enqueue(async () => {
      const parsed = CreativeNoteDeleteRequestSchema.parse(request);
      const notes = await this.read(parsed.projectId);
      const next = notes.filter((note) => note.id !== parsed.noteId);
      if (next.length === notes.length) return false;
      await this.write(parsed.projectId, next);
      return true;
    });
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async path(projectId: string): Promise<string> {
    const root = await this.resolveProjectRoot(projectId);
    const path = join(root, CREATIVE_ASSET_PATH);
    for (const entry of [dirname(path), path]) {
      try {
        const info = await lstat(entry);
        if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
          throw new Error("Creative asset paths cannot be redirected.");
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }
    return path;
  }

  private async read(projectId: string): Promise<CreativeNote[]> {
    try {
      const path = await this.path(projectId);
      return parseAssets(
        await readFile(path, "utf8"),
        (await stat(path)).mtimeMs,
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return [];
      throw error;
    }
  }

  private async write(
    projectId: string,
    notes: readonly CreativeNote[],
  ): Promise<void> {
    this.assertCanMutate?.(projectId);
    const content = serializeAssets(this.sort(notes));
    const path = await this.path(projectId);
    await mkdir(dirname(path), { recursive: true });
    await atomicWriteFile(path, content, 0o600);
  }

  private sort(notes: readonly CreativeNote[]): CreativeNote[] {
    return [...notes].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }
}
