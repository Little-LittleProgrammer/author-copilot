import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecureCredentialStore } from "../src/main/credentials/secure-credential-store.js";
import { createEphemeralE2eCredentialEncryption } from "../src/main/credentials/e2e-credential-encryption.js";
import { PlatformClient } from "../src/main/platform/platform-client.js";
import { ProviderService } from "../src/main/ai/provider-service.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(): Promise<{
  service: ProviderService;
  credentials: SecureCredentialStore;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "ac-provider-test-"));
  roots.push(root);
  const credentials = new SecureCredentialStore({
    filePath: join(root, "credentials.json"),
    encryption: createEphemeralE2eCredentialEncryption(),
  });
  const service = new ProviderService(
    join(root, "providers.json"),
    credentials,
    new PlatformClient(undefined, credentials),
  );
  return { service, credentials, root };
}
describe("provider profiles", () => {
  it("adopts the existing official key without rewriting or returning it", async () => {
    const { service, credentials, root } = await fixture();
    await credentials.setApiKey("anthropic", "legacy-secret");
    const before = await readFile(join(root, "credentials.json"), "utf8");
    const state = await service.state();
    expect(state.providers[0]?.configured).toBe(true);
    expect(JSON.stringify(state)).not.toContain("legacy-secret");
    expect((await service.resolve(await service.snapshot())).apiKey).toBe(
      "legacy-secret",
    );
    expect(await readFile(join(root, "credentials.json"), "utf8")).toBe(before);
  });
  it("isolates provider keys and freezes a run across config edits/deletion", async () => {
    const { service } = await fixture();
    const result = await service.execute({
      action: "saveProvider",
      name: "Custom",
      baseURL: "https://example.com",
      apiKey: "first-secret",
    });
    if (!result.ok) throw new Error("unexpected");
    const id = result.state!.providers.find(
      (provider) => provider.name === "Custom",
    )!.id;
    await service.execute({
      action: "select",
      selection: { mode: "custom", providerId: id, model: "custom-model" },
    });
    const snapshot = await service.snapshot();
    await service.execute({
      action: "saveProvider",
      id,
      name: "Custom",
      baseURL: "https://other.example.com",
      apiKey: "second-secret",
    });
    expect(await service.resolve(snapshot)).toMatchObject({
      apiKey: "first-secret",
      baseURL: "https://example.com",
      model: "custom-model",
    });
    expect(await service.resolve(await service.snapshot())).toMatchObject({
      apiKey: "second-secret",
      baseURL: "https://other.example.com",
    });
    await service.execute({ action: "deleteProvider", id });
    expect(await service.resolve(snapshot)).toMatchObject({
      apiKey: "first-secret",
    });
  });
  it("discovers official paginated models and permits manual IDs when unsupported", async () => {
    const { service } = await fixture();
    const requests: string[] = [];
    let unsupported = false;
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      expect(request.headers["x-api-key"]).toBe("custom-secret");
      expect(request.headers["anthropic-version"]).toBe("2023-06-01");
      if (unsupported) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.setHeader("content-type", "application/json");
      const second = request.url?.includes("after_id=first");
      response.end(
        JSON.stringify({
          data: [
            {
              id: second ? "second" : "first",
              display_name: second ? "Second" : "First",
              type: "model",
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
          has_more: !second,
          last_id: second ? "second" : "first",
          first_id: second ? "second" : "first",
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No address");
      const saved = await service.execute({
        action: "saveProvider",
        name: "Mock",
        baseURL: `http://127.0.0.1:${address.port}`,
        apiKey: "custom-secret",
      });
      if (!saved.ok) throw new Error("Save failed");
      const id = saved.state!.providers.find(
        (provider) => provider.name === "Mock",
      )!.id;
      const result = await service.execute({
        action: "models",
        providerId: id,
      });
      expect(result.ok && result.models?.map((model) => model.id)).toEqual([
        "first",
        "second",
      ]);
      expect(requests).toHaveLength(2);
      unsupported = true;
      await expect(
        service.execute({ action: "models", providerId: id }),
      ).rejects.toThrow(/manual/u);
      await service.execute({
        action: "select",
        selection: { mode: "custom", providerId: id, model: "manual-model" },
      });
      expect((await service.snapshot()).selection.model).toBe("manual-model");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
