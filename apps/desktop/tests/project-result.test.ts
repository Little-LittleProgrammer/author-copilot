import { describe, expect, it } from "vitest";

import {
  DocumentConflictError,
  InvalidProjectPathError,
  ProjectNotFoundError,
} from "../src/main/project/index.js";
import { projectOperationFailure } from "../src/main/ipc/project-result.js";

describe("project IPC error normalization", () => {
  it("preserves optimistic conflict hashes for a safe retry", () => {
    expect(
      projectOperationFailure(
        new DocumentConflictError("a".repeat(64), "b".repeat(64)),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "conflict",
        message: "The document changed on disk. Reload it before saving again.",
        retryable: true,
        details: {
          expectedHash: "a".repeat(64),
          actualHash: "b".repeat(64),
        },
      },
    });
  });

  it("maps path and missing-file failures without raw filesystem details", () => {
    expect(
      projectOperationFailure(
        new InvalidProjectPathError("escaped /Users/private"),
      ).error,
    ).toMatchObject({ code: "invalid_path", retryable: false });
    expect(
      projectOperationFailure(
        new ProjectNotFoundError("missing /Users/private"),
      ).error,
    ).toMatchObject({ code: "not_found", retryable: false });
  });
});
