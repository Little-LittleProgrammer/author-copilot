import type {
  TaskRecoveryError,
  TaskRecoveryListResponse,
  TaskRecoveryRestoreResponse,
  TaskRecoverySummary,
  TaskRestoreResult,
} from "@author-copilot/contracts";

export class TaskRecoveryApiError extends Error {
  public constructor(
    public readonly code: TaskRecoveryError["code"],
    message: string,
  ) {
    super(message);
    this.name = "TaskRecoveryApiError";
  }
}

function unwrapList(
  response: TaskRecoveryListResponse,
): readonly TaskRecoverySummary[] {
  if (!response.ok) {
    throw new TaskRecoveryApiError(response.error.code, response.error.message);
  }
  return response.recoveries;
}

function unwrapRestore(
  response: TaskRecoveryRestoreResponse,
): TaskRestoreResult {
  if (!response.ok) {
    throw new TaskRecoveryApiError(response.error.code, response.error.message);
  }
  return response.result;
}

export function getTaskRecoveryApi():
  | {
      readonly list: (
        projectId: string,
      ) => Promise<readonly TaskRecoverySummary[]>;
      readonly restore: (
        projectId: string,
        taskId: string,
      ) => Promise<TaskRestoreResult>;
    }
  | undefined {
  const raw = window.authorCopilot.taskRecovery;
  if (raw === undefined) return undefined;
  return {
    async list(projectId) {
      return unwrapList(await raw.list({ projectId }));
    },
    async restore(projectId, taskId) {
      return unwrapRestore(await raw.restore({ projectId, taskId }));
    },
  };
}

export type { TaskRecoverySummary, TaskRestoreResult };
