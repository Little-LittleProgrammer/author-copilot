export class ProjectServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidProjectPathError extends ProjectServiceError {}

export class ProjectNotFoundError extends ProjectServiceError {}

export class DuplicateProjectIdError extends ProjectServiceError {
  readonly projectId: string;
  readonly registeredPath: string;
  readonly requestedPath: string;

  constructor(
    projectId: string,
    registeredPath: string,
    requestedPath: string,
  ) {
    super(
      `Project ID ${projectId} is already registered at ${registeredPath}; explicit reassignment is required for ${requestedPath}.`,
    );
    this.projectId = projectId;
    this.registeredPath = registeredPath;
    this.requestedPath = requestedPath;
  }
}

export class ProjectRootAlreadyRegisteredError extends ProjectServiceError {}

export class DocumentConflictError extends ProjectServiceError {
  readonly expectedHash: string;
  readonly actualHash: string;

  constructor(expectedHash: string, actualHash: string) {
    super("The document changed on disk and was not overwritten.");
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

export class SymbolicLinkNotAllowedError extends ProjectServiceError {}
