import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  APIConnectionTimeoutError,
  APIUserAbortError,
  APPLICATION_FILE_TOOLS,
  buildAgentToolPolicy,
  collectStreamingText,
  inspectAgentSdk,
} from "../src/sdk-validation.mjs";

const messageStart = {
  message: {
    content: [],
    id: "msg_spike",
    model: "claude-spike",
    role: "assistant",
    stop_reason: null,
    stop_sequence: null,
    type: "message",
    usage: { input_tokens: 1, output_tokens: 0 },
  },
  type: "message_start",
};

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Anthropic SDK consumes a streamed response from a local mock", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(sse("message_start", messageStart));
      response.write(
        sse("content_block_start", {
          content_block: { citations: null, text: "", type: "text" },
          index: 0,
          type: "content_block_start",
        }),
      );
      response.write(
        sse("content_block_delta", {
          delta: { text: "probe ok", type: "text_delta" },
          index: 0,
          type: "content_block_delta",
        }),
      );
      response.write(
        sse("content_block_stop", { index: 0, type: "content_block_stop" }),
      );
      response.write(
        sse("message_delta", {
          delta: { stop_reason: "end_turn", stop_sequence: null },
          type: "message_delta",
          usage: { output_tokens: 2 },
        }),
      );
      response.end(sse("message_stop", { type: "message_stop" }));
    },
    async (baseURL) => {
      assert.equal(await collectStreamingText({ baseURL }), "probe ok");
    },
  );
});

test("Anthropic SDK forwards AbortSignal cancellation", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(sse("message_start", messageStart));
    },
    async (baseURL) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);
      await assert.rejects(
        collectStreamingText({ baseURL, signal: controller.signal }),
        (error) => error instanceof APIUserAbortError,
      );
    },
  );
});

test("Anthropic SDK enforces request timeout", async () => {
  await withServer(
    () => {},
    async (baseURL) => {
      await assert.rejects(
        collectStreamingText({ baseURL, timeout: 20 }),
        (error) => error instanceof APIConnectionTimeoutError,
      );
    },
  );
});

test("Agent SDK loads with built-ins denied and only application file tools allowed", async () => {
  const result = await inspectAgentSdk();
  const policy = buildAgentToolPolicy();
  assert.equal(result.queryExported, true);
  assert.deepEqual(policy.allowedTools, APPLICATION_FILE_TOOLS);
  assert.ok(
    policy.allowedTools.every((tool) =>
      tool.startsWith("mcp__author_copilot__"),
    ),
  );
  assert.ok(policy.disallowedTools.includes("Bash"));
  assert.ok(policy.disallowedTools.includes("Read"));
  assert.ok(policy.disallowedTools.includes("Write"));
  assert.ok(policy.disallowedTools.includes("WebFetch"));
  assert.ok(policy.disallowedTools.includes("Task"));
});
