import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ConversationRequestSchema,
  ConversationSchema,
  type ConversationRequest,
  type ConversationResponse,
} from "@author-copilot/contracts";
import { atomicWriteFile } from "../project/file-utils.js";

export class ConversationStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) {}

  request(input: ConversationRequest): Promise<ConversationResponse> {
    const request = ConversationRequestSchema.parse(input);
    const next = this.pending.then(() => this.perform(request));
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async perform(
    request: ConversationRequest,
  ): Promise<ConversationResponse> {
    const projectId =
      request.action === "save"
        ? request.conversation.projectId
        : request.projectId;
    const directory = join(this.root, projectId);
    if (request.action === "save") {
      const content = JSON.stringify(request.conversation);
      if (Buffer.byteLength(content) > 16 * 1024 * 1024)
        throw new Error("Conversation storage limit reached.");
      await atomicWriteFile(
        join(directory, `${request.conversation.id}.json`),
        content,
        0o600,
      );
      return { ok: true };
    }
    if (request.action === "delete") {
      await rm(join(directory, `${request.id}.json`), { force: true });
      return { ok: true };
    }
    const read = async (id: string) => {
      const conversation = ConversationSchema.parse(
        JSON.parse(await readFile(join(directory, `${id}.json`), "utf8")),
      );
      if (conversation.projectId !== projectId || conversation.id !== id)
        throw new Error("Conversation identity mismatch.");
      return conversation;
    };
    if (request.action === "get")
      return { ok: true, conversation: await read(request.id) };
    const names = await readdir(directory).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    const conversations = [];
    for (const name of names) {
      if (!/^[a-f0-9-]{36}\.json$/iu.test(name)) continue;
      const { messages, ...summary } = await read(name.slice(0, -5));
      conversations.push({
        ...summary,
        taskIds: messages.flatMap((message) =>
          message.taskId ? [message.taskId] : [],
        ),
      });
    }
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, conversations };
  }
}
