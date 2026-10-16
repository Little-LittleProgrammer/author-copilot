import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SecureCredentialStore,
  normalizeHttpsOrigin,
} from "../src/main/credentials/secure-credential-store.js";
import { createEphemeralE2eCredentialEncryption } from "../src/main/credentials/e2e-credential-encryption.js";
import type {
  CredentialEncryption,
  CredentialStoreError,
} from "../src/main/credentials/secure-credential-store.js";

const temporaryRoots: string[] = [];

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
  const root = await mkdtemp(join(tmpdir(), "author-copilot-credentials-"));
  temporaryRoots.push(root);
  const filePath = join(root, "private", "credentials.json");
  return {
    filePath,
    store: new SecureCredentialStore({ filePath, encryption }),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SecureCredentialStore", () => {
  it("stores only encrypted secrets and returns status without a secret", async () => {
    const { filePath, store } = await fixture();
    const credential = {
      origin: "https://Example.COM:8443",
      username: "writer",
      secret: "not-in-plaintext",
    };

    await store.setHttpsCredential(credential);

    const contents = await readFile(filePath, "utf8");
    expect(contents).not.toContain(credential.secret);
    await expect(
      store.getHttpsCredentialStatus("https://example.com:8443"),
    ).resolves.toMatchObject({
      origin: "https://example.com:8443",
      configured: true,
      username: "writer",
    });
    await expect(
      store.getHttpsCredential("https://example.com:8443"),
    ).resolves.toEqual({
      origin: "https://example.com:8443",
      username: "writer",
      secret: credential.secret,
    });
    await expect(
      store.deleteHttpsCredential("https://example.com:8443"),
    ).resolves.toBe(true);
    await expect(
      store.getHttpsCredentialStatus("https://example.com:8443"),
    ).resolves.toEqual({
      origin: "https://example.com:8443",
      configured: false,
      username: null,
      updatedAt: null,
    });
  });

  it("stores an Anthropic API key without plaintext or renderer-safe leakage", async () => {
    const { filePath, store } = await fixture();
    const apiKey = "sk-ant-api03-not-in-plaintext";

    await store.setApiKey("anthropic", apiKey);

    const contents = await readFile(filePath, "utf8");
    expect(contents).not.toContain(apiKey);
    await expect(store.getApiKeyStatus("anthropic")).resolves.toEqual({
      configured: true,
      updatedAt: expect.any(String),
    });
    await expect(store.getApiKey("anthropic")).resolves.toBe(apiKey);
    await expect(store.deleteApiKey("anthropic")).resolves.toBe(true);
    await expect(store.deleteApiKey("anthropic")).resolves.toBe(false);
    await expect(store.getApiKeyStatus("anthropic")).resolves.toEqual({
      configured: false,
      updatedAt: null,
    });
  });

  it("upgrades a legacy store without losing its HTTPS credential", async () => {
    const { filePath, store } = await fixture();
    const credential = {
      origin: "https://example.com",
      username: "writer",
      secret: "legacy-secret",
    };
    await store.setHttpsCredential(credential);
    const legacy = JSON.parse(await readFile(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = 1;
    delete legacy.apiKeys;
    await writeFile(filePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    await expect(store.getHttpsCredential(credential.origin)).resolves.toEqual(
      credential,
    );
    await store.setApiKey("anthropic", "sk-ant-migrated");

    const upgraded = JSON.parse(await readFile(filePath, "utf8")) as {
      readonly schemaVersion: number;
      readonly entries: Record<string, unknown>;
      readonly apiKeys: Record<string, unknown>;
    };
    expect(upgraded.schemaVersion).toBe(2);
    expect(Object.keys(upgraded.entries)).toHaveLength(1);
    expect(upgraded.apiKeys).toHaveProperty("anthropic");
    await expect(store.getHttpsCredential(credential.origin)).resolves.toEqual(
      credential,
    );
  });

  it("rejects non-origin URLs and invalid credential text", async () => {
    const { store } = await fixture();
    for (const origin of [
      "http://example.com",
      "https://user@example.com",
      "https://example.com/repository",
      "file:///tmp/repository",
    ]) {
      expect(() => normalizeHttpsOrigin(origin)).toThrow(
        expect.objectContaining<Partial<CredentialStoreError>>({
          code: "invalid_origin",
        }),
      );
    }
    await expect(
      store.setHttpsCredential({
        origin: "https://example.com",
        username: "writer\nInjected",
        secret: "secret",
      }),
    ).rejects.toMatchObject({ code: "invalid_credential" });
  });

  it("fails closed when OS encryption is unavailable", async () => {
    const { store } = await fixture({
      ...testEncryption,
      isAvailable: () => false,
    });
    await expect(
      store.setHttpsCredential({
        origin: "https://example.com",
        username: "writer",
        secret: "secret",
      }),
    ).rejects.toMatchObject({ code: "encryption_unavailable" });
    await expect(
      store.setApiKey("anthropic", "sk-ant-unavailable"),
    ).rejects.toMatchObject({ code: "encryption_unavailable" });
  });

  it("rejects corrupt and symbolic-link stores", async () => {
    const corrupt = await fixture();
    await corrupt.store.setHttpsCredential({
      origin: "https://example.com",
      username: "writer",
      secret: "secret",
    });
    await writeFile(corrupt.filePath, "{}", "utf8");
    await expect(
      corrupt.store.getHttpsCredentialStatus("https://example.com"),
    ).rejects.toMatchObject({ code: "invalid_store" });
    await expect(
      corrupt.store.getApiKeyStatus("anthropic"),
    ).rejects.toMatchObject({ code: "invalid_store" });

    const linked = await fixture();
    const target = join(linked.filePath, "..", "target.json");
    await linked.store.setHttpsCredential({
      origin: "https://example.com",
      username: "writer",
      secret: "secret",
    });
    await writeFile(target, "{}", "utf8");
    await rm(linked.filePath);
    await symlink(target, linked.filePath);
    await expect(
      linked.store.getHttpsCredentialStatus("https://example.com"),
    ).rejects.toMatchObject({ code: "invalid_store" });
    await expect(
      linked.store.getApiKeyStatus("anthropic"),
    ).rejects.toMatchObject({ code: "invalid_store" });
  });
});

describe("ephemeral E2E credential encryption", () => {
  it("encrypts and authenticates the test credential payload", () => {
    const encryption = createEphemeralE2eCredentialEncryption();
    const plaintext = "e2e-credential-secret";
    const ciphertext = encryption.encrypt(plaintext);

    expect(ciphertext.toString("utf8")).not.toContain(plaintext);
    expect(encryption.decrypt(ciphertext)).toBe(plaintext);

    const tampered = Buffer.from(ciphertext);
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 1;
    expect(() => encryption.decrypt(tampered)).toThrow();
  });
});
