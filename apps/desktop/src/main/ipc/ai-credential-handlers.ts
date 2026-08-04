import {
  AnthropicCredentialDeleteRequestSchema,
  AnthropicCredentialResponseSchema,
  AnthropicCredentialSetRequestSchema,
  AnthropicCredentialStatusRequestSchema,
  IPC_INVOKE_CHANNELS,
  type AppError,
} from "@author-copilot/contracts";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import {
  CredentialStoreError,
  type SecureCredentialStore,
} from "../credentials/index.js";
import { assertTrustedIpcRequest } from "../ipc-policy.js";

export interface AiCredentialIpcOptions {
  readonly credentialStore: SecureCredentialStore;
  readonly trustedRendererUrl: string;
}

function authorize(
  event: IpcMainInvokeEvent,
  channel: string,
  args: readonly unknown[],
  trustedRendererUrl: string,
): void {
  const senderFrame = event.senderFrame;
  assertTrustedIpcRequest({
    channel,
    senderFrameUrl: senderFrame?.url ?? "",
    mainFrameUrl: event.sender.mainFrame.url,
    trustedRendererUrl,
    isMainFrame: senderFrame !== null && senderFrame === event.sender.mainFrame,
    args,
    expectedArgumentCount: 1,
  });
}

function credentialError(error: unknown): AppError {
  if (error instanceof CredentialStoreError) {
    if (error.code === "invalid_credential") {
      return {
        code: "VALIDATION_FAILED",
        message: "The Anthropic API key is invalid.",
        retryable: false,
      };
    }
    if (error.code === "encryption_unavailable") {
      return {
        code: "AI_UNAVAILABLE",
        message: "Secure credential storage is unavailable on this device.",
        retryable: false,
      };
    }
    return {
      code: "IO_FAILED",
      message: "The Anthropic credential store is unavailable.",
      retryable: false,
    };
  }
  if (error instanceof Error && error.name === "ZodError") {
    return {
      code: "VALIDATION_FAILED",
      message: "The Anthropic credential request is invalid.",
      retryable: false,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "The Anthropic credential operation failed.",
    retryable: true,
  };
}

export function registerAiCredentialIpcHandlers(
  options: AiCredentialIpcOptions,
): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.anthropicCredentialGetStatus,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.anthropicCredentialGetStatus,
        args,
        options.trustedRendererUrl,
      );
      try {
        AnthropicCredentialStatusRequestSchema.parse(args[0]);
        const status = await options.credentialStore.getApiKeyStatus(
          "anthropic",
        );
        return AnthropicCredentialResponseSchema.parse({ ok: true, status });
      } catch (error) {
        return AnthropicCredentialResponseSchema.parse({
          ok: false,
          error: credentialError(error),
        });
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.anthropicCredentialSet,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.anthropicCredentialSet,
        args,
        options.trustedRendererUrl,
      );
      try {
        const request = AnthropicCredentialSetRequestSchema.parse(args[0]);
        await options.credentialStore.setApiKey("anthropic", request.apiKey);
        const status = await options.credentialStore.getApiKeyStatus(
          "anthropic",
        );
        return AnthropicCredentialResponseSchema.parse({ ok: true, status });
      } catch (error) {
        return AnthropicCredentialResponseSchema.parse({
          ok: false,
          error: credentialError(error),
        });
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.anthropicCredentialDelete,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      authorize(
        event,
        IPC_INVOKE_CHANNELS.anthropicCredentialDelete,
        args,
        options.trustedRendererUrl,
      );
      try {
        AnthropicCredentialDeleteRequestSchema.parse(args[0]);
        await options.credentialStore.deleteApiKey("anthropic");
        const status = await options.credentialStore.getApiKeyStatus(
          "anthropic",
        );
        return AnthropicCredentialResponseSchema.parse({ ok: true, status });
      } catch (error) {
        return AnthropicCredentialResponseSchema.parse({
          ok: false,
          error: credentialError(error),
        });
      }
    },
  );
}
