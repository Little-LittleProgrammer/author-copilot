import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseProjectMetadata } from "@author-copilot/project-schema";

import {
  ProjectRootAlreadyRegisteredError,
  ProjectServiceError,
} from "./errors.js";
import { atomicWriteFile } from "./file-utils.js";
import type { RegisteredProject } from "./types.js";

interface RegistryFile {
  readonly schemaVersion: 1;
  readonly projects: Readonly<Record<string, RegisteredProject>>;
}

const EMPTY_REGISTRY: RegistryFile = {
  schemaVersion: 1,
  projects: {},
};

function parseRegistry(input: unknown): RegistryFile {
  if (
    typeof input !== "object" ||
    input === null ||
    !("schemaVersion" in input) ||
    input.schemaVersion !== 1 ||
    !("projects" in input) ||
    typeof input.projects !== "object" ||
    input.projects === null ||
    Array.isArray(input.projects)
  ) {
    throw new ProjectServiceError("The project registry is malformed.");
  }

  const projects: Record<string, RegisteredProject> = {};
  for (const [projectId, value] of Object.entries(input.projects)) {
    if (
      typeof value !== "object" ||
      value === null ||
      !("projectId" in value) ||
      value.projectId !== projectId ||
      !("rootPath" in value) ||
      typeof value.rootPath !== "string" ||
      !("registeredAt" in value) ||
      typeof value.registeredAt !== "string" ||
      !("metadata" in value)
    ) {
      throw new ProjectServiceError("The project registry is malformed.");
    }

    projects[projectId] = {
      projectId,
      rootPath: value.rootPath,
      registeredAt: value.registeredAt,
      metadata: parseProjectMetadata(value.metadata),
    };
  }

  return { schemaVersion: 1, projects };
}

export class RegistryStore {
  readonly registryPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.registryPath = join(userDataPath, "projects.json");
  }

  async list(): Promise<readonly RegisteredProject[]> {
    const registry = await this.readRegistry();
    return Object.values(registry.projects).sort((left, right) =>
      left.registeredAt.localeCompare(right.registeredAt),
    );
  }

  async get(projectId: string): Promise<RegisteredProject | undefined> {
    const registry = await this.readRegistry();
    return registry.projects[projectId];
  }

  async findByRoot(rootPath: string): Promise<RegisteredProject | undefined> {
    const canonicalRoot = await realpath(rootPath);
    return (await this.list()).find(
      (project) => project.rootPath === canonicalRoot,
    );
  }

  async register(project: RegisteredProject): Promise<void> {
    await this.mutate(async (registry) => {
      const metadata = parseProjectMetadata(project.metadata);
      if (metadata.projectId !== project.projectId) {
        throw new ProjectServiceError(
          "The registry project ID does not match project metadata.",
        );
      }
      const canonicalRoot = await realpath(project.rootPath);
      const rootStats = await stat(canonicalRoot);
      if (!rootStats.isDirectory()) {
        throw new ProjectServiceError(
          "The registered project root is not a directory.",
        );
      }

      const rootOwner = Object.values(registry.projects).find(
        (candidate) =>
          candidate.rootPath === canonicalRoot &&
          candidate.projectId !== project.projectId,
      );
      if (rootOwner !== undefined) {
        throw new ProjectRootAlreadyRegisteredError(
          `The project root is already registered as ${rootOwner.projectId}.`,
        );
      }

      registry.projects[project.projectId] = {
        ...project,
        metadata,
        rootPath: canonicalRoot,
      };
    });
  }

  private async readRegistry(): Promise<RegistryFile> {
    try {
      return parseRegistry(
        JSON.parse(await readFile(this.registryPath, "utf8")),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return EMPTY_REGISTRY;
      }
      throw error;
    }
  }

  private async writeRegistry(registry: RegistryFile): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true });
    await atomicWriteFile(
      this.registryPath,
      `${JSON.stringify(registry, undefined, 2)}\n`,
      0o600,
    );
  }

  private async mutate(
    operation: (registry: {
      schemaVersion: 1;
      projects: Record<string, RegisteredProject>;
    }) => void | Promise<void>,
  ): Promise<void> {
    const run = this.mutationQueue.then(async () => {
      const current = await this.readRegistry();
      const mutable = {
        schemaVersion: 1 as const,
        projects: { ...current.projects },
      };
      await operation(mutable);
      await this.writeRegistry(mutable);
    });
    this.mutationQueue = run.catch(() => undefined);
    await run;
  }
}

export function createRegisteredProject(
  rootPath: string,
  metadata: RegisteredProject["metadata"],
): RegisteredProject {
  return {
    projectId: metadata.projectId,
    rootPath,
    metadata,
    registeredAt: new Date().toISOString(),
  };
}

export function newProjectId(): string {
  return randomUUID();
}
