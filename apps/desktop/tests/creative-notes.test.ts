import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CreativeNotesService } from "../src/main/creative-notes/creative-notes-service.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "creative-notes-"));
  roots.push(root);
  return {
    root,
    service: new CreativeNotesService(root),
    projectId: randomUUID(),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("creative notes persistence", () => {
  it("creates, updates, sorts and isolates notes per project", async () => {
    const { root, service, projectId } = await fixture();
    const note = await service.create({
      projectId,
      kind: "inspiration",
      title: "Harbor",
      content: "A bell rings at dawn.",
    });
    const updated = await service.update({
      projectId,
      noteId: note.id,
      expectedUpdatedAt: note.updatedAt,
      kind: "outline",
      title: "Opening",
      content: "The bell wakes the harbor.",
    });
    expect(updated.createdAt).toBe(note.createdAt);
    expect(updated.updatedAt).not.toBe(note.updatedAt);
    expect(await service.list({ projectId })).toEqual([updated]);
    expect(await service.list({ projectId: randomUUID() })).toEqual([]);
    expect(await new CreativeNotesService(root).list({ projectId })).toEqual([
      updated,
    ]);
  });

  it("protects malformed storage and detects stale updates", async () => {
    const { root, service, projectId } = await fixture();
    const note = await service.create({
      projectId,
      kind: "note",
      title: "Draft",
      content: "One",
    });
    const path = join(root, `${projectId}.json`);
    await writeFile(path, "damaged", "utf8");
    await expect(service.list({ projectId })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("damaged");
    await expect(
      service.update({
        projectId,
        noteId: note.id,
        expectedUpdatedAt: note.updatedAt,
        kind: "note",
        title: "Changed",
        content: "Two",
      }),
    ).rejects.toThrow();
  });

  it("returns false for a missing delete and rejects stale revisions", async () => {
    const { service, projectId } = await fixture();
    expect(await service.delete({ projectId, noteId: randomUUID() })).toBe(
      false,
    );
    const note = await service.create({
      projectId,
      kind: "note",
      title: "Draft",
      content: "One",
    });
    await expect(
      service.update({
        projectId,
        noteId: note.id,
        expectedUpdatedAt: new Date(0).toISOString(),
        kind: "note",
        title: "Changed",
        content: "Two",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await service.delete({ projectId, noteId: note.id })).toBe(true);
    expect(await service.list({ projectId })).toEqual([]);
  });
});
