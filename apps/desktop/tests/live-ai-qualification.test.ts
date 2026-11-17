import { describe, expect, it } from "vitest";
import { AnthropicClaudeTransport } from "../src/main/ai/anthropic-transport.js";

// Opt-in only: never consume a developer's paid quota during normal verification.
describe.skipIf(
  process.env.AUTHOR_COPILOT_LIVE_AI !== "1" &&
    process.env.npm_lifecycle_event !== "release:qualify-live",
)("live AI release qualification", () => {
  const request = () => {
    const apiKey = process.env.AUTHOR_COPILOT_LIVE_AI_KEY;
    const model = process.env.AUTHOR_COPILOT_LIVE_AI_MODEL;
    if (!apiKey || !model)
      throw new Error(
        "Set AUTHOR_COPILOT_LIVE_AI_KEY and AUTHOR_COPILOT_LIVE_AI_MODEL before live qualification.",
      );
    const baseURL = process.env.AUTHOR_COPILOT_LIVE_AI_URL;
    if (baseURL && new URL(baseURL).protocol !== "https:")
      throw new Error("Live qualification requires HTTPS.");
    return {
      apiKey,
      model,
      ...(baseURL ? { baseURL } : {}),
      signal: AbortSignal.timeout(60000),
      system: "Use only the supplied fictional source. Never invent facts.",
      timeoutMs: 60000,
    };
  };
  it("answers from a supplied manuscript with the real configured model", async () => {
    const chunks: string[] = [];
    await new AnthropicClaudeTransport().stream({
      ...request(),
      messages: [
        {
          role: "user",
          content:
            "Source: Lan keeps a blue key. What color is Lan's key? Reply only BLUE_KEY.",
        },
      ],
      onText: (text) => chunks.push(text),
    });
    expect(chunks.join("")).toContain("BLUE_KEY");
  }, 65000);
  it("returns a structured sourced fact through the real model tool protocol", async () => {
    let result: unknown;
    await new AnthropicClaudeTransport().stream({
      ...request(),
      messages: [
        {
          role: "user",
          content:
            "Source: Lan keeps a blue key. Extract the key color using record_fact.",
        },
      ],
      onText: () => undefined,
      tool: {
        name: "record_fact",
        description: "Record only the explicit key color.",
        inputSchema: {
          type: "object",
          properties: { color: { type: "string", enum: ["blue"] } },
          required: ["color"],
          additionalProperties: false,
        },
        onInput: async (value) => {
          result = value;
        },
      },
    });
    expect(result).toEqual({ color: "blue" });
  }, 65000);
});
