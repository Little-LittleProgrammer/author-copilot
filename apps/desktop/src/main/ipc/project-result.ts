import type {
  ProjectOperationError,
  ProjectOperationFailure,
} from "@author-copilot/contracts";
import { UnsupportedProjectSchemaVersionError } from "@author-copilot/project-schema";

import {
  DocumentConflictError,
  DuplicateProjectIdError,
  InvalidProjectPathError,
  ProjectNotFoundError,
  ProjectRootAlreadyRegisteredError,
  SymbolicLinkNotAllowedError,
} from "../project/index.js";

function failure(error: ProjectOperationError): ProjectOperationFailure {
  return { ok: false, error };
}

export function cancelledOperation(): ProjectOperationFailure {
  return failure({
    code: "cancelled",
    message: "The operation was cancelled.",
    retryable: true,
  });
}

export function projectOperationFailure(
  error: unknown,
): ProjectOperationFailure {
  if (error instanceof DocumentConflictError) {
    return failure({
      code: "conflict",
      message: "The document changed on disk. Reload it before saving again.",
      retryable: true,
      details: {
        expectedHash: error.expectedHash,
        actualHash: error.actualHash,
      },
    });
  }
  if (error instanceof DuplicateProjectIdError) {
    return failure({
      code: "duplicate_project_id",
      message: "This folder is a copy of an already registered project.",
      retryable: true,
      details: { projectId: error.projectId },
    });
  }
  if (error instanceof ProjectNotFoundError) {
    return failure({
      code: "not_found",
      message: "The project or document was not found.",
      retryable: false,
    });
  }
  if (
    error instanceof InvalidProjectPathError ||
    error instanceof SymbolicLinkNotAllowedError ||
    error instanceof ProjectRootAlreadyRegisteredError
  ) {
    return failure({
      code: "invalid_path",
      message: "The selected path is not allowed for this project.",
      retryable: false,
    });
  }
  if (
    error instanceof UnsupportedProjectSchemaVersionError ||
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === "ZodError")
  ) {
    return failure({
      code: "invalid_metadata",
      message: "The project metadata is invalid or unsupported.",
      retryable: false,
    });
  }

  const nodeCode =
    error instanceof Error && "code" in error ? error.code : undefined;
  if (nodeCode === "ENOENT") {
    return failure({
      code: "not_found",
      message: "The project or document was not found.",
      retryable: false,
    });
  }

  return failure({
    code: "io_error",
    message: "The project operation could not be completed.",
    retryable: true,
  });
}
