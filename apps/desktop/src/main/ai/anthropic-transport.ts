import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export interface ClaudeStreamRequest {
  readonly apiKey: string;
  readonly messages: readonly MessageParam[];
  readonly signal: AbortSignal;
  readonly system: string;
  readonly timeoutMs: number;
  readonly onText: (text: string) => void;
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
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  }
}
