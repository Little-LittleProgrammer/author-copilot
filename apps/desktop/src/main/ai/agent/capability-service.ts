import { extname } from "node:path";

import {
  AgentTaskCapabilityGrantRequestSchema,
  AgentTaskCapabilitySchema,
  AgentToolNameSchema,
  RelativeProjectPathSchema,
  type AgentFileType,
  type AgentTaskCapability,
  type AgentTaskCapabilityGrantRequest,
  type AgentToolName,
} from "@author-copilot/contracts";

export type AgentCapabilityErrorCode =
  | "file_type_not_authorized"
  | "invalid_path"
  | "project_mismatch"
  | "task_active"
  | "task_expired"
  | "task_not_found"
  | "tool_not_authorized";

export class AgentCapabilityError extends Error {
  constructor(
    readonly code: AgentCapabilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentCapabilityError";
  }
}

export interface AgentCapabilityServiceOptions {
  readonly now?: () => number;
}

export interface AgentToolAuthorizationRequest {
  readonly taskId: string;
  readonly projectId: string;
  readonly tool: AgentToolName;
  readonly relativePath?: string;
}

export interface AgentFileAuthorizationRequest {
  readonly taskId: string;
  readonly projectId: string;
  readonly access: "read" | "write";
  readonly relativePath: string;
}

export interface AgentTaskAuthorizationRequest {
  readonly taskId: string;
  readonly projectId: string;
}

interface ActiveCapability {
  readonly capability: AgentTaskCapability;
  readonly expiresAt: number;
}

const FILE_TYPE_BY_EXTENSION: Readonly<Record<string, AgentFileType>> = {
  ".md": "markdown",
};

const FILE_TOOL_ACCESS: Readonly<
  Partial<Record<AgentToolName, "read" | "write">>
> = {
  mcp__author_copilot__read_text: "read",
  mcp__author_copilot__write_text: "write",
  mcp__author_copilot__edit_text: "write",
};

export class AgentCapabilityService {
  private readonly activeByTask = new Map<string, ActiveCapability>();
  private readonly activeTaskByProject = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly options: AgentCapabilityServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  grant(
    input: AgentTaskCapabilityGrantRequest,
    taskId: string,
  ): AgentTaskCapability {
    const request = AgentTaskCapabilityGrantRequestSchema.parse(input);
    this.removeExpired();
    if (this.activeTaskByProject.has(request.projectId)) {
      throw new AgentCapabilityError(
        "task_active",
        "The project already has an active Agent task capability.",
      );
    }

    const createdAt = this.now();
    const capability = AgentTaskCapabilitySchema.parse({
      ...request,
      taskId,
      createdAt: new Date(createdAt).toISOString(),
    });
    this.activeByTask.set(capability.taskId, {
      capability,
      expiresAt: createdAt + capability.timeoutMs,
    });
    this.activeTaskByProject.set(capability.projectId, capability.taskId);
    return capability;
  }

  authorize(input: AgentToolAuthorizationRequest): AgentTaskCapability {
    const capability = this.authorizeTask(input);

    const parsedTool = AgentToolNameSchema.safeParse(input.tool);
    if (
      !parsedTool.success ||
      !capability.allowedTools.includes(parsedTool.data)
    ) {
      throw new AgentCapabilityError(
        "tool_not_authorized",
        "The Agent tool is not authorized for this task.",
      );
    }

    const access = FILE_TOOL_ACCESS[parsedTool.data];
    if (access !== undefined) {
      this.assertFileAccess(capability, access, input.relativePath);
    } else if (input.relativePath !== undefined) {
      throw new AgentCapabilityError(
        "invalid_path",
        "This Agent tool does not accept a direct file path.",
      );
    }
    return capability;
  }

  authorizeFilePath(input: AgentFileAuthorizationRequest): AgentTaskCapability {
    const capability = this.authorizeTask(input);
    this.assertFileAccess(capability, input.access, input.relativePath);
    return capability;
  }

  authorizeTask(input: AgentTaskAuthorizationRequest): AgentTaskCapability {
    const active = this.requireActive(input.taskId);
    if (active.capability.projectId !== input.projectId) {
      throw new AgentCapabilityError(
        "project_mismatch",
        "The Agent task capability belongs to a different project.",
      );
    }
    return active.capability;
  }

  revoke(taskId: string): boolean {
    const active = this.activeByTask.get(taskId);
    if (active === undefined) return false;
    this.activeByTask.delete(taskId);
    if (this.activeTaskByProject.get(active.capability.projectId) === taskId) {
      this.activeTaskByProject.delete(active.capability.projectId);
    }
    return true;
  }

  revokeAll(): void {
    this.activeByTask.clear();
    this.activeTaskByProject.clear();
  }

  private requireActive(taskId: string): ActiveCapability {
    const active = this.activeByTask.get(taskId);
    if (active === undefined) {
      throw new AgentCapabilityError(
        "task_not_found",
        "The Agent task capability is not active.",
      );
    }
    if (this.now() >= active.expiresAt) {
      this.revoke(taskId);
      throw new AgentCapabilityError(
        "task_expired",
        "The Agent task capability has expired.",
      );
    }
    return active;
  }

  private assertFileAccess(
    capability: AgentTaskCapability,
    access: "read" | "write",
    relativePath: string | undefined,
  ): void {
    const parsedPath = RelativeProjectPathSchema.safeParse(relativePath);
    if (!parsedPath.success) {
      throw new AgentCapabilityError(
        "invalid_path",
        "The Agent file path is invalid.",
      );
    }
    if (
      parsedPath.data
        .replaceAll("\\", "/")
        .split("/")
        .some((segment) => segment.startsWith("."))
    ) {
      throw new AgentCapabilityError(
        "invalid_path",
        "Hidden Agent file paths are not authorized.",
      );
    }
    const fileType =
      FILE_TYPE_BY_EXTENSION[extname(parsedPath.data).toLowerCase()];
    const allowedFileTypes =
      access === "read"
        ? capability.readableFileTypes
        : capability.writableFileTypes;
    if (fileType === undefined || !allowedFileTypes.includes(fileType)) {
      throw new AgentCapabilityError(
        "file_type_not_authorized",
        "The Agent file type is not authorized for this task.",
      );
    }
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [taskId, active] of this.activeByTask) {
      if (now >= active.expiresAt) this.revoke(taskId);
    }
  }
}
