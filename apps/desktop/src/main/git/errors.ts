export type GitServiceErrorCode =
  "git_unavailable" | "invalid_repository" | "git_failed" | "timeout";

export class GitServiceError extends Error {
  public constructor(
    public readonly code: GitServiceErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GitServiceError";
  }
}
