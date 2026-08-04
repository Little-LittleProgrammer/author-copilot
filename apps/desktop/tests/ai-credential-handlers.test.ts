import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IPC_INVOKE_CHANNELS } from "@author-copilot/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown>
  >(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
      ) => electronMock.handlers.set(channel, handler),
    ),
  },
  safeStorage: {
    decryptString: vi.fn(),
    encryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(),
  },
}));

import { registerAiCredentialIpcHandlers } from "../src/main/ipc/ai-credential-handlers.js";
import { SecureCredentialStore } from "../src/main/credentials/secure-credential-store.js";
import type { CredentialEncryption } from "../src/main/credentials/secure-credential-store.js";

const temporaryRoots: string[] = [];
const trustedRendererUrl = "file:///app/renderer/index.html";

const testEncryption: CredentialEncryption = {
  isAvailable: () => true,
  encrypt: (plaintext) =>
    Buffer.from(`encrypted:${Buffer.from(plaintext).toString("base64")}`),
  decrypt: (ciphertext) => {
    const value = ciphertext.toString("utf8");
    if (!value.startsWith("encrypted:")) throw new Error("invalid ciphertext");
    return Buffer.from(value.slice("encrypted:".length), "base64").toString(
      "utf8",
    );
  },
};

async function fixture(
  encryption: CredentialEncryption = testEncryption,
): Promise<{
  readonly filePath: string;
  readonly store: SecureCredentialStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "author-copilot-ai-ipc-"));
  temporaryRoots.push(root);
  const filePath = join(root, "private", "credentials.json");
  return {
    filePath,
    store: new SecureCredentialStore({ filePath, encryption }),
  };
}

function trustedEvent(): unknown {
  const mainFrame = { url: trustedRendererUrl };
  return {
    senderFrame: mainFrame,
    sender: { mainFrame },
  };
}

function handler(channel: string) {
  const registered = electronMock.handlers.get(channel);
  if (registered === undefined) throw new Error(`Missing handler: ${channel}`);
  return registered;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

beforeEach(() => {
  electronMock.handlers.clear();
});

describe("Anthropic credential IPC", () => {
  it("returns status without exposing the API key and supports deletion", async () => {
    const { filePath, store } = await fixture();
    registerAiCredentialIpcHandlers({ credentialStore: store, trustedRendererUrl });
    const apiKey = "sk-ant-api03-ipc-secret";

    await expect(
      handler(IPC_INVOKE_CHANNELS.anthropicCredentialGetStatus)(
        trustedEvent(),
        {},
      ),
    ).resolves.toEqual({
      ok: true,
      status: { configured: false, updatedAt: null },
    });
    const setResponse = await handler(
      IPC_INVOKE_CHANNELS.anthropicCredentialSet,
    )(trustedEvent(), { apiKey });
    expect(setResponse).toEqual({
      ok: true,
      status: { configured: true, updatedAt: expect.any(String) },
    });
    expect(JSON.stringify(setResponse)).not.toContain(apiKey);
    expect(await readFile(filePath, "utf8")).not.toContain(apiKey);

    await expect(
      handler(IPC_INVOKE_CHANNELS.anthropicCredentialDelete)(
        trustedEvent(),
        {},
      ),
    ).resolves.toEqual({
      ok: true,
      status: { configured: false, updatedAt: null },
    });
  });

  it("rejects malformed input without echoing it", async () => {
    const { store } = await fixture();
    registerAiCredentialIpcHandlers({ credentialStore: store, trustedRendererUrl });
    const malformed = "sk-ant-secret\nInjected";

    const response = await handler(
      IPC_INVOKE_CHANNELS.anthropicCredentialSet,
    )(trustedEvent(), { apiKey: malformed, extra: true });
    expect(response).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "The Anthropic credential request is invalid.",
        retryable: false,
      },
    });
    expect(JSON.stringify(response)).not.toContain(malformed);
  });

  it("fails closed for untrusted frames and invalid argument counts", async () => {
    const { store } = await fixture();
    registerAiCredentialIpcHandlers({ credentialStore: store, trustedRendererUrl });
    const getStatus = handler(
      IPC_INVOKE_CHANNELS.anthropicCredentialGetStatus,
    );

    await expect(getStatus(trustedEvent(), {}, {})).rejects.toThrow(
      "invalid argument count",
    );
    const mainFrame = { url: trustedRendererUrl };
    await expect(
      getStatus(
        {
          senderFrame: { url: trustedRendererUrl },
          sender: { mainFrame },
        },
        {},
      ),
    ).rejects.toThrow("IPC sender is not trusted");
  });

  it("normalizes unavailable encryption without exposing internals", async () => {
    const { store } = await fixture({
      ...testEncryption,
      isAvailable: () => false,
    });
    registerAiCredentialIpcHandlers({ credentialStore: store, trustedRendererUrl });

    await expect(
      handler(IPC_INVOKE_CHANNELS.anthropicCredentialSet)(trustedEvent(), {
        apiKey: "sk-ant-secret",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "AI_UNAVAILABLE",
        message: "Secure credential storage is unavailable on this device.",
        retryable: false,
      },
    });
  });
});
