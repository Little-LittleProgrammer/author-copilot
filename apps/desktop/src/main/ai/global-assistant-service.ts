import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  GlobalAssistantMessageSchema,
  type GlobalAssistantRequest,
  type GlobalAssistantResponse,
} from "@author-copilot/contracts";
import type { ProviderService } from "./provider-service.js";
import type { AgentTaskRuntimeService } from "./agent/task-runtime-service.js";
import type { AgentCapabilityService } from "./agent/capability-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { ProjectService } from "../project/index.js";
import { atomicWriteFile } from "../project/file-utils.js";

const HistorySchema = z.array(GlobalAssistantMessageSchema).max(100);
export class GlobalAssistantService {
  private active:
    | {
        taskId: string;
        ownerId: number;
        done: Promise<void>;
        cancelled: boolean;
      }
    | undefined;
  constructor(
    private readonly options: {
      workspace: WorkspaceService;
      projects: Pick<ProjectService, "list">;
      providers: Pick<ProviderService, "snapshot" | "resolve">;
      runtime: Pick<AgentTaskRuntimeService, "execute" | "cancel">;
      capabilities: AgentCapabilityService;
    },
  ) {}
  private async history() {
    try {
      return HistorySchema.parse(
        JSON.parse(
          await readFile(
            this.options.workspace.runtime("global-assistant.json"),
            "utf8",
          ),
        ),
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return [];
      throw error;
    }
  }
  async cancelAll(): Promise<void> {
    if (this.active) {
      this.active.cancelled = true;
      this.options.runtime.cancel(this.active.taskId);
      await this.active.done;
    }
  }
  cancelOwner(ownerId: number): void {
    if (this.active?.ownerId === ownerId) {
      this.active.cancelled = true;
      this.options.runtime.cancel(this.active.taskId);
    }
  }
  async request(
    input: GlobalAssistantRequest,
    ownerId: number,
  ): Promise<GlobalAssistantResponse> {
    if (input.action === "cancel") {
      if (this.active?.ownerId === ownerId) {
        this.active.cancelled = true;
        this.options.runtime.cancel(this.active.taskId);
      }
    }
    if (input.action === "clear") {
      if (this.active)
        throw new Error("Cancel the current response before clearing history.");
      await atomicWriteFile(
        this.options.workspace.runtime("global-assistant.json"),
        "[]\n",
        0o600,
      );
    }
    if (input.action === "send") {
      if (this.active) throw new Error("A global response is already running.");
      let finish!: () => void;
      const taskId = randomUUID();
      this.active = {
        taskId,
        ownerId,
        cancelled: false,
        done: new Promise<void>((resolve) => {
          finish = resolve;
        }),
      };
      let route: Awaited<ReturnType<ProviderService["resolve"]>> | undefined;
      try {
        const messages = await this.history();
        await this.options.workspace.publishCatalog(
          await this.options.projects.list(),
        );
        const projectId = this.options.workspace.conversationIdentity();
        const capability = this.options.capabilities.grant(
          {
            projectId,
            readableFileTypes: ["markdown"],
            writableFileTypes: [],
            allowedTools: ["Read", "Glob", "Grep", "Skill"],
            timeoutMs: 10 * 60_000,
          },
          taskId,
        );
        route = await this.options.providers.resolve(
          await this.options.providers.snapshot(),
          { taskId, durationMs: capability.timeoutMs },
        );
        const history = messages
          .slice(-20)
          .map(({ role, content }) => ({ role, content }));
        if (this.active.cancelled)
          return {
            ok: true,
            accountId: this.options.workspace.accountId,
            running: false,
            messages,
          };
        const event = await this.options.runtime.execute(
          {
            taskId,
            projectId,
            prompt: `You are the current account's global writing assistant. Use Skills to locate works and answer questions or compare works. This workspace is read-only. Cite each work title, projectId and manuscript/asset path. Do not mix different works' facts. Do not claim to modify files.\n\nPrevious conversation:\n${JSON.stringify(history).slice(-120_000)}\n\nLatest request:\n${input.prompt}`,
            projectRoot: this.options.workspace.root,
            configDirectory: this.options.workspace.runtimeConfigDirectory,
            apiKey: route.apiKey,
            baseURL: route.baseURL,
            model: route.model,
            readOnly: true,
          },
          () => undefined,
        );
        if (event.type === "agent.task.failed")
          throw new Error(event.error.message);
        if (event.type === "agent.task.completed") {
          const createdAt = new Date().toISOString();
          await atomicWriteFile(
            this.options.workspace.runtime("global-assistant.json"),
            JSON.stringify(
              [
                ...messages,
                { role: "user", content: input.prompt, createdAt },
                { role: "assistant", content: event.summary, createdAt },
              ].slice(-100),
            ),
            0o600,
          );
        }
      } finally {
        this.options.capabilities.revoke(taskId);
        await route?.release?.().catch(() => undefined);
        this.active = undefined;
        finish();
      }
    }
    return {
      ok: true,
      accountId: this.options.workspace.accountId,
      running: this.active !== undefined,
      messages: await this.history(),
    };
  }
}
