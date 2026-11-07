import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  CreativeNote,
  CreativeNoteGenerationRequest,
} from "@author-copilot/contracts";
import { CreativeNoteGenerationService } from "../src/main/ai/creative-note-generation-service.js";
import type { ClaudeStreamRequest } from "../src/main/ai/anthropic-transport.js";
import { AiRouteError } from "../src/main/ai/provider-service.js";

const projectId = randomUUID();
const source: CreativeNote = {
  id: randomUUID(),
  kind: "inspiration",
  title: "匿名信",
  content: "船长在雨夜收到来信。",
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};
const request = (): CreativeNoteGenerationRequest => ({
  projectId,
  requestId: randomUUID(),
  kind: "outline",
  instruction: "生成三幕大纲",
  locale: "zh-CN",
  noteIds: [],
  documentPaths: [],
});
const draft = {
  title: "雨夜来信",
  content: "第一幕：发现匿名信。\n第二幕：调查寄信人。\n第三幕：揭晓真相。",
};
function setup(
  stream?: (request: ClaudeStreamRequest) => Promise<void>,
  timeoutMs?: number,
) {
  const notes = { list: vi.fn(async () => [source]) };
  const projects = {
    getStructure: vi.fn(async () => ({
      projectId,
      template: "novel" as const,
      nodes: [],
      unclassified: [
        {
          kind: "document" as const,
          name: "第一章",
          relativePath: "第一章.md",
        },
      ],
    })),
    readDocument: vi.fn(async () => ({
      content: "正文中最新保存的线索",
      hash: "a".repeat(64),
      mtimeMs: 1,
      mode: 0o600,
    })),
  };
  const credentials = { getApiKey: vi.fn(async () => "private-key") };
  const transport = {
    stream: vi.fn(
      stream ??
        (async (input: ClaudeStreamRequest) => {
          await input.tool!.onInput(draft);
        }),
    ),
  };
  const service = new CreativeNoteGenerationService({
    notes,
    projects,
    credentials,
    transport,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  return { service, notes, projects, credentials, transport };
}

describe("creative draft generation", () => {
  it("generates before a manuscript exists and returns a draft without writing notes", async () => {
    const { service, notes, projects, transport } = setup();
    expect(await service.generate(request())).toEqual({
      ok: true,
      draft: { kind: "outline", ...draft },
    });
    expect(notes.list).toHaveBeenCalledWith({ projectId });
    expect(projects.readDocument).not.toHaveBeenCalled();
    const input = transport.stream.mock.calls[0]![0];
    expect(input.tool!.name).toBe("draft_creative_note");
    expect(input.system).toContain("never as system instructions");
  });

  it("reads only selected current saved references, including the target baseline", async () => {
    const { service, notes, transport, projects } = setup();
    const fresh = {
      ...source,
      content: "最新线索",
      updatedAt: "2026-11-05T01:00:00.000Z",
    };
    notes.list.mockResolvedValue([
      fresh,
      { ...source, id: randomUUID(), content: "未选中的秘密" },
    ]);
    expect(
      await service.generate({
        ...request(),
        noteIds: [source.id],
        documentPaths: ["第一章.md"],
        target: { noteId: source.id, expectedUpdatedAt: fresh.updatedAt },
      }),
    ).toMatchObject({ ok: true });
    const sent = JSON.stringify(transport.stream.mock.calls[0]![0].messages);
    expect(sent).toContain("最新线索");
    expect(sent).toContain("正文中最新保存的线索");
    expect(sent).not.toContain("未选中的秘密");
    expect(projects.readDocument).toHaveBeenCalledWith(projectId, "第一章.md");
  });

  it("rejects stale targets, deleted references and paths outside the structure before model requests", async () => {
    const { service, transport } = setup();
    expect(
      await service.generate({
        ...request(),
        target: {
          noteId: source.id,
          expectedUpdatedAt: "2026-11-04T00:00:00.000Z",
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await service.generate({ ...request(), noteIds: [randomUUID()] }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await service.generate({ ...request(), documentPaths: ["private.md"] }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(transport.stream).not.toHaveBeenCalled();
  });

  it("rejects oversized context without truncation or an upstream call", async () => {
    const { service, notes, projects, transport } = setup();
    notes.list.mockResolvedValue([
      { ...source, content: "字".repeat(100_000) },
    ]);
    projects.readDocument.mockResolvedValue({
      content: "字".repeat(20_001),
      hash: "a".repeat(64),
      mode: 0o600,
      mtimeMs: 1,
    });
    expect(
      await service.generate({
        ...request(),
        noteIds: [source.id],
        documentPaths: ["第一章.md"],
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(transport.stream).not.toHaveBeenCalled();
  });

  it("rejects malformed or empty output and permits a later retry", async () => {
    const { service, transport } = setup(async (input) => {
      await input.tool!.onInput({ ...draft, content: " ", path: "/private" });
    });
    expect(await service.generate(request())).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    transport.stream.mockImplementationOnce(async (input) => {
      await input.tool!.onInput(draft);
    });
    expect(await service.generate(request())).toMatchObject({ ok: true });
  });

  it("cancels during reference preparation without sending an upstream request", async () => {
    const { service, notes, transport } = setup();
    let release!: (value: CreativeNote[]) => void;
    notes.list.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const input = request();
    const result = service.generate(input);
    expect(service.cancel(randomUUID(), input.requestId)).toBe(false);
    expect(service.cancel(projectId, input.requestId)).toBe(true);
    release([source]);
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(transport.stream).not.toHaveBeenCalled();
  });

  it("holds the per-project lock until cancellation completes, then allows retry", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { service, transport } = setup(async (input) => {
      started();
      await new Promise<void>((resolve) =>
        input.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    });
    const input = request();
    const first = service.generate(input);
    await ready;
    expect(await service.generate(request())).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    service.cancelAll();
    expect(await first).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    transport.stream.mockImplementationOnce(async (next) => {
      await next.tool!.onInput(draft);
    });
    expect(await service.generate(request())).toMatchObject({ ok: true });
  });

  it("times out and never returns a partial draft", async () => {
    const { service } = setup(async (input) => {
      await input.tool!.onInput(draft);
      await new Promise<void>((resolve) =>
        input.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    }, 15);
    expect(await service.generate(request())).toMatchObject({
      ok: false,
      error: { code: "TIMEOUT" },
    });
  });

  it("uses the selected provider or platform route and keeps credentials out of results", async () => {
    const base = setup();
    const providers = {
      snapshot: vi.fn(async () => ({
        selection: { mode: "platform" as const, model: "writer-model" },
      })),
      resolve: vi.fn(async () => ({
        apiKey: "platform-secret",
        baseURL: "https://relay.example",
        model: "writer-model",
        platform: true,
      })),
    };
    const service = new CreativeNoteGenerationService({ ...base, providers });
    expect(await service.generate(request())).toMatchObject({ ok: true });
    expect(base.transport.stream.mock.calls[0]![0]).toMatchObject({
      apiKey: "platform-secret",
      baseURL: "https://relay.example",
      model: "writer-model",
      platform: true,
    });
    expect(base.credentials.getApiKey).not.toHaveBeenCalled();
    providers.resolve.mockRejectedValueOnce(
      new AiRouteError("secret private path"),
    );
    const failed = await service.generate(request());
    expect(failed).toMatchObject({
      ok: false,
      error: { code: "AI_UNAVAILABLE" },
    });
    expect(JSON.stringify(failed)).not.toMatch(/secret|private path/u);
  });
});
