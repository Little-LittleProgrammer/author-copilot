import type { VersionCreateResponse } from "@author-copilot/contracts";

import { GitServiceError } from "../git/index.js";
import { ProjectNotFoundError } from "../project/index.js";

export function versionOperationFailure(
  error: unknown,
): Extract<VersionCreateResponse, { readonly ok: false }> {
  if (error instanceof ProjectNotFoundError) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: "The project is not registered.",
        retryable: false,
      },
    };
  }
  if (error instanceof GitServiceError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "git_failed",
      message: "The version could not be created.",
      retryable: true,
    },
  };
}
