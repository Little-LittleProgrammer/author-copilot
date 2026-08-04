import { createServer, type RequestListener, type Server } from "node:http";

import { APIConnectionError, RateLimitError } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnthropicClaudeTransport } from "../src/main/ai/anthropic-transport.js";

const servers: Server[] = [];

async function loopback(respond: RequestListener): Promise<string> {
  const server = createServer(respond);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Loopback server did not expose a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) =>
              error === undefined ? resolve() : reject(error),
            ),
          ),
      ),
  );
});

describe("Anthropic transport", () => {
  it("streams text from an Anthropic-compatible loopback endpoint", async () => {
    const baseURL = await loopback((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      const events = [
        {
          type: "message_start",
          message: {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "她推开" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "门。" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 2 },
        },
        { type: "message_stop" },
      ];
      response.end(
        events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
      );
    });
    const chunks: string[] = [];
    await new AnthropicClaudeTransport({ baseURL }).stream({
      apiKey: "sk-ant-loopback",
      messages: [{ role: "user", content: "继续" }],
      signal: new AbortController().signal,
      system: "test",
      timeoutMs: 1_000,
      onText: (text) => chunks.push(text),
    });
    expect(chunks).toEqual(["她推开", "门。"]);
  });

  it("surfaces 429 and connection failures for normalization", async () => {
    const baseURL = await loopback((_request, response) => {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          type: "error",
          error: { type: "rate_limit_error", message: "slow down" },
        }),
      );
    });
    const request = {
      apiKey: "sk-ant-loopback",
      messages: [{ role: "user" as const, content: "继续" }],
      signal: new AbortController().signal,
      system: "test",
      timeoutMs: 300,
      onText: vi.fn(),
    };
    await expect(
      new AnthropicClaudeTransport({ baseURL }).stream(request),
    ).rejects.toBeInstanceOf(RateLimitError);
    await expect(
      new AnthropicClaudeTransport({ baseURL: "http://127.0.0.1:1" }).stream(
        request,
      ),
    ).rejects.toBeInstanceOf(APIConnectionError);
  });
});
