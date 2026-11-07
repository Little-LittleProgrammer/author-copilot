import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Conversation } from "@author-copilot/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore } from "../src/main/ai/conversation-store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "copilot-conversations-"));
  roots.push(root);
  const conversation: Conversation = {
    id: randomUUID(),
    projectId: randomUUID(),
    title: "雨夜开场",
    mode: "agent",
    updatedAt: new Date().toISOString(),
    messages: [
      {
        id: randomUUID(),
        role: "assistant",
        mode: "agent",
        content: "已修改开场",
        status: "complete",
        taskId: randomUUID(),
        resolution: "kept",
      },
    ],
  };
  return { root, conversation, store: new ConversationStore(root) };
}
describe("durable conversation history", () => {
  it("restores messages and review decisions after restart and isolates projects", async () => {
    const { root, store, conversation } = await fixture();
    await store.request({ action: "save", conversation });
    const restarted = new ConversationStore(root);
    expect(
      await restarted.request({
        action: "get",
        projectId: conversation.projectId,
        id: conversation.id,
      }),
    ).toEqual({ ok: true, conversation });
    expect(
      await restarted.request({ action: "list", projectId: randomUUID() }),
    ).toEqual({ ok: true, conversations: [] });
    const list = await restarted.request({
      action: "list",
      projectId: conversation.projectId,
    });
    expect(list).toMatchObject({
      ok: true,
      conversations: [
        { id: conversation.id, taskIds: [conversation.messages[0]!.taskId] },
      ],
    });
    expect(JSON.stringify(list)).not.toContain("已修改开场");
  });
  it("serializes updates and deletion so an earlier save cannot resurrect a removed conversation", async () => {
    const { root, store, conversation } = await fixture();
    const saved = store.request({ action: "save", conversation });
    const renamed = store.request({
      action: "save",
      conversation: { ...conversation, title: "新标题" },
    });
    const deleted = store.request({
      action: "delete",
      projectId: conversation.projectId,
      id: conversation.id,
    });
    await Promise.all([saved, renamed, deleted]);
    expect(
      await store.request({
        action: "list",
        projectId: conversation.projectId,
      }),
    ).toEqual({ ok: true, conversations: [] });
    await expect(
      readFile(join(root, conversation.projectId, `${conversation.id}.json`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reports corrupt history without silently replacing it and rejects path traversal", async () => {
    const { root, store, conversation } = await fixture();
    await store.request({ action: "save", conversation });
    const path = join(root, conversation.projectId, `${conversation.id}.json`);
    await writeFile(path, "damaged data");
    await expect(
      store.request({ action: "list", projectId: conversation.projectId }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("damaged data");
    expect(() =>
      store.request({
        action: "get",
        projectId: "../outside",
        id: conversation.id,
      }),
    ).toThrow();
  });
});
