import { serializeAssets } from "../src/main/creative-notes/asset-document.js";
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
    service: new CreativeNotesService(async (id) => join(root, id)),
    projectId: randomUUID(),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("creative notes persistence", () => {
  it("confirms facts atomically, retries without duplicates and preserves edits with optimistic conflicts", async () => {
    const { root, service, projectId } = await fixture();
    const source = {
      relativePath: "第一章.md",
      contentHash: "a".repeat(64),
      capturedAt: "2026-11-07T00:00:00.000Z",
    };
    const facts = ["船长", "港口"].map((title) => ({
      id: randomUUID(),
      kind: "fact" as const,
      title,
      content: `${title}的已核对事实`,
      source,
    }));
    const first = await service.confirmFacts({ projectId, facts });
    expect(await service.confirmFacts({ projectId, facts })).toEqual(first);
    expect(
      await new CreativeNotesService(async (id) => join(root, id)).list({
        projectId,
      }),
    ).toHaveLength(2);
    expect(await service.list({ projectId: randomUUID() })).toEqual([]);
    const note = first[0]!;
    const edited = await service.update({
      projectId,
      noteId: note.id,
      expectedUpdatedAt: note.updatedAt,
      kind: "fact",
      title: note.title,
      content: "作者修订",
      source,
    });
    expect(edited.source).toEqual(source);
    await expect(
      service.confirmFacts({
        projectId,
        facts: [facts[1]!, facts[0]!, { ...facts[0]!, id: randomUUID() }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await service.list({ projectId })).toHaveLength(2);
    await expect(
      service.update({
        projectId,
        noteId: note.id,
        expectedUpdatedAt: edited.updatedAt,
        kind: "fact",
        title: note.title,
        content: "伪刷新",
        source: { ...source, contentHash: "b".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await service.list({ projectId })).find((entry) => entry.id === note.id),
    ).toEqual(edited);
    await expect(
      service.update({
        projectId,
        noteId: note.id,
        expectedUpdatedAt: note.updatedAt,
        kind: "fact",
        title: note.title,
        content: "旧编辑",
        source,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await service.delete({ projectId, noteId: note.id });
    expect(await service.list({ projectId })).toHaveLength(1);
  });

  it("does not partially save fact batches that exceed capacity or have invalid candidates", async () => {
    const { root, service, projectId } = await fixture();
    const ordinary = await service.create({
      projectId,
      kind: "note",
      title: "existing",
      content: "text",
    });
    const notes = Array.from({ length: 499 }, () => ({
      ...ordinary,
      id: randomUUID(),
    }));
    const path = join(root, projectId, "创作资产", "资料.md");
    await writeFile(path, serializeAssets(notes));
    const before = await readFile(path, "utf8");
    const fact = {
      id: randomUUID(),
      kind: "fact" as const,
      title: "fact",
      content: "text",
      source: {
        relativePath: "a.md",
        contentHash: "a".repeat(64),
        capturedAt: "2026-11-07T00:00:00.000Z",
      },
    };
    await expect(
      service.confirmFacts({
        projectId,
        facts: [fact, { ...fact, id: randomUUID() }],
      }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(before);
    await expect(
      service.confirmFacts({ projectId, facts: [{ ...fact, content: " " }] }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("preserves summary provenance through author edits, restart and conflicting updates", async () => {
    const { root, service, projectId } = await fixture();
    const source = {
      relativePath: "第一章.md",
      contentHash: "a".repeat(64),
      capturedAt: "2026-11-07T00:00:00.000Z",
    };
    const note = await service.create({
      projectId,
      kind: "summary",
      title: "第一章摘要",
      content: "生成内容",
      source,
    });
    const update = {
      projectId,
      noteId: note.id,
      expectedUpdatedAt: note.updatedAt,
      kind: "summary" as const,
      title: note.title,
      content: "作者核对后的事实",
      source,
    };
    const edited = await service.update(update);
    expect(edited.source).toEqual(source);
    await expect(
      service.update({ ...update, content: "过期覆盖" }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await new CreativeNotesService(async (id) => join(root, id)).list({
        projectId,
      }),
    ).toEqual([edited]);
  });
  it("rejects a 501st note without making existing storage unreadable", async () => {
    const { root, service, projectId } = await fixture();
    const note = await service.create({
      projectId,
      kind: "note",
      title: "Draft",
      content: "One",
    });
    const notes = Array.from({ length: 500 }, () => ({
      ...note,
      id: randomUUID(),
    }));
    const path = join(root, projectId, "创作资产", "资料.md");
    await writeFile(path, serializeAssets(notes), "utf8");
    const before = await readFile(path, "utf8");
    await expect(
      service.create({
        projectId,
        kind: "note",
        title: "Overflow",
        content: "Two",
      }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(before);
    expect(await service.list({ projectId })).toHaveLength(500);
  });
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
    expect(
      await new CreativeNotesService(async (id) => join(root, id)).list({
        projectId,
      }),
    ).toEqual([updated]);
  });

  it("protects malformed storage and detects stale updates", async () => {
    const { root, service, projectId } = await fixture();
    const note = await service.create({
      projectId,
      kind: "note",
      title: "Draft",
      content: "One",
    });
    const path = join(root, projectId, "创作资产", "资料.md");
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
