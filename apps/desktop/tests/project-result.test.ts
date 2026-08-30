import { describe, expect, it } from "vitest";

import {
  DocumentConflictError,
  DuplicateProjectIdError,
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

  it("does not expose absolute registry paths for duplicate IDs", () => {
    const result = projectOperationFailure(
      new DuplicateProjectIdError(
        "10000000-0000-4000-8000-000000000001",
        "/Users/private/original",
        "/Users/private/copy",
      ),
    );
    expect(result.error.code).toBe("duplicate_project_id");
    expect(JSON.stringify(result)).not.toContain("/Users/private");
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
