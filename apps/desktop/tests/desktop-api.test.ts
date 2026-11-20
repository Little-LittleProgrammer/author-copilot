import { describe, expect, it } from "vitest";

import type { AuthorCopilotApi } from "../src/shared/desktop-api.js";

describe("AuthorCopilotApi", () => {
  it("keeps the Renderer Anthropic credential surface write-only", () => {
    const publicMethods: Record<
      keyof AuthorCopilotApi["credentials"]["anthropic"],
      true
    > = {
      getStatus: true,
      set: true,
      delete: true,
    };

    expect(Object.keys(publicMethods).sort()).toEqual([
      "delete",
      "getStatus",
      "set",
    ]);
  });

  it("exposes AI chat only through the typed preload surface", () => {
    const publicMethods: Record<
      keyof AuthorCopilotApi["assistant"]["chat"],
      true
    > = {
      start: true,
      cancel: true,
      onEvent: true,
    };

    expect(Object.keys(publicMethods).sort()).toEqual([
      "cancel",
      "onEvent",
      "start",
    ]);
  });

  it("exposes proposal mutation only through apply and discard", () => {
    const publicMethods: Record<
      keyof AuthorCopilotApi["assistant"]["proposal"],
      true
    > = {
      apply: true,
      discard: true,
    };

    expect(Object.keys(publicMethods).sort()).toEqual(["apply", "discard"]);
  });
});
