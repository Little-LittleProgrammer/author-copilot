import { z } from "zod";
import {
  AccountSummarySchema,
  AiModelSchema,
  SessionTokensSchema,
  type AccountUser,
  type SessionTokens,
} from "@author-copilot/contracts";
import type { SecureCredentialStore } from "../credentials/index.js";

export class PlatformClient {
  private session: SessionTokens | undefined;
  private sessionInvalid = false;
  private refreshing: Promise<SessionTokens> | undefined;
  constructor(
    readonly baseURL: string | undefined,
    private readonly credentials: SecureCredentialStore,
  ) {}
  private async raw(
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<unknown> {
    if (!this.baseURL)
      throw new Error("平台服务尚未配置 / Platform service is not configured.");
    let response: Response;
    try {
      response = await fetch(`${this.baseURL}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      throw new Error("无法连接平台服务 / Platform service is unavailable.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (
        response.status === 401 &&
        (token !== undefined || path === "/auth/refresh")
      ) {
        this.sessionInvalid = true;
        this.session = undefined;
      }
      throw new Error(
        response.status === 401
          ? "登录已过期或账号密码错误 / Sign in again or check your credentials."
          : response.status === 402
            ? "账户余额不足 / Insufficient balance."
            : response.status === 409
              ? "账号已存在 / Account already exists."
              : response.status === 429
                ? "请求过于频繁，请稍后重试 / Too many requests."
                : "平台操作失败，请稍后重试 / Platform operation failed.",
      );
    }
    return response.json();
  }
  private async save(session: SessionTokens): Promise<void> {
    await this.credentials.setApiKey(
      "platform-refresh",
      JSON.stringify({
        baseURL: this.baseURL,
        refreshToken: session.refreshToken,
        user: session.user,
      }),
    );
    this.session = session;
    this.sessionInvalid = false;
  }
  async user(): Promise<AccountUser | null> {
    if (this.sessionInvalid) return null;
    if (this.session) return this.session.user;
    const stored = await this.credentials.getApiKey("platform-refresh");
    if (!stored) return null;
    const record = z
      .object({
        baseURL: z.string(),
        user: z.object({ id: z.uuid(), email: z.email() }),
      })
      .parse(JSON.parse(stored));
    return record.baseURL === this.baseURL ? record.user : null;
  }
  async login(
    action: "login" | "register",
    email: string,
    password: string,
  ): Promise<void> {
    await this.save(
      SessionTokensSchema.parse(
        await this.raw(`/auth/${action}`, { email, password }),
      ),
    );
  }
  async access(): Promise<string> {
    if (this.sessionInvalid)
      throw new Error(
        "登录已失效，请重新登录 / Session expired; sign in again.",
      );
    if (this.session && this.session.expiresAt * 1000 > Date.now() + 30000)
      return this.session.accessToken;
    this.refreshing ??= (async () => {
      const stored = await this.credentials.getApiKey("platform-refresh");
      if (!stored)
        throw new Error("请先登录平台账号 / Sign in to use platform AI.");
      const record = z
        .object({ baseURL: z.string(), refreshToken: z.string() })
        .parse(JSON.parse(stored));
      if (record.baseURL !== this.baseURL)
        throw new Error(
          "平台地址已变更，请重新登录 / Platform changed; sign in again.",
        );
      const next = SessionTokensSchema.parse(
        await this.raw("/auth/refresh", { refreshToken: record.refreshToken }),
      );
      await this.save(next);
      return next;
    })().finally(() => {
      this.refreshing = undefined;
    });
    return (await this.refreshing).accessToken;
  }
  async logout(): Promise<void> {
    if (!this.sessionInvalid) {
      try {
        await this.raw("/auth/logout", { all: false }, await this.access());
      } catch (error) {
        if (!this.sessionInvalid) throw error;
      }
    }
    await this.credentials.deleteApiKey("platform-refresh");
    this.session = undefined;
    this.sessionInvalid = false;
  }
  async forgot(email: string): Promise<void> {
    await this.raw("/auth/forgot-password", { email });
  }
  async reset(token: string, password: string): Promise<void> {
    await this.raw("/auth/reset-password", { token, password });
  }
  async models(): Promise<z.infer<typeof AiModelSchema>[]> {
    return z
      .object({ models: z.array(AiModelSchema) })
      .parse(await this.raw("/platform/models", undefined, await this.access()))
      .models;
  }
  async account(): Promise<z.infer<typeof AccountSummarySchema>> {
    return AccountSummarySchema.parse(
      await this.raw("/account", undefined, await this.access()),
    );
  }
  async grant(
    taskId: string,
    model: string,
    durationMs: number,
  ): Promise<{ token: string; id: string }> {
    return z
      .object({ token: z.string(), id: z.uuid() })
      .parse(
        await this.raw(
          "/agent/grants",
          { taskId, model, durationMs },
          await this.access(),
        ),
      );
  }
  async revoke(id: string): Promise<void> {
    await this.raw("/agent/revoke", { id }, await this.access());
  }
}
