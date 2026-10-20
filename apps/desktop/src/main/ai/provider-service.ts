import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  AiSelectionSchema,
  ApiBaseUrlSchema,
  ProviderIdSchema,
  type AiSelection,
  type AiSettingsRequest,
  type AiSettingsResponse,
  type AiSettingsState,
} from "@author-copilot/contracts";
import type {
  ApiKeyProvider,
  SecureCredentialStore,
} from "../credentials/secure-credential-store.js";
import type { PlatformClient } from "../platform/platform-client.js";

const StoredProviderSchema = z.strictObject({
  id: ProviderIdSchema,
  name: z.string().min(1).max(80),
  baseURL: ApiBaseUrlSchema,
  keyId: z.uuid().optional(),
});
const StoreSchema = z.strictObject({
  version: z.literal(1),
  providers: z.array(StoredProviderSchema),
  selection: AiSelectionSchema,
});
type Store = z.infer<typeof StoreSchema>;
export class AiRouteError extends Error {}

export interface AiRoute {
  apiKey: string;
  baseURL: string;
  model: string;
  platform: boolean;
  release?: () => Promise<void>;
}
export class ProviderService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly filePath: string,
    private readonly credentials: SecureCredentialStore,
    private readonly platform: PlatformClient,
  ) {}
  private key(id: string): ApiKeyProvider {
    return id === "anthropic" ? "anthropic" : `provider:${id}`;
  }
  private async load(): Promise<Store> {
    try {
      return StoreSchema.parse(
        JSON.parse(await readFile(this.filePath, "utf8")),
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      // Existing encrypted Anthropic keys remain in place and are adopted by the official profile.
      return {
        version: 1,
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            baseURL: "https://api.anthropic.com",
          },
        ],
        selection: {
          mode: "custom",
          providerId: "anthropic",
          model: "claude-sonnet-4-6",
        },
      };
    }
  }
  private async save(store: Store): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(StoreSchema.parse(store)), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, this.filePath);
    } finally {
      await rm(temp, { force: true });
    }
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  async state(): Promise<AiSettingsState> {
    const store = await this.load();
    return {
      providers: await Promise.all(
        store.providers.map(async (provider) => ({
          id: provider.id,
          name: provider.name,
          baseURL: provider.baseURL,
          configured: (
            await this.credentials.getApiKeyStatus(
              this.key(provider.keyId ?? provider.id),
            )
          ).configured,
        })),
      ),
      selection: store.selection,
      platformConfigured: this.platform.baseURL !== undefined,
      user: await this.platform.user(),
    };
  }
  async execute(request: AiSettingsRequest): Promise<AiSettingsResponse> {
    return this.exclusive(async () => {
      switch (request.action) {
        case "state":
          return { ok: true, state: await this.state() };
        case "saveProvider": {
          const store = await this.load();
          const id = request.id ?? randomUUID();
          const previous = store.providers.find(
            (provider) => provider.id === id,
          );
          if (
            id === "anthropic" &&
            request.baseURL !== "https://api.anthropic.com"
          )
            throw new AiRouteError(
              "官方供应商地址不可修改，请新建自定义供应商 / Add a custom provider for another URL.",
            );
          if (
            previous &&
            previous.baseURL !== request.baseURL &&
            !request.apiKey
          )
            throw new AiRouteError(
              "修改供应商地址时请重新输入 Key / Enter a key when changing the provider URL.",
            );
          if (!previous && !request.apiKey)
            throw new AiRouteError("请输入 API Key / API key required.");
          // New/changed secrets are written first; profile publication never references a missing key.
          const keyId =
            id !== "anthropic" && request.apiKey
              ? randomUUID()
              : previous?.keyId;
          if (request.apiKey)
            await this.credentials.setApiKey(
              this.key(keyId ?? id),
              request.apiKey,
            );
          const provider = {
            id,
            name: request.name,
            baseURL: request.baseURL,
            ...(keyId ? { keyId } : {}),
          };
          await this.save({
            ...store,
            providers: [
              ...store.providers.filter((entry) => entry.id !== id),
              provider,
            ],
          });
          if (previous && previous.id !== "anthropic" && request.apiKey)
            await this.credentials.deleteApiKey(
              this.key(previous.keyId ?? previous.id),
            );
          return { ok: true, state: await this.state() };
        }
        case "deleteProvider": {
          const store = await this.load();
          const previous = store.providers.find(
            (entry) => entry.id === request.id,
          );
          await this.credentials.deleteApiKey(
            this.key(previous?.keyId ?? request.id),
          );
          if (request.id !== "anthropic")
            await this.save({
              ...store,
              providers: store.providers.filter(
                (entry) => entry.id !== request.id,
              ),
              selection:
                store.selection.mode === "custom" &&
                store.selection.providerId === request.id
                  ? {
                      mode: "custom",
                      providerId: "anthropic",
                      model: "claude-sonnet-4-6",
                    }
                  : store.selection,
            });
          return { ok: true, state: await this.state() };
        }
        case "select": {
          const store = await this.load();
          if (request.selection.mode === "custom") {
            const providerId = request.selection.providerId;
            if (!store.providers.some((entry) => entry.id === providerId))
              throw new AiRouteError("供应商不存在 / Provider not found.");
          } else if (
            !(await this.platform.models()).some(
              (model) => model.id === request.selection.model,
            )
          )
            throw new AiRouteError(
              "平台模型未开放 / Platform model is not enabled.",
            );
          await this.save({ ...store, selection: request.selection });
          return { ok: true, state: await this.state() };
        }
        case "models": {
          if (!request.providerId)
            return { ok: true, models: await this.platform.models() };
          const provider = (await this.load()).providers.find(
            (entry) => entry.id === request.providerId,
          );
          if (!provider)
            throw new AiRouteError("供应商不存在 / Provider not found.");
          const apiKey = await this.credentials.getApiKey(
            this.key(provider.keyId ?? provider.id),
          );
          if (!apiKey)
            throw new AiRouteError(
              "请先配置 API Key / Configure an API key first.",
            );
          try {
            const client = new Anthropic({
              apiKey,
              baseURL: provider.baseURL,
              timeout: 15000,
              maxRetries: 0,
              fetchOptions: { redirect: "error" },
            });
            const models = [];
            const signal = AbortSignal.timeout(20000);
            for await (const model of client.models.list(
              { limit: 100 },
              { signal },
            )) {
              models.push({ id: model.id, name: model.display_name });
              if (models.length >= 2000) break;
            }
            return {
              ok: true,
              models,
              ...(models.length === 0
                ? {
                    notice:
                      "供应商未返回模型，可手动填写模型 ID / Empty model list; enter a model ID manually.",
                  }
                : {}),
            };
          } catch {
            throw new AiRouteError(
              "模型列表获取失败或接口不受支持，可手动填写模型 ID；尚未验证连接 / Model discovery unavailable; manual model IDs are allowed, but connectivity is unverified.",
            );
          }
        }
        case "login":
        case "register":
          await this.platform.login(
            request.action,
            request.email,
            request.password,
          );
          return { ok: true, state: await this.state() };
        case "logout":
          await this.platform.logout();
          return { ok: true, state: await this.state() };
        case "forgotPassword":
          await this.platform.forgot(request.email);
          return {
            ok: true,
            notice:
              "如账号存在，将发送重置码 / If the account exists, a reset code will be emailed.",
          };
        case "resetPassword":
          await this.platform.reset(request.token, request.password);
          return {
            ok: true,
            notice: "密码已重置，请重新登录 / Password reset; sign in again.",
          };
        case "account":
          return { ok: true, account: await this.platform.account() };
      }
    });
  }
  async snapshot(): Promise<{
    selection: AiSelection;
    provider?: z.infer<typeof StoredProviderSchema>;
    apiKey?: string;
  }> {
    return this.exclusive(async () => {
      const store = await this.load();
      if (store.selection.mode === "platform")
        return { selection: store.selection };
      const providerId = store.selection.providerId;
      const provider = store.providers.find((entry) => entry.id === providerId);
      const apiKey = await this.credentials.getApiKey(
        this.key(provider?.keyId ?? providerId),
      );
      if (!provider || !apiKey)
        throw new AiRouteError(
          "请配置供应商和 API Key / Configure a provider and API key first.",
        );
      return { selection: store.selection, provider, apiKey };
    });
  }
  async resolve(
    snapshot: Awaited<ReturnType<ProviderService["snapshot"]>>,
    task?: { taskId: string; durationMs: number },
  ): Promise<AiRoute> {
    try {
      return await this.resolveRoute(snapshot, task);
    } catch (error) {
      throw new AiRouteError(
        error instanceof Error ? error.message : "AI connection unavailable.",
      );
    }
  }
  private async resolveRoute(
    snapshot: Awaited<ReturnType<ProviderService["snapshot"]>>,
    task?: { taskId: string; durationMs: number },
  ): Promise<AiRoute> {
    const { selection } = snapshot;
    if (selection.mode === "custom")
      return {
        apiKey: snapshot.apiKey!,
        baseURL: snapshot.provider!.baseURL,
        model: selection.model,
        platform: false,
      };
    const models = await this.platform.models();
    if (!models.some((model) => model.id === selection.model))
      throw new AiRouteError("平台模型未开放 / Platform model unavailable.");
    if ((await this.platform.account()).availableMicro <= 0)
      throw new AiRouteError("账户余额不足 / Insufficient balance.");
    if (!this.platform.baseURL)
      throw new AiRouteError("平台服务未配置 / Platform unavailable.");
    if (task) {
      const grant = await this.platform.grant(
        task.taskId,
        selection.model,
        task.durationMs,
      );
      return {
        apiKey: grant.token,
        baseURL: this.platform.baseURL,
        model: selection.model,
        platform: true,
        release: () => this.platform.revoke(grant.id),
      };
    }
    return {
      apiKey: await this.platform.access(),
      baseURL: this.platform.baseURL,
      model: selection.model,
      platform: true,
    };
  }
}
