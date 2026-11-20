import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  IPC_INVOKE_CHANNELS,
  type CreativeNoteGenerationResponse,
} from "@author-copilot/contracts";
import type { CreativeNoteGenerationService } from "../src/main/ai/creative-note-generation-service.js";
import type { TabManager } from "../src/main/tabs/index.js";

const handlers = vi.hoisted(
  () =>
    new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
);
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
    ) => handlers.set(channel, handler),
  },
}));
import { registerCreativeNoteGenerationHandlers } from "../src/main/ipc/creative-note-generation-handlers.js";

describe("creative generation IPC", () => {
  it("checks origin, project ownership and request shape before generating", async () => {
    const projectId = randomUUID();
    const url = "file:///app/renderer/index.html";
    const frame = { url };
    const sender = Object.assign(new EventEmitter(), {
      id: 42,
      mainFrame: frame,
      isDestroyed: () => false,
    });
    const event = { sender, senderFrame: frame };
    const service = {
      generate: vi.fn(async () => ({
        ok: true,
        draft: { kind: "outline", title: "Title", content: "Text" },
      })),
      cancel: vi.fn(() => true),
    };
    registerCreativeNoteGenerationHandlers({
      trustedRendererUrl: url,
      service: service as unknown as CreativeNoteGenerationService,
      getTabManager: () =>
        ({
          getContext: () => ({ kind: "project", project: { projectId } }),
        }) as unknown as TabManager,
    });
    const generate = handlers.get(IPC_INVOKE_CHANNELS.creativeNoteGenerate)!;
    const input = {
      projectId,
      requestId: randomUUID(),
      kind: "outline",
      instruction: "Plan",
      locale: "en-US",
      noteIds: [],
      documentPaths: [],
    };
    expect(
      await generate(event, { ...input, projectId: randomUUID() }),
    ).toMatchObject({ ok: false });
    expect(await generate(event, { ...input, apiKey: "secret" })).toMatchObject(
      { ok: false },
    );
    await expect(
      generate(
        { ...event, senderFrame: { url: "https://foreign.invalid" } },
        input,
      ),
    ).rejects.toThrow();
    expect(service.generate).not.toHaveBeenCalled();
    expect(await generate(event, input)).toMatchObject({ ok: true });
    expect(sender.listenerCount("destroyed")).toBe(0);
    expect(sender.listenerCount("did-start-navigation")).toBe(0);
  });

  it("limits cancellation to the owner and cancels on reload or renderer destruction", async () => {
    const projectId = randomUUID();
    const url = "file:///app/renderer/index.html";
    const frame = { url };
    const sender = Object.assign(new EventEmitter(), {
      id: 42,
      mainFrame: frame,
      isDestroyed: () => false,
    });
    const event = { sender, senderFrame: frame };
    let finish!: (value: CreativeNoteGenerationResponse) => void;
    const service = {
      generate: vi.fn(
        () =>
          new Promise<CreativeNoteGenerationResponse>((resolve) => {
            finish = resolve;
          }),
      ),
      cancel: vi.fn(() => true),
    };
    registerCreativeNoteGenerationHandlers({
      trustedRendererUrl: url,
      service: service as unknown as CreativeNoteGenerationService,
      getTabManager: () =>
        ({
          getContext: () => ({ kind: "project", project: { projectId } }),
        }) as unknown as TabManager,
    });
    const input = {
      projectId,
      requestId: randomUUID(),
      kind: "note",
      instruction: "Plan",
      locale: "en-US",
      noteIds: [],
      documentPaths: [],
    };
    const result = handlers.get(IPC_INVOKE_CHANNELS.creativeNoteGenerate)!(
      event,
      input,
    );
    const cancel = handlers.get(
      IPC_INVOKE_CHANNELS.creativeNoteGenerateCancel,
    )!;
    expect(
      await cancel(
        { ...event, sender: { ...sender, id: 43 } },
        { projectId, requestId: input.requestId },
      ),
    ).toEqual({ accepted: false });
    expect(service.cancel).not.toHaveBeenCalled();
    expect(
      await cancel(event, { projectId, requestId: input.requestId }),
    ).toEqual({ accepted: true });
    sender.emit("did-start-navigation");
    sender.emit("destroyed");
    expect(service.cancel).toHaveBeenCalledTimes(3);
    finish({
      ok: false,
      error: { code: "CANCELLED", message: "Stopped", retryable: true },
    });
    await result;
    expect(
      await cancel(event, { projectId, requestId: input.requestId }),
    ).toEqual({ accepted: false });
    expect(sender.listenerCount("destroyed")).toBe(0);
  });
});
