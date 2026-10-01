export type KnowledgeErrorCode =
  | "cancelled"
  | "conflict"
  | "io_failed"
  | "not_found"
  | "unavailable"
  | "validation_failed";

export class KnowledgeServiceError extends Error {
  constructor(
    public readonly code: KnowledgeErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "KnowledgeServiceError";
  }
}

export class KnowledgeTaskCancelledError extends Error {
  constructor() {
    super("The knowledge indexing task was cancelled.");
    this.name = "KnowledgeTaskCancelledError";
  }
}
