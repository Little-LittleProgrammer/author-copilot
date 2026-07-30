import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SecureCredentialStore,
  normalizeHttpsOrigin,
} from "../src/main/credentials/secure-credential-store.js";
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
  });
});
