import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

export interface ClaudeToolRequest {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Tool.InputSchema;
  readonly onInput: (input: unknown) => Promise<void>;
}

export interface ClaudeStreamRequest {
  readonly apiKey: string;
  readonly messages: readonly MessageParam[];
  readonly signal: AbortSignal;
  readonly system: string;
  readonly timeoutMs: number;
  readonly onText: (text: string) => void;
  readonly tool?: ClaudeToolRequest;
}

export interface ClaudeTransport {
  readonly stream: (request: ClaudeStreamRequest) => Promise<void>;
}

export interface AnthropicClaudeTransportOptions {
  readonly baseURL?: string;
  readonly model?: string;
  readonly maxTokens?: number;
}

export class AnthropicClaudeTransport implements ClaudeTransport {
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(private readonly options: AnthropicClaudeTransportOptions = {}) {
    this.model = options.model ?? "claude-sonnet-4-6";
    this.maxTokens = options.maxTokens ?? 4_096;
  }

  async stream(request: ClaudeStreamRequest): Promise<void> {
    const client = new Anthropic({
      apiKey: request.apiKey,
      ...(this.options.baseURL === undefined
        ? {}
        : { baseURL: this.options.baseURL }),
      maxRetries: 0,
      timeout: request.timeoutMs,
    });
    const stream = client.messages.stream({
      max_tokens: this.maxTokens,
      messages: [...request.messages],
      model: this.model,
      system: request.system,
      ...(request.tool === undefined
        ? {}
        : {
            tools: [
              {
                name: request.tool.name,
                description: request.tool.description,
                input_schema: request.tool.inputSchema,
              },
            ],
            tool_choice: { type: "tool" as const, name: request.tool.name },
          }),
    });
    const abort = (): void => stream.abort();
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });

    try {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta" &&
          event.delta.text.length > 0
        ) {
          request.onText(event.delta.text);
        }
      }
      if (request.tool !== undefined) {
        const message = await stream.finalMessage();
        const toolUses = message.content.filter(
          (block): block is ToolUseBlock =>
            block.type === "tool_use" && block.name === request.tool?.name,
        );
        if (toolUses.length !== 1) {
          throw new Error("Claude did not return exactly one patch proposal.");
        }
        await request.tool.onInput(toolUses[0]?.input);
      }
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  }
}
