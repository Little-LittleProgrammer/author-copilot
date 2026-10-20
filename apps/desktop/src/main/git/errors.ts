export type GitServiceErrorCode =
  | "branch_not_found"
  | "dirty_repository"
  | "git_unavailable"
  | "invalid_repository"
  | "git_failed"
  | "task_active"
  | "timeout";

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
