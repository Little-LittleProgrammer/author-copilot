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
});
