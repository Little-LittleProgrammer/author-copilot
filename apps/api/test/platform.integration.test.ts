import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/platform/auth-service.js";
import { PlatformDatabase } from "../src/platform/database.js";
import { BillingService } from "../src/platform/billing-service.js";
import { RelayService } from "../src/platform/relay-service.js";
import type { RelayConfig } from "../src/platform/config.js";

const enabled = process.env.PLATFORM_INTEGRATION === "1";
describe.skipIf(!enabled)("platform MongoDB/Redis integration", () => {
  const database = new PlatformDatabase();
  const mail: { email: string; token: string }[] = [];
  const auth = new AuthService(database, {
    send: async (email, token) => {
      mail.push({ email, token });
    },
  });
  const billing = new BillingService(database);
  const email = `writer-${randomUUID()}@example.com`;
  const password = "platform-test-password-123";
  let userId = "";
  let userToken = "";
  let server: Server;
  let relayServer: Server;
  let endpoint = "";
  let upstreamMode: "complete" | "truncated" | "hold" = "complete";
  const price = {
    input: 1000000,
    output: 2000000,
    cacheRead: 100000,
    cacheWrite: 2000000,
  };
  beforeAll(async () => {
    process.env.AUTH_SIGNING_SECRET =
      "integration-signing-secret-never-production-123";
    process.env.TEST_UPSTREAM_KEY = "upstream-test-secret";
    server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      expect(request.headers["x-api-key"]).toBe("upstream-test-secret");
      if (request.url === "/v1/messages/count_tokens") {
        expect(JSON.parse(body)).not.toHaveProperty("max_tokens");
        response.setHeader("content-type", "application/json");
        response.end('{"input_tokens":10}');
        return;
      }
      response.setHeader("content-type", "text/event-stream");
      response.write(
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      );
      if (upstreamMode === "hold") {
        response.on("close", () => response.end());
        return;
      }
      if (upstreamMode === "complete")
        response.write(
          'data: {"type":"message_delta","usage":{"output_tokens":3}}\n\ndata: {"type":"message_stop"}\n\n',
        );
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const config: RelayConfig = {
      baseURL: `http://127.0.0.1:${address.port}`,
      apiKeyEnv: "TEST_UPSTREAM_KEY",
      defaultModel: "mock-model",
      models: [{ id: "mock-model", name: "Mock", maxOutputTokens: 100, price }],
    };
    const relay = new RelayService(database, billing, async () => config);
    relayServer = createServer(async (request, response) => {
      try {
        const principal = await auth.authenticate(
          request.headers.authorization?.slice(7) ?? "",
          true,
        );
        let input = "";
        for await (const chunk of request) input += String(chunk);
        await relay.messages(principal, JSON.parse(input), response, {});
      } catch {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    });
    await new Promise<void>((resolve) =>
      relayServer.listen(0, "127.0.0.1", resolve),
    );
    const relayAddress = relayServer.address();
    if (!relayAddress || typeof relayAddress === "string")
      throw new Error("No relay address");
    endpoint = `http://127.0.0.1:${relayAddress.port}`;
    const session = await auth.register(email, password);
    userId = session.user.id;
    userToken = session.accessToken;
  }, 30000);
  afterAll(async () => {
    server?.closeAllConnections();
    relayServer?.closeAllConnections();
    await Promise.all(
      [server, relayServer]
        .filter(Boolean)
        .map(
          (value) =>
            new Promise<void>((resolve) => value.close(() => resolve())),
        ),
    );
    if (userId) {
      const db = await database.db();
      for (const collection of ["sessions", "resets", "grants", "ledger"])
        await db.collection(collection).deleteMany({ userId });
      for (const collection of ["users", "wallets"])
        await db
          .collection<{ _id: string }>(collection)
          .deleteOne({ _id: userId });
    }
    await database.onModuleDestroy();
  });
  it("rotates refresh tokens, detects replay, and does not revoke on arbitrary garbage", async () => {
    const first = await auth.login(email, password);
    await expect(
      auth.refresh(`${first.refreshToken.split(".")[0]}.wrong`),
    ).rejects.toThrow();
    expect((await auth.authenticate(first.accessToken)).userId).toBe(userId);
    const second = await auth.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(auth.refresh(first.refreshToken)).rejects.toThrow();
    await expect(auth.authenticate(second.accessToken)).rejects.toThrow();
  });
  it("uses one-time email reset codes and revokes existing sessions", async () => {
    const session = await auth.login(email, password);
    await auth.forgot(email);
    const code = mail.at(-1)!.token;
    expect(mail.at(-1)!.email).toBe(email);
    await auth.reset(code, password);
    await expect(auth.reset(code, password)).rejects.toThrow();
    await expect(auth.authenticate(session.accessToken)).rejects.toThrow();
    userToken = (await auth.login(email, password)).accessToken;
  });
  it("seeds test credit once and prohibits production seeding", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      await billing.developmentCredit(email, 1000);
      await billing.developmentCredit(email, 1000);
    } finally {
      process.env.NODE_ENV = original;
    }
    expect((await billing.summary(userId)).availableMicro).toBe(1000);
    await expect(billing.developmentCredit(email, 1000)).rejects.toThrow();
  });
  it("prevents concurrent overdraft and idempotently releases reservations", async () => {
    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(
      ids.map((id) =>
        billing.reserve(userId, id, "mock-model", 300, 100, price),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const index = results.findIndex((result) => result.status === "fulfilled");
    await billing.finish(ids[index]!, "released");
    await billing.finish(ids[index]!, "released");
    expect((await billing.summary(userId)).availableMicro).toBe(1000);
  });
  it("settles streaming usage and retains uncertain usage without charging an estimate", async () => {
    const request = () =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${userToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "mock-model",
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 100,
          stream: true,
        }),
      });
    const response = await request();
    await response.text();
    expect(response.status).toBe(200);
    const settled = await billing.summary(userId);
    expect(settled.availableMicro).toBe(984);
    expect(settled.heldMicro).toBe(0);
    upstreamMode = "truncated";
    const incomplete = await request();
    await incomplete.text();
    const pending = await billing.summary(userId);
    expect(pending.heldMicro).toBe(220);
    expect(
      pending.records.some(
        (row) => row.status === "pending_review" && row.chargedMicro === 0,
      ),
    ).toBe(true);
    upstreamMode = "complete";
  });
  it("retains reservations after client cancellation and recovers stale undispatched work", async () => {
    upstreamMode = "hold";
    const controller = new AbortController();
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${userToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "mock-model",
        messages: [{ role: "user", content: "Cancelled prompt" }],
        max_tokens: 100,
        stream: true,
      }),
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await expect
      .poll(
        async () =>
          (await billing.summary(userId)).records.filter(
            (row) => row.status === "pending_review",
          ).length,
      )
      .toBe(2);
    upstreamMode = "complete";
    const id = randomUUID();
    await billing.reserve(userId, id, "mock-model", 1, 1, price);
    const db = await database.db();
    await db
      .collection<{ _id: string; createdAt: string }>("ledger")
      .updateOne(
        { _id: id },
        { $set: { createdAt: new Date(Date.now() - 360000).toISOString() } },
      );
    await billing.reconcileStale();
    expect(
      (await billing.summary(userId)).records.find((row) => row.id === id)
        ?.status,
    ).toBe("released");
    const rows = await db.collection("ledger").find({ userId }).toArray();
    expect(JSON.stringify(rows)).not.toContain("Cancelled prompt");
  });
  it("enforces Redis limits", async () => {
    const key = `test:${randomUUID()}`;
    await database.limit(key, 1);
    await expect(database.limit(key, 1)).rejects.toThrow("Too many requests");
  });
  it("binds task grants to a model and revokes them", async () => {
    const principal = await auth.authenticate(userToken);
    const grant = await auth.grant(
      principal,
      randomUUID(),
      "mock-model",
      10000,
    );
    await expect(auth.authenticate(grant.token)).rejects.toThrow();
    expect((await auth.authenticate(grant.token, true)).model).toBe(
      "mock-model",
    );
    await auth.revoke(principal, grant.id);
    await expect(auth.authenticate(grant.token, true)).rejects.toThrow();
  });
});
