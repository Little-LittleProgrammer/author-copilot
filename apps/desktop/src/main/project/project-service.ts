import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";

import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  migrateProjectMetadata,
  PROJECT_METADATA_FILE_NAME,
} from "@author-copilot/project-schema";

import { copyDirectoryWithoutSymlinks } from "./copy-project.js";
import {
  DocumentConflictError,
  DuplicateProjectIdError,
  InvalidProjectPathError,
  ProjectNotFoundError,
  ProjectServiceError,
  SymbolicLinkNotAllowedError,
} from "./errors.js";
import { atomicWriteFile } from "./file-utils.js";
import { authorizeExistingDocument } from "./path-policy.js";
import { createRegisteredProject, newProjectId } from "./registry-store.js";
import type { RegistryStore } from "./registry-store.js";
import { buildProjectStructure } from "./structure.js";
import type {
  ConfirmImportOptions,
  ImportPreview,
  ProjectEventPublisher,
  ProjectMetadata,
  ProjectStructure,
  ProjectTemplate,
  ReadDocumentResult,
  RegisteredProject,
  SaveDocumentResult,
} from "./types.js";

export interface ProjectServiceOptions {
  readonly registry: RegistryStore;
  readonly publishEvent?: ProjectEventPublisher;
}

function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function validateTitle(title: string): string {
  const normalized = title.trim();
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.length > 200 ||
    /[<>:"/\\|?*\0]/u.test(normalized) ||
    /[. ]$/u.test(normalized)
  ) {
    throw new ProjectServiceError(
      "The project title cannot be used as a folder name.",
    );
  }
  return normalized;
}

async function canonicalDirectory(path: string): Promise<string> {
  const canonicalPath = await realpath(path);
  if (!(await stat(canonicalPath)).isDirectory()) {
    throw new ProjectServiceError("The project path is not a directory.");
  }
  return canonicalPath;
}

async function assertPathDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new ProjectServiceError("The destination folder already exists.");
}

function createMetadata(
  title: string,
  template: ProjectTemplate,
): ProjectMetadata {
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    projectId: newProjectId(),
    title,
    template,
    createdAt: new Date().toISOString(),
  };
}

async function writeMetadata(
  rootPath: string,
  metadata: ProjectMetadata,
): Promise<void> {
  await atomicWriteFile(
    join(rootPath, PROJECT_METADATA_FILE_NAME),
    `${JSON.stringify(metadata, undefined, 2)}\n`,
    0o600,
  );
}

async function readMetadata(rootPath: string): Promise<{
  readonly metadata?: ProjectMetadata;
  readonly action: "none" | "create" | "migrate";
}> {
  const metadataPath = join(rootPath, PROJECT_METADATA_FILE_NAME);
  try {
    const metadataStats = await lstat(metadataPath);
    if (metadataStats.isSymbolicLink()) {
      throw new SymbolicLinkNotAllowedError(
        "Project metadata cannot be a symbolic link.",
      );
    }
    if (!metadataStats.isFile()) {
      throw new ProjectServiceError("Project metadata is not a regular file.");
    }

    const rawMetadata: unknown = JSON.parse(
      await readFile(metadataPath, "utf8"),
    );
    const metadata = migrateProjectMetadata(rawMetadata);
    const rawVersion =
      typeof rawMetadata === "object" &&
      rawMetadata !== null &&
      "schemaVersion" in rawMetadata
        ? rawMetadata.schemaVersion
        : undefined;
    return {
      metadata,
      action:
        rawVersion === CURRENT_PROJECT_SCHEMA_VERSION ? "none" : "migrate",
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { action: "create" };
    }
    throw error;
  }
}

export class ProjectService {
  private readonly registry: RegistryStore;
  private readonly publishEvent: ProjectEventPublisher | undefined;
  private readonly documentQueues = new Map<string, Promise<void>>();

  constructor(options: ProjectServiceOptions) {
    this.registry = options.registry;
    this.publishEvent = options.publishEvent;
  }

  async createProject(
    parentPath: string,
    title: string,
    template: ProjectTemplate,
  ): Promise<RegisteredProject> {
    const canonicalParent = await canonicalDirectory(parentPath);
    const safeTitle = validateTitle(title);
    const rootPath = join(canonicalParent, safeTitle);
    const stagingPath = join(
      canonicalParent,
      `.author-copilot-${randomUUID()}.staging`,
    );
    const metadata = createMetadata(safeTitle, template);
    let published = false;

    await assertPathDoesNotExist(rootPath);
    await mkdir(stagingPath, { mode: 0o700 });
    try {
      if (template === "novel") {
        const chapterPath = join(stagingPath, "第一卷", "第一章");
        await mkdir(chapterPath, { recursive: true });
        await writeFile(join(chapterPath, "01-正文.md"), "", {
          encoding: "utf8",
          flag: "wx",
        });
      } else {
        const actPath = join(stagingPath, "第一幕");
        await mkdir(actPath);
        await writeFile(join(actPath, "01-第一场.md"), "", {
          encoding: "utf8",
          flag: "wx",
        });
      }
      await writeMetadata(stagingPath, metadata);
      await assertPathDoesNotExist(rootPath);
      await rename(stagingPath, rootPath);
      published = true;

      const project = createRegisteredProject(
        await realpath(rootPath),
        metadata,
      );
      await this.registry.register(project);
      return project;
    } catch (error) {
      await rm(published ? rootPath : stagingPath, {
        recursive: true,
        force: true,
      }).catch(() => undefined);
      throw error;
    }
  }

  async previewImport(
    rootPath: string,
    template: ProjectTemplate,
  ): Promise<ImportPreview> {
    const canonicalRoot = await canonicalDirectory(rootPath);
    const metadataResult = await readMetadata(canonicalRoot);
    const metadata =
      metadataResult.metadata ??
      createMetadata(basename(canonicalRoot), template);
    if (metadata.template !== template) {
      throw new ProjectServiceError(
        `The selected template ${template} does not match project metadata ${metadata.template}.`,
      );
    }

    const existingRegistration = await this.registry.get(metadata.projectId);
    const structure = await buildProjectStructure(
      metadata.projectId,
      canonicalRoot,
      template,
    );

    return {
      rootPath: canonicalRoot,
      template,
      metadata,
      metadataAction: metadataResult.action,
      ...(existingRegistration !== undefined &&
      existingRegistration.rootPath !== canonicalRoot
        ? { duplicateRegistration: existingRegistration }
        : {}),
      structure: {
        template: structure.template,
        nodes: structure.nodes,
        unclassified: structure.unclassified,
      },
    };
  }

  async confirmImport(
    options: ConfirmImportOptions,
  ): Promise<RegisteredProject> {
    const preview = await this.previewImport(
      options.rootPath,
      options.template,
    );

    if (options.mode === "copy") {
      return this.confirmCopyImport(options, preview);
    }

    const existingRootRegistration = await this.registry.findByRoot(
      preview.rootPath,
    );
    if (
      existingRootRegistration !== undefined &&
      existingRootRegistration.projectId === preview.metadata.projectId
    ) {
      return existingRootRegistration;
    }

    if (
      preview.duplicateRegistration !== undefined &&
      options.reassignProjectId !== true
    ) {
      throw new DuplicateProjectIdError(
        preview.metadata.projectId,
        preview.duplicateRegistration.rootPath,
        preview.rootPath,
      );
    }

    const metadata =
      preview.duplicateRegistration !== undefined
        ? { ...preview.metadata, projectId: newProjectId() }
        : preview.metadata;
    if (
      preview.metadataAction !== "none" ||
      metadata.projectId !== preview.metadata.projectId
    ) {
      await writeMetadata(preview.rootPath, metadata);
    }

    const project = createRegisteredProject(preview.rootPath, metadata);
    await this.registry.register(project);
    return project;
  }

  async list(): Promise<readonly RegisteredProject[]> {
    return this.registry.list();
  }

  async getStructure(projectId: string): Promise<ProjectStructure> {
    const project = await this.requireProject(projectId);
    return buildProjectStructure(
      project.projectId,
      project.rootPath,
      project.metadata.template,
    );
  }

  async readDocument(
    projectId: string,
    relativePath: string,
  ): Promise<ReadDocumentResult> {
    const project = await this.requireProject(projectId);
    const documentPath = await authorizeExistingDocument(
      project.rootPath,
      relativePath,
    );
    const content = await readFile(documentPath, "utf8");
    const documentStats = await stat(documentPath);
    if (!documentStats.isFile()) {
      throw new InvalidProjectPathError("The document is not a regular file.");
    }
    return {
      content,
      hash: hashContent(content),
      mtimeMs: documentStats.mtimeMs,
      mode: documentStats.mode & 0o7777,
    };
  }

  async saveDocument(
    projectId: string,
    relativePath: string,
    content: string,
    expectedHash: string,
  ): Promise<SaveDocumentResult> {
    const lockKey = `${projectId}\0${relativePath}`;
    return this.withDocumentLock(lockKey, async () => {
      const project = await this.requireProject(projectId);
      const documentPath = await authorizeExistingDocument(
        project.rootPath,
        relativePath,
      );
      const beforeSave = await this.readDocument(projectId, relativePath);
      if (beforeSave.hash !== expectedHash) {
        throw new DocumentConflictError(expectedHash, beforeSave.hash);
      }

      await atomicWriteFile(
        documentPath,
        content,
        beforeSave.mode,
        async () => {
          const currentHash = hashContent(await readFile(documentPath));
          if (currentHash !== expectedHash) {
            throw new DocumentConflictError(expectedHash, currentHash);
          }
        },
      );

      const savedStats = await stat(documentPath);
      const result = {
        hash: hashContent(content),
        mtimeMs: savedStats.mtimeMs,
      };
      this.publishDocumentSaved({
        type: "document-saved",
        projectId,
        relativePath: relativePath.replaceAll("\\", "/"),
        ...result,
      });
      return result;
    });
  }

  private async confirmCopyImport(
    options: Extract<ConfirmImportOptions, { mode: "copy" }>,
    preview: ImportPreview,
  ): Promise<RegisteredProject> {
    const canonicalParent = await canonicalDirectory(options.destinationParent);
    const title = validateTitle(options.title ?? preview.metadata.title);
    const destinationPath = join(canonicalParent, title);
    const stagingPath = join(
      canonicalParent,
      `.author-copilot-${randomUUID()}.importing`,
    );
    const destinationFromSource = relative(preview.rootPath, destinationPath);
    if (
      destinationFromSource === "" ||
      (!destinationFromSource.startsWith(`..${sep}`) &&
        destinationFromSource !== ".." &&
        !isAbsolute(destinationFromSource))
    ) {
      throw new ProjectServiceError(
        "A copied project destination cannot be inside its source.",
      );
    }

    let published = false;
    await assertPathDoesNotExist(destinationPath);
    try {
      await copyDirectoryWithoutSymlinks(preview.rootPath, stagingPath);
      const metadata = createMetadata(title, options.template);
      await writeMetadata(stagingPath, metadata);
      await assertPathDoesNotExist(destinationPath);
      await rename(stagingPath, destinationPath);
      published = true;
      const project = createRegisteredProject(
        await realpath(destinationPath),
        metadata,
      );
      await this.registry.register(project);
      return project;
    } catch (error) {
      await rm(published ? destinationPath : stagingPath, {
        recursive: true,
        force: true,
      }).catch(() => undefined);
      throw error;
    }
  }

  private async requireProject(projectId: string): Promise<RegisteredProject> {
    const project = await this.registry.get(projectId);
    if (project === undefined) {
      throw new ProjectNotFoundError(`Project ${projectId} is not registered.`);
    }
    return project;
  }

  private publishDocumentSaved(
    event: Parameters<ProjectEventPublisher>[0],
  ): void {
    if (this.publishEvent === undefined) return;
    queueMicrotask(() => {
      Promise.resolve(this.publishEvent?.(event)).catch(() => undefined);
    });
  }

  private async withDocumentLock<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const predecessor = this.documentQueues.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = predecessor.then(() => current);
    this.documentQueues.set(key, queued);
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      if (this.documentQueues.get(key) === queued) {
        this.documentQueues.delete(key);
      }
    }
  }
}
