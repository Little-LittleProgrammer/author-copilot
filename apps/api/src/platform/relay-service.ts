import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { ServerResponse } from "node:http";
import { HttpException } from "@nestjs/common";
import { z } from "zod";
import type { AiModel } from "@author-copilot/contracts";
import { loadRelayConfig, type RelayConfig } from "./config.js";
import type { Principal } from "./auth-service.js";
import type { BillingService, TokenUsage } from "./billing-service.js";
import type { PlatformDatabase } from "./database.js";

const BodySchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(z.unknown()).min(1),
    max_tokens: z.number().int().positive().max(32768),
    stream: z.boolean().optional(),
  })
  .passthrough();
const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().nullable().optional(),
  cache_creation_input_tokens: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional(),
});
export class UsageCollector {
  usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  inputSeen = false;
  outputSeen = false;
  complete = false;
  private buffer = "";
  apply(raw: unknown): void {
    const parsed = UsageSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Invalid upstream usage.");
    const usage = parsed.data;
    if (usage.input_tokens !== undefined) {
      this.usage.input = usage.input_tokens;
      this.inputSeen = true;
    }
    if (usage.output_tokens !== undefined) {
      this.usage.output = usage.output_tokens;
      this.outputSeen = true;
    }
    if (
      usage.cache_read_input_tokens !== undefined &&
      usage.cache_read_input_tokens !== null
    )
      this.usage.cacheRead = usage.cache_read_input_tokens;
    if (
      usage.cache_creation_input_tokens !== undefined &&
      usage.cache_creation_input_tokens !== null
    )
      this.usage.cacheWrite = usage.cache_creation_input_tokens;
  }
  feed(text: string): void {
    this.buffer += text;
    if (this.buffer.length > 2 * 1024 * 1024)
      throw new Error("Upstream event exceeds limit.");
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/u.exec(this.buffer)) !== null) {
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = block
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const event = JSON.parse(data) as {
        type?: string;
        message?: { usage?: unknown };
        usage?: unknown;
      };
      if (event.type === "message_start") this.apply(event.message?.usage);
      if (event.type === "message_delta") this.apply(event.usage);
      if (event.type === "message_stop") this.complete = true;
      if (event.type === "error") throw new Error("Upstream stream failed.");
    }
  }
  result(): TokenUsage | "pending_review" {
    return this.complete && this.inputSeen && this.outputSeen
      ? this.usage
      : "pending_review";
  }
}
export class RelayService {
  private configPromise: Promise<RelayConfig> | undefined;
  constructor(
    private readonly database: PlatformDatabase,
    private readonly billing: BillingService,
    private readonly load: () => Promise<RelayConfig> = loadRelayConfig,
  ) {}
  async config(): Promise<RelayConfig> {
    this.configPromise ??= this.load().catch(() => {
      this.configPromise = undefined;
      throw new HttpException("Platform relay is not configured.", 503);
    });
    return this.configPromise;
  }
  async models(): Promise<AiModel[]> {
    const config = await this.config();
    return [...config.models]
      .sort(
        (left, right) =>
          Number(right.id === config.defaultModel) -
          Number(left.id === config.defaultModel),
      )
      .map(({ id, name, price }) => ({ id, name, price }));
  }
  async model(
    id: string,
    principal: Principal,
  ): Promise<RelayConfig["models"][number]> {
    if (principal.model !== undefined && principal.model !== id)
      throw new HttpException("Task model is not authorized.", 403);
    const model = (await this.config()).models.find((entry) => entry.id === id);
    if (!model) throw new HttpException("Model is not enabled.", 403);
    return model;
  }
  private async upstream(
    path: string,
    body: unknown,
    signal: AbortSignal,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const config = await this.config();
    const key = process.env[config.apiKeyEnv];
    if (!key)
      throw new HttpException("Platform upstream key is not configured.", 503);
    return fetch(`${config.baseURL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    });
  }
  async count(
    principal: Principal,
    input: unknown,
    signal: AbortSignal,
    headers: Record<string, string>,
  ): Promise<number> {
    const body = z
      .object({ model: z.string(), messages: z.array(z.unknown()) })
      .passthrough()
      .parse(input);
    await this.model(body.model, principal);
    const countBody = Object.fromEntries(
      Object.entries(body).filter(([key]) =>
        [
          "model",
          "messages",
          "cache_control",
          "output_config",
          "system",
          "thinking",
          "tool_choice",
          "tools",
          "user_profile_id",
        ].includes(key),
      ),
    );
    const response = await this.upstream(
      "/v1/messages/count_tokens",
      countBody,
      signal,
      headers,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpException("Upstream token counting is unavailable.", 502);
    }
    return z
      .object({ input_tokens: z.number().int().nonnegative().max(10000000) })
      .parse(await response.json()).input_tokens;
  }
  async messages(
    principal: Principal,
    input: unknown,
    response: ServerResponse,
    headers: Record<string, string>,
  ): Promise<void> {
    const body = BodySchema.parse(input);
    const model = await this.model(body.model, principal);
    if (
      Array.isArray(body.tools) &&
      body.tools.some(
        (tool: unknown) =>
          typeof tool !== "object" ||
          tool === null ||
          ("type" in tool && tool.type !== "custom"),
      )
    )
      throw new HttpException(
        "Only client-defined tools are supported by this relay.",
        400,
      );
    if (body.max_tokens > model.maxOutputTokens)
      throw new HttpException("Requested output exceeds the model limit.", 400);
    await this.database.limit(`messages:${principal.userId}`, 60);
    const requestId = randomUUID();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    const disconnect = (): void => {
      if (!response.writableFinished) controller.abort();
    };
    response.on("close", disconnect);
    let reserved = false;
    let sent = false;
    const collector = new UsageCollector();
    try {
      const tokens = await this.count(
        principal,
        body,
        controller.signal,
        headers,
      );
      await this.billing.reserve(
        principal.userId,
        requestId,
        model.id,
        tokens,
        body.max_tokens,
        model.price,
      );
      reserved = true;
      if (controller.signal.aborted)
        throw new Error("Cancelled before upstream send.");
      // Once dispatch starts, a transport failure cannot prove the provider did no work.
      await this.billing.dispatched(requestId);
      sent = true;
      const upstream = await this.upstream(
        "/v1/messages",
        body,
        controller.signal,
        headers,
      );
      if (!upstream.ok) {
        await upstream.body?.cancel();
        if ([400, 401, 403, 404, 413, 422, 429].includes(upstream.status)) {
          await this.billing.finish(requestId, "released");
          reserved = false;
        }
        throw new HttpException(
          upstream.status === 429
            ? "Upstream rate limit reached."
            : "Upstream request failed.",
          upstream.status === 429 ? 429 : 502,
        );
      }
      response.setHeader("x-request-id", requestId);
      response.setHeader("cache-control", "no-store");
      if (body.stream) {
        if (
          !upstream.body ||
          !upstream.headers.get("content-type")?.includes("text/event-stream")
        )
          throw new Error("Expected an event stream.");
        response.setHeader("content-type", "text/event-stream; charset=utf-8");
        response.flushHeaders();
        const decoder = new TextDecoder();
        for await (const chunk of upstream.body) {
          collector.feed(decoder.decode(chunk, { stream: true }));
          if (!response.write(chunk))
            await once(response, "drain", { signal: controller.signal });
        }
        collector.feed(decoder.decode());
      } else {
        const message: unknown = await upstream.json();
        const result = z
          .object({ usage: z.unknown(), type: z.literal("message") })
          .passthrough()
          .parse(message);
        collector.apply(result.usage);
        collector.complete = true;
        response.setHeader("content-type", "application/json");
        response.write(JSON.stringify(message));
      }
      await this.billing.finish(requestId, collector.result());
      reserved = false;
      response.end();
    } finally {
      clearTimeout(timer);
      response.off("close", disconnect);
      controller.abort();
      process.stdout.write(
        JSON.stringify({
          event: "relay_finished",
          requestId,
          model: model.id,
          elapsedMs: Date.now() - startedAt,
          complete: collector.complete,
          inputTokens: collector.usage.input,
          outputTokens: collector.usage.output,
        }) + "\n",
      );
      if (reserved)
        await this.billing.finish(
          requestId,
          sent ? collector.result() : "released",
        );
    }
  }
}
