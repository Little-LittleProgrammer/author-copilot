import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionTimeoutError,
  APIUserAbortError,
} from "@anthropic-ai/sdk/error";

export { APIConnectionTimeoutError, APIUserAbortError };

export const APPLICATION_FILE_TOOLS = Object.freeze([
  "mcp__author_copilot__read_text",
  "mcp__author_copilot__write_text",
  "mcp__author_copilot__edit_text",
  "mcp__author_copilot__glob",
  "mcp__author_copilot__grep",
]);

export const DISALLOWED_BUILTIN_TOOLS = Object.freeze([
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "Skill",
  "NotebookEdit",
]);

export function buildAgentToolPolicy() {
  return {
    allowedTools: APPLICATION_FILE_TOOLS,
    disallowedTools: DISALLOWED_BUILTIN_TOOLS,
    permissionMode: "default",
  };
}

export async function collectStreamingText({
  baseURL,
  signal,
  timeout = 1_000,
}) {
  const client = new Anthropic({
    apiKey: "spike-key-not-a-secret",
    baseURL,
    maxRetries: 0,
    timeout,
  });

  const stream = client.messages.stream({
    max_tokens: 32,
    messages: [{ role: "user", content: "stream probe" }],
    model: "claude-spike",
  });

  const abortStream = () => stream.abort();
  if (signal?.aborted) {
    abortStream();
  } else {
    signal?.addEventListener("abort", abortStream, { once: true });
  }

  try {
    let text = "";
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        text += event.delta.text;
      }
    }

    return text;
  } finally {
    signal?.removeEventListener("abort", abortStream);
  }
}

export async function inspectAgentSdk() {
  const agentSdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof agentSdk.query !== "function") {
    throw new Error("Agent SDK does not export query()");
  }

  return {
    queryExported: true,
    toolPolicy: buildAgentToolPolicy(),
  };
}
