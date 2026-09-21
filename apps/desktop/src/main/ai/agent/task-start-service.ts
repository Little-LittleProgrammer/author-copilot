import { randomUUID } from "node:crypto";

import {
  AgentTaskCapabilityGrantRequestSchema,
  type AgentTaskCapability,
  type AgentTaskCapabilityGrantRequest,
} from "@author-copilot/contracts";

import type { TaskSnapshotService } from "../../git/index.js";
import type { ProjectService } from "../../project/index.js";
import type { AgentCapabilityService } from "./capability-service.js";

export interface AgentTaskStartResult {
  readonly capability: AgentTaskCapability;
  readonly snapshot: Awaited<
    ReturnType<TaskSnapshotService["createTaskSnapshot"]>
  >;
}

export interface AgentTaskStartServiceOptions {
  readonly projectService: Pick<ProjectService, "getProjectRoot">;
  readonly taskSnapshotService: Pick<
    TaskSnapshotService,
    "closeTaskSnapshot" | "createTaskSnapshot"
  >;
  readonly capabilityService: Pick<AgentCapabilityService, "grant">;
  readonly createId?: () => string;
  readonly initializeRepository?: (projectId: string) => Promise<void>;
}

export class AgentTaskStartError extends Error {
  readonly code = "snapshot_cleanup_failed";

  constructor(options: { readonly cause: unknown }) {
    super(
      "The Agent task capability was not granted and its empty snapshot could not be removed.",
      options,
    );
    this.name = "AgentTaskStartError";
  }
}

export class AgentTaskStartService {
  private readonly createId: () => string;

  constructor(private readonly options: AgentTaskStartServiceOptions) {
    this.createId = options.createId ?? randomUUID;
  }

  async start(
    input: AgentTaskCapabilityGrantRequest,
  ): Promise<AgentTaskStartResult> {
    const request = AgentTaskCapabilityGrantRequestSchema.parse(input);

    // Re-resolve the registered root immediately before snapshot creation.
    // TaskSnapshotService performs the same check again while holding its
    // project operation lock and persists that canonical root in the snapshot.
    await this.options.projectService.getProjectRoot(request.projectId);

    await this.options.initializeRepository?.(request.projectId);
    const taskId = this.createId();
    const snapshot = await this.options.taskSnapshotService.createTaskSnapshot(
      request.projectId,
      taskId,
    );
    try {
      const capability = this.options.capabilityService.grant(request, taskId);
      return { capability, snapshot };
    } catch (error) {
      try {
        await this.options.taskSnapshotService.closeTaskSnapshot(
          request.projectId,
          taskId,
        );
      } catch (cleanupError) {
        throw new AgentTaskStartError({ cause: cleanupError });
      }
      throw error;
    }
  }
}
