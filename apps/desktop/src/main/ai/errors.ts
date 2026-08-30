import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { AppError } from "@author-copilot/contracts";

export class AiChatServiceError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message);
    this.name = "AiChatServiceError";
  }
}

export function normalizeClaudeError(error: unknown): AppError {
  if (error instanceof AiChatServiceError) return error.appError;
  if (error instanceof RateLimitError) {
    return {
      code: "RATE_LIMITED",
      message: "Claude is rate limited. Try again later.",
      retryable: true,
    };
  }
  if (error instanceof APIConnectionTimeoutError) {
    return {
      code: "TIMEOUT",
      message: "The Claude request timed out.",
      retryable: true,
    };
  }
  if (error instanceof APIUserAbortError) {
    return {
      code: "CANCELLED",
      message: "The Claude request was cancelled.",
      retryable: true,
    };
  }
  if (error instanceof APIConnectionError) {
    return {
      code: "NETWORK_UNAVAILABLE",
      message: "Claude could not be reached. Check the network connection.",
      retryable: true,
    };
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError
  ) {
    return {
      code: "AI_UNAVAILABLE",
      message: "Anthropic rejected the configured API key.",
      retryable: false,
    };
  }
  if (error instanceof BadRequestError) {
    return {
      code: "AI_UNAVAILABLE",
      message: "Claude rejected the request.",
      retryable: false,
    };
  }
  if (error instanceof APIError) {
    return {
      code: "AI_UNAVAILABLE",
      message: "Claude is temporarily unavailable.",
      retryable: error.status === undefined || error.status >= 500,
    };
  }
  return {
    code: "AI_UNAVAILABLE",
    message: "The Claude request failed.",
    retryable: true,
  };
}
