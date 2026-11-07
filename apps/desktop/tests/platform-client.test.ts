import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { PlatformClient } from "../src/main/platform/platform-client.js";
import { SecureCredentialStore } from "../src/main/credentials/secure-credential-store.js";
import { createEphemeralE2eCredentialEncryption } from "../src/main/credentials/e2e-credential-encryption.js";
it("serializes refresh, encrypts only refresh credentials and permits sign-in after revocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "ac-platform-client-"));
  const path = join(root, "credentials.json");
  const store = new SecureCredentialStore({
    filePath: path,
    encryption: createEphemeralE2eCredentialEncryption(),
  });
  let refreshes = 0;
  let revoked = false;
  const user = { id: randomUUID(), email: "test@example.com" };
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/auth/refresh") refreshes++;
    if (revoked) {
      response.writeHead(401);
      response.end("{}");
      return;
    }
    response.end(
      JSON.stringify({
        user,
        accessToken: "in-memory-access",
        refreshToken: "encrypted-refresh",
        expiresAt:
          request.url === "/auth/login"
            ? 0
            : Math.floor(Date.now() / 1000) + 900,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const baseURL = `http://127.0.0.1:${address.port}`;
    const client = new PlatformClient(baseURL, store);
    await client.login("login", user.email, "password-for-testing");
    expect(
      await Promise.all([client.access(), client.access(), client.access()]),
    ).toEqual(["in-memory-access", "in-memory-access", "in-memory-access"]);
    expect(refreshes).toBe(1);
    expect(await readFile(path, "utf8")).not.toContain("encrypted-refresh");
    expect(await store.getApiKey("platform-refresh")).not.toContain(
      "in-memory-access",
    );
    const restarted = new PlatformClient(baseURL, store);
    expect(await restarted.user()).toEqual(user);
    revoked = true;
    await expect(restarted.access()).rejects.toThrow();
    expect(await restarted.user()).toBeNull();
    await restarted.logout();
    expect(await store.getApiKey("platform-refresh")).toBeNull();
    revoked = false;
    await restarted.login("login", user.email, "password-for-testing");
    expect(await restarted.user()).toEqual(user);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
