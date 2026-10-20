import { describe, expect, it } from "vitest";
import {
  ApiBaseUrlSchema,
  AiSettingsRequestSchema,
  AiSettingsResponseSchema,
} from "../src/ai-settings.js";
describe("AI configuration boundary", () => {
  it("normalizes API roots and rejects credential-bearing or insecure remote URLs", () => {
    expect(ApiBaseUrlSchema.parse("https://example.com/v1/")).toBe(
      "https://example.com",
    );
    expect(ApiBaseUrlSchema.parse("http://127.0.0.1:1234")).toBe(
      "http://127.0.0.1:1234",
    );
    for (const url of [
      "http://example.com",
      "https://key@example.com",
      "https://example.com?key=secret",
      "https://example.com/#secret",
    ])
      expect(ApiBaseUrlSchema.safeParse(url).success).toBe(false);
  });
  it("does not permit secrets in settings responses or arbitrary command fields", () => {
    expect(
      AiSettingsRequestSchema.safeParse({ action: "models", apiKey: "secret" })
        .success,
    ).toBe(false);
    expect(
      AiSettingsResponseSchema.safeParse({ ok: true, accessToken: "secret" })
        .success,
    ).toBe(false);
  });
});
