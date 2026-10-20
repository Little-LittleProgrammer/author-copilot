import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  LoginRequestSchema,
  ResetPasswordSchema,
} from "@author-copilot/contracts";
import { AuthService } from "./auth-service.js";
import { BillingService } from "./billing-service.js";
import { PlatformDatabase } from "./database.js";
import { RelayService } from "./relay-service.js";

@Controller()
export class PlatformController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(PlatformDatabase) private readonly database: PlatformDatabase,
    @Inject(RelayService) private readonly relay: RelayService,
  ) {}
  private token(request: IncomingMessage, task = false): string {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : task
        ? request.headers["x-api-key"]
        : undefined;
    if (typeof token !== "string")
      throw new HttpException("Authentication required.", 401);
    return token;
  }
  private async authLimit(request: IncomingMessage): Promise<void> {
    await this.database.limit(
      `auth:${request.socket.remoteAddress ?? "unknown"}`,
      20,
    );
  }
  private headers(request: IncomingMessage): Record<string, string> {
    const beta = request.headers["anthropic-beta"];
    return typeof beta === "string" && beta.length <= 2048
      ? { "anthropic-beta": beta }
      : {};
  }
  @Post("auth/register") async register(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    await this.authLimit(request);
    const body = LoginRequestSchema.parse(input);
    return this.auth.register(body.email, body.password);
  }
  @Post("auth/login") async login(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    await this.authLimit(request);
    const body = LoginRequestSchema.parse(input);
    return this.auth.login(body.email, body.password);
  }
  @Post("auth/refresh") async refresh(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    await this.authLimit(request);
    const body = z
      .strictObject({ refreshToken: z.string().max(512) })
      .parse(input);
    return this.auth.refresh(body.refreshToken);
  }
  @Get("auth/me") async me(@Req() request: IncomingMessage): Promise<unknown> {
    return this.auth.user(await this.auth.authenticate(this.token(request)));
  }
  @Post("auth/logout") async logout(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    const body = z
      .strictObject({ all: z.boolean().default(false) })
      .parse(input);
    await this.auth.logout(
      await this.auth.authenticate(this.token(request)),
      body.all,
    );
    return { ok: true };
  }
  @Post("auth/forgot-password") async forgot(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    await this.authLimit(request);
    const body = z.strictObject({ email: z.email() }).parse(input);
    await this.auth.forgot(body.email);
    return { ok: true };
  }
  @Post("auth/reset-password") async reset(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    await this.authLimit(request);
    const body = ResetPasswordSchema.parse(input);
    await this.auth.reset(body.token, body.password);
    return { ok: true };
  }
  @Get("account") async account(
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    return this.billing.summary(
      (await this.auth.authenticate(this.token(request))).userId,
    );
  }
  @Get("platform/models") async platformModels(
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    await this.auth.authenticate(this.token(request));
    return {
      models: await this.relay.models(),
      defaultModel: (await this.relay.config()).defaultModel,
    };
  }
  @Get("v1/models") async models(
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    const principal = await this.auth.authenticate(
      this.token(request, true),
      true,
    );
    return {
      data: (await this.relay.models())
        .filter(
          (model) =>
            principal.model === undefined || principal.model === model.id,
        )
        .map((model) => ({
          id: model.id,
          display_name: model.name,
          type: "model",
          created_at: "2026-01-01T00:00:00Z",
        })),
      has_more: false,
      first_id: null,
      last_id: null,
    };
  }
  @Post("agent/grants") async grant(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    const body = z
      .strictObject({
        taskId: z.uuid(),
        model: z.string(),
        durationMs: z.number().int().min(1000).max(900000),
      })
      .parse(input);
    const principal = await this.auth.authenticate(this.token(request));
    await this.relay.model(body.model, principal);
    if ((await this.billing.summary(principal.userId)).availableMicro <= 0)
      throw new HttpException("Insufficient balance.", 402);
    return this.auth.grant(principal, body.taskId, body.model, body.durationMs);
  }
  @Post("agent/revoke") async revoke(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    const body = z.strictObject({ id: z.uuid() }).parse(input);
    await this.auth.revoke(
      await this.auth.authenticate(this.token(request)),
      body.id,
    );
    return { ok: true };
  }
  @Post("v1/messages/count_tokens")
  @HttpCode(200)
  async count(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
  ): Promise<unknown> {
    const principal = await this.auth.authenticate(
      this.token(request, true),
      true,
    );
    await this.database.limit(`count:${principal.userId}`, 120);
    return {
      input_tokens: await this.relay.count(
        principal,
        input,
        AbortSignal.timeout(30000),
        this.headers(request),
      ),
    };
  }
  @Post("v1/messages")
  @HttpCode(200)
  async messages(
    @Body() input: unknown,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.relay.messages(
      await this.auth.authenticate(this.token(request, true), true),
      input,
      response,
      this.headers(request),
    );
  }
  @Post("payments/checkout") payment(): never {
    // TODO(payments): integrate Alipay or WeChat merchant checkout and verified, idempotent webhooks.
    // No mock order or success callback may credit production wallets.
    throw new HttpException("Online recharge is not available yet.", 503);
  }
}
