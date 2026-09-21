import type { RuntimeInfo, TaskProgressEvent } from "@author-copilot/contracts";
import type { ProjectMetadata } from "@author-copilot/project-schema";

export const TEST_PROJECT_ID = "10000000-0000-4000-8000-000000000001";
export const TEST_TASK_ID = "20000000-0000-4000-8000-000000000001";
export const TEST_TIMESTAMP = "2026-07-13T00:00:00.000Z";

export function createProjectMetadataFixture(
  overrides: Partial<ProjectMetadata> = {},
): ProjectMetadata {
  return {
    schemaVersion: 1,
    projectId: TEST_PROJECT_ID,
    title: "Test Project",
    template: "novel",
    createdAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

export function createRuntimeInfoFixture(
  overrides: Partial<RuntimeInfo> = {},
): RuntimeInfo {
  return {
    appVersion: "0.0.0-test",
    electronVersion: "41.0.3",
    nodeVersion: "24.16.0",
    platform: "darwin",
    arch: "arm64",
    packaged: false,
    ...overrides,
  };
}

export function createTaskProgressFixture(
  overrides: Partial<TaskProgressEvent> = {},
): TaskProgressEvent {
  return {
    type: "task.progress",
    taskId: TEST_TASK_ID,
    taskKind: "index_initialize",
    phase: "scan",
    completed: 0,
    total: null,
    timestamp: TEST_TIMESTAMP,
    ...overrides,
  };
}
