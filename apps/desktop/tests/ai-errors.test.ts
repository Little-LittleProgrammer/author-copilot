import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { normalizeClaudeError } from "../src/main/ai/errors.js";

describe("Claude error normalization", () => {
  it("normalizes rate limits, network failures, timeouts, and credentials", () => {
    const headers = new Headers();
    expect(
      normalizeClaudeError(
        new RateLimitError(429, {}, "rate limited", headers),
      ),
    ).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(
      normalizeClaudeError(
        new APIConnectionError({ message: "socket secret details" }),
      ),
    ).toEqual({
      code: "NETWORK_UNAVAILABLE",
      message: "Claude could not be reached. Check the network connection.",
      retryable: true,
    });
    expect(normalizeClaudeError(new APIConnectionTimeoutError())).toMatchObject(
      { code: "TIMEOUT", retryable: true },
    );
    expect(
      normalizeClaudeError(
        new AuthenticationError(401, {}, "rejected secret", headers),
      ),
    ).toEqual({
      code: "AI_UNAVAILABLE",
      message: "Anthropic rejected the configured API key.",
      retryable: false,
    });
  });
});
