import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CreativeNoteCreateRequestSchema,
  CreativeNoteDeleteRequestSchema,
  CreativeNoteSchema,
  CreativeNoteUpdateRequestSchema,
  CreativeNotesProjectRequestSchema,
  type CreativeNote,
  type CreativeNoteCreateRequest,
  type CreativeNoteDeleteRequest,
  type CreativeNoteUpdateRequest,
  type CreativeNotesProjectRequest,
} from "@author-copilot/contracts";
import { z } from "zod";
import { atomicWriteFile } from "../project/file-utils.js";

const NotesFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  notes: z.array(CreativeNoteSchema).max(500),
});

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

/** Main-owned per-project planning notes. They never enter the project repository. */
export class CreativeNotesService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {}

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
        createdAt: now,
        updatedAt: now,
      });
      const notes = await this.read(parsed.projectId);
      await this.write(parsed.projectId, [...notes, note]);
      return note;
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
      const updatedAt = new Date(
        Math.max(Date.now(), Date.parse(previous.updatedAt) + 1),
      ).toISOString();
      const note = CreativeNoteSchema.parse({
        id: previous.id,
        kind: parsed.kind,
        title: parsed.title,
        content: parsed.content,
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

  private path(projectId: string): string {
    return join(this.root, `${projectId}.json`);
  }

  private async read(projectId: string): Promise<CreativeNote[]> {
    try {
      const stored = NotesFileSchema.parse(
        JSON.parse(await readFile(this.path(projectId), "utf8")),
      );
      return stored.notes;
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
    const stored = NotesFileSchema.parse({
      schemaVersion: 1,
      notes: this.sort(notes),
    });
    const path = this.path(projectId);
    await mkdir(dirname(path), { recursive: true });
    await atomicWriteFile(path, `${JSON.stringify(stored)}\n`, 0o600);
  }

  private sort(notes: readonly CreativeNote[]): CreativeNote[] {
    return [...notes].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }
}
