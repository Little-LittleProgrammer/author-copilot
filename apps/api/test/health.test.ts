import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApplication } from "../src/application.js";

describe("GET /health", () => {
  let app: INestApplication | undefined;
  let endpoint: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.APP_VERSION;
    delete process.env.CORS_ENABLED;
    delete process.env.CORS_ORIGINS;
    app = await createApplication();
    await app.listen(0, "127.0.0.1");

    const server = app.getHttpServer() as Server;
    const address = server.address() as AddressInfo;
    endpoint = `http://127.0.0.1:${address.port}/health`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns structured service health without enabling CORS", async () => {
    const response = await fetch(endpoint);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      service: "author-copilot-api",
      status: "ok",
      timestamp: expect.any(String),
      version: "0.0.0",
    });
    expect(new Date(String(body.timestamp)).toISOString()).toBe(body.timestamp);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-powered-by")).toBeNull();
  });
});
