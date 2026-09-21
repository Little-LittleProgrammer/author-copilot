import type {
  KnowledgeIndexStatusResult,
  KnowledgeOperationError,
  KnowledgeSearchHit,
  TaskCancelledEvent,
  TaskProgressEvent,
} from "@author-copilot/contracts";

export class KnowledgeApiError extends Error {
  constructor(
    public readonly code: KnowledgeOperationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeApiError";
  }
}

function unwrap<T extends { readonly ok: boolean }>(
  response: T,
): Extract<T, { readonly ok: true }> {
  if (!response.ok) {
    const failure = response as Extract<T, { readonly ok: false }> & {
      readonly error: KnowledgeOperationError;
    };
    throw new KnowledgeApiError(failure.error.code, failure.error.message);
  }
  return response as Extract<T, { readonly ok: true }>;
}

export function getKnowledgeApi(): {
  readonly getStatus: (
    projectId: string,
  ) => Promise<KnowledgeIndexStatusResult>;
  readonly initialize: (projectId: string) => Promise<{
    readonly taskId: string;
    readonly status: KnowledgeIndexStatusResult;
  }>;
  readonly rebuild: (projectId: string) => Promise<{
    readonly taskId: string;
    readonly status: KnowledgeIndexStatusResult;
  }>;
  readonly search: (
    projectId: string,
    query: string,
  ) => Promise<readonly KnowledgeSearchHit[]>;
  readonly cancel: (taskId: string) => Promise<boolean>;
  readonly onProgress: (
    listener: (event: TaskProgressEvent) => void,
  ) => () => void;
  readonly onCancelled: (
    listener: (event: TaskCancelledEvent) => void,
  ) => () => void;
} {
  const raw = window.authorCopilot.knowledge;
  return {
    async getStatus(projectId) {
      return unwrap(await raw.getStatus({ projectId })).status;
    },
    async initialize(projectId) {
      const response = unwrap(await raw.initialize({ projectId }));
      return { taskId: response.taskId, status: response.status };
    },
    async rebuild(projectId) {
      const response = unwrap(await raw.rebuild({ projectId }));
      return { taskId: response.taskId, status: response.status };
    },
    async search(projectId, query) {
      return unwrap(await raw.search({ projectId, query, limit: 5 })).hits;
    },
    async cancel(taskId) {
      return (await raw.cancel({ taskId })).accepted;
    },
    onProgress: raw.onProgress,
    onCancelled: raw.onCancelled,
  };
}

export type { KnowledgeIndexStatusResult, KnowledgeSearchHit };
