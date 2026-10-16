import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  migrateProjectMetadata,
  parseProjectMetadata,
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
import {
  authorizeExistingDocument,
  authorizeExistingEntry,
  validateProjectEntryName,
} from "./path-policy.js";
import { createRegisteredProject, newProjectId } from "./registry-store.js";
import type { RegistryStore } from "./registry-store.js";
import { buildProjectStructure } from "./structure.js";
import type {
  ConfirmImportOptions,
  AppliedBatchDocument,
  DocumentBatchWrite,
  ImportPreview,
  InitialProjectDocument,
  ProjectEventPublisher,
  ProjectDocument,
  ProjectMetadata,
  ProjectStructure,
  ProjectStructureNode,
  ProjectTemplate,
  ReadDocumentResult,
  RegisteredProject,
  SaveDocumentResult,
} from "./types.js";
import { ProjectOperationQueue } from "../git/project-operation-queue.js";
import type { ProjectCreateEntryRequest } from "@author-copilot/contracts";

type WritingEntry = ProjectStructureNode | ProjectDocument;

function flattenEntries(nodes: readonly WritingEntry[]): WritingEntry[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.kind === "document" ? [] : flattenEntries(node.children)),
  ]);
}

export interface ProjectServiceOptions {
  readonly registry: RegistryStore;
  readonly publishEvent?: ProjectEventPublisher;
  readonly writeDocument?: typeof atomicWriteFile;
  readonly operationQueue?: ProjectOperationQueue;
  readonly assertCanMutate?: (projectId: string) => void;
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

function containsStructurePath(
  nodes: readonly (ProjectStructureNode | ProjectDocument)[],
  relativePath: string,
): boolean {
  return nodes.some(
    (node) =>
      node.relativePath === relativePath ||
      (node.kind !== "document" &&
        containsStructurePath(node.children, relativePath)),
  );
}

async function removeWritingEntry(entryPath: string): Promise<void> {
  const entryStats = await lstat(entryPath);
  if (entryStats.isSymbolicLink()) {
    throw new SymbolicLinkNotAllowedError(
      "Symbolic links are not allowed in deleted project entries.",
    );
  }
  if (entryStats.isFile()) {
    if (!entryPath.toLowerCase().endsWith(".md")) {
      throw new InvalidProjectPathError(
        "Folders containing non-writing files cannot be deleted.",
      );
    }
    await unlink(entryPath);
    return;
  }
  if (!entryStats.isDirectory()) {
    throw new InvalidProjectPathError(
      "Only writing documents and folders may be deleted.",
    );
  }

  const entries = await readdir(entryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name.toLowerCase() === ".git" ||
      entry.name.toLowerCase() === PROJECT_METADATA_FILE_NAME.toLowerCase()
    ) {
      throw new InvalidProjectPathError(
        "Folders containing project metadata cannot be deleted.",
      );
    }
    await removeWritingEntry(join(entryPath, entry.name));
  }
  await rmdir(entryPath);
}

async function validateWritingEntryTree(entryPath: string): Promise<void> {
  const entryStats = await lstat(entryPath);
  if (entryStats.isSymbolicLink()) {
    throw new SymbolicLinkNotAllowedError(
      "Symbolic links are not allowed in deleted project entries.",
    );
  }
  if (entryStats.isFile()) {
    if (!entryPath.toLowerCase().endsWith(".md")) {
      throw new InvalidProjectPathError(
        "Folders containing non-writing files cannot be deleted.",
      );
    }
    return;
  }
  if (!entryStats.isDirectory()) {
    throw new InvalidProjectPathError(
      "Only writing documents and folders may be deleted.",
    );
  }

  const entries = await readdir(entryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name.toLowerCase() === ".git" ||
      entry.name.toLowerCase() === PROJECT_METADATA_FILE_NAME.toLowerCase()
    ) {
      throw new InvalidProjectPathError(
        "Folders containing project metadata cannot be deleted.",
      );
    }
    await validateWritingEntryTree(join(entryPath, entry.name));
  }
}

async function writeMetadata(
  rootPath: string,
  metadata: ProjectMetadata,
): Promise<void> {
  await atomicWriteFile(
    join(rootPath, PROJECT_METADATA_FILE_NAME),
    `${JSON.stringify(parseProjectMetadata(metadata), undefined, 2)}\n`,
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
  private readonly writeDocument: typeof atomicWriteFile;
  private readonly operationQueue: ProjectOperationQueue;
  private readonly documentQueues = new Map<string, Promise<void>>();

  constructor(private readonly options: ProjectServiceOptions) {
    this.registry = options.registry;
    this.publishEvent = options.publishEvent;
    this.writeDocument = options.writeDocument ?? atomicWriteFile;
    this.operationQueue = options.operationQueue ?? new ProjectOperationQueue();
  }

  async createProject(
    parentPath: string,
    title: string,
    template: ProjectTemplate,
    initialDocuments?: readonly InitialProjectDocument[],
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
      const documents = initialDocuments ?? [
        {
          relativePath:
            template === "novel"
              ? "第一卷/第一章/01-正文.md"
              : "第一幕/01-第一场.md",
          content: "",
        },
      ];
      if (documents.length === 0 || documents.length > 2000)
        throw new ProjectServiceError("Invalid initial document count.");
      const paths = new Set<string>();
      for (const document of documents) {
        const segments = document.relativePath.split("/");
        if (
          segments.length !== (template === "novel" ? 3 : 2) ||
          !segments.at(-1)?.endsWith(".md")
        )
          throw new InvalidProjectPathError("Invalid initial document path.");
        for (const segment of segments) validateProjectEntryName(segment);
        const key = document.relativePath.toLowerCase();
        if (paths.has(key))
          throw new InvalidProjectPathError("Duplicate initial document path.");
        paths.add(key);
        const target = join(stagingPath, ...segments);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, document.content, {
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

  async getProjectRoot(projectId: string): Promise<string> {
    const project = await this.requireProject(projectId);
    return project.rootPath;
  }

  async getStructure(projectId: string): Promise<ProjectStructure> {
    const project = await this.requireProject(projectId);
    return buildProjectStructure(
      project.projectId,
      project.rootPath,
      project.metadata.template,
    );
  }

  async updateProjectTitle(
    projectId: string,
    title: string,
  ): Promise<RegisteredProject> {
    return this.withProjectLock(projectId, async () => {
      const project = await this.requireProject(projectId);
      const normalizedTitle = title.trim();
      if (normalizedTitle.length === 0 || normalizedTitle.length > 200) {
        throw new ProjectServiceError("The project title is invalid.");
      }
      const metadata = {
        ...(await this.currentMetadata(project)),
        title: normalizedTitle,
      };
      await writeMetadata(project.rootPath, metadata);
      await this.registry.updateMetadata(projectId, metadata);
      return { ...project, metadata };
    });
  }

  async createEntry(
    request: ProjectCreateEntryRequest,
  ): Promise<{ relativePath: string; documentPath: string }> {
    return this.withProjectLock(request.projectId, async () => {
      const project = await this.requireProject(request.projectId);
      const metadata = await this.currentMetadata(project);
      const structure = await this.getStructure(request.projectId);
      const entries = flattenEntries(structure.nodes);
      const parentPath = request.parentPath?.replaceAll("\\", "/");
      const parent = entries.find((entry) => entry.relativePath === parentPath);
      const expectedParent =
        project.metadata.template === "novel"
          ? {
              volume: undefined,
              chapter: "volume",
              scene: "chapter",
              act: "invalid",
            }
          : {
              act: undefined,
              scene: "act",
              volume: "invalid",
              chapter: "invalid",
            };
      const parentKind = expectedParent[request.role];
      if (
        parentKind === "invalid" ||
        (parentKind === undefined
          ? parentPath !== undefined
          : parent?.kind !== parentKind)
      ) {
        throw new InvalidProjectPathError(
          "This entry cannot be created at the selected level.",
        );
      }
      const parentAbsolute =
        parentPath === undefined
          ? project.rootPath
          : (await authorizeExistingEntry(project.rootPath, parentPath))
              .absolutePath;
      const name = validateProjectEntryName(
        request.role === "scene"
          ? request.name.replace(/\.md$/iu, "")
          : request.name,
      );
      if (name.length > 240)
        throw new InvalidProjectPathError("The entry name is too long.");
      const siblings =
        parent && parent.kind !== "document"
          ? parent.children
          : structure.nodes;
      const normalizedName = name
        .replace(/^\d{4}-/u, "")
        .normalize("NFKC")
        .toLowerCase();
      const diskName = request.role === "scene" ? `${name}.md` : name;
      if (
        Buffer.byteLength(diskName, "utf8") > 255 ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(diskName)
      ) {
        throw new InvalidProjectPathError(
          "The name cannot be used on all supported platforms.",
        );
      }
      const diskEntries = await readdir(parentAbsolute);
      if (
        siblings.some(
          (entry) =>
            entry.name
              .replace(/^\d{4}-/u, "")
              .normalize("NFKC")
              .toLowerCase() === normalizedName,
        ) ||
        diskEntries.some(
          (entry) =>
            entry.normalize("NFKC").toLowerCase() ===
            diskName.normalize("NFKC").toLowerCase(),
        )
      ) {
        throw Object.assign(
          new Error("An entry with this name already exists."),
          { code: "EEXIST" },
        );
      }
      if (
        entries.filter((entry) => entry.kind === "document").length +
          structure.unclassified.length >=
        2000
      ) {
        throw new InvalidProjectPathError(
          "A work may contain at most 2,000 writing documents.",
        );
      }
      const relativePath =
        parentPath === undefined ? diskName : `${parentPath}/${diskName}`;
      const documentPath =
        request.role === "volume"
          ? `${relativePath}/第一章/01-正文.md`
          : request.role === "chapter"
            ? `${relativePath}/01-正文.md`
            : request.role === "act"
              ? `${relativePath}/01-第一场.md`
              : relativePath;
      const target = join(parentAbsolute, diskName);
      // Exclusive creation ensures a failed request never removes an existing entry.
      if (request.role === "scene")
        await writeFile(target, "", {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      else await mkdir(target, { mode: 0o700 });
      try {
        if (request.role !== "scene") {
          await mkdir(dirname(join(project.rootPath, documentPath)), {
            recursive: true,
            mode: 0o700,
          });
          await writeFile(join(project.rootPath, documentPath), "", {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
        }
        const addedPaths =
          request.role === "volume"
            ? [relativePath, `${relativePath}/第一章`, documentPath]
            : relativePath === documentPath
              ? [relativePath]
              : [relativePath, documentPath];
        await writeMetadata(project.rootPath, {
          ...metadata,
          orderedPaths: [
            ...entries.map((entry) => entry.relativePath),
            ...addedPaths,
          ],
        });
      } catch (error) {
        await rm(target, { recursive: true, force: true });
        throw error;
      }
      return { relativePath, documentPath };
    });
  }

  async moveEntry(
    projectId: string,
    relativePath: string,
    direction: "up" | "down",
  ): Promise<void> {
    await this.withProjectLock(projectId, async () => {
      const project = await this.requireProject(projectId);
      const metadata = await this.currentMetadata(project);
      const structure = await this.getStructure(projectId);
      const path = relativePath.replaceAll("\\", "/");
      const entries = flattenEntries(structure.nodes);
      const entry = entries.find(
        (candidate) => candidate.relativePath === path,
      );
      if (!entry)
        throw new InvalidProjectPathError(
          "Only recognized writing entries may be reordered.",
        );
      await authorizeExistingEntry(project.rootPath, path);
      const parentPath = path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : undefined;
      const parent = entries.find(
        (candidate) => candidate.relativePath === parentPath,
      );
      const siblings =
        parent && parent.kind !== "document"
          ? [...parent.children]
          : [...structure.nodes];
      const index = siblings.findIndex(
        (candidate) => candidate.relativePath === path,
      );
      const targetIndex = index + (direction === "up" ? -1 : 1);
      const target = siblings[targetIndex];
      if (!target) return;
      const orderedPaths = entries.map((candidate) => candidate.relativePath);
      const entryIndex = orderedPaths.indexOf(path);
      const otherIndex = orderedPaths.indexOf(target.relativePath);
      orderedPaths[entryIndex] = target.relativePath;
      orderedPaths[otherIndex] = path;
      await writeMetadata(project.rootPath, { ...metadata, orderedPaths });
    });
  }

  private async currentMetadata(
    project: RegisteredProject,
  ): Promise<ProjectMetadata> {
    const metadata =
      (await readMetadata(project.rootPath)).metadata ?? project.metadata;
    if (
      metadata.projectId !== project.projectId ||
      metadata.template !== project.metadata.template
    ) {
      throw new InvalidProjectPathError(
        "Project metadata no longer matches the registered work.",
      );
    }
    return metadata;
  }

  async renameEntry(
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<string> {
    return this.withProjectLock(projectId, async () => {
      const project = await this.requireProject(projectId);
      await this.assertKnownEntry(project, relativePath);
      const metadata = await this.currentMetadata(project);
      const livePaths = new Set(
        flattenEntries((await this.getStructure(projectId)).nodes).map(
          (entry) => entry.relativePath,
        ),
      );
      const source = await authorizeExistingEntry(
        project.rootPath,
        relativePath,
      );
      const requestedName = source.isDocument
        ? name.replace(/\.md$/iu, "")
        : name;
      const safeName = validateProjectEntryName(requestedName);
      const targetName = source.isDocument ? `${safeName}.md` : safeName;
      const targetPath = join(dirname(source.absolutePath), targetName);
      if (targetPath === source.absolutePath) {
        return relativePath.replaceAll("\\", "/");
      }
      await assertPathDoesNotExist(targetPath);
      await rename(source.absolutePath, targetPath);
      const previousPath = relativePath.replaceAll("\\", "/");
      const nextPath = relative(project.rootPath, targetPath)
        .split(sep)
        .join("/");
      if (metadata.orderedPaths) {
        try {
          await writeMetadata(project.rootPath, {
            ...metadata,
            orderedPaths: metadata.orderedPaths
              .filter((path) => livePaths.has(path))
              .map((path) =>
                path === previousPath
                  ? nextPath
                  : path.startsWith(`${previousPath}/`)
                    ? `${nextPath}${path.slice(previousPath.length)}`
                    : path,
              ),
          });
        } catch (error) {
          await rename(targetPath, source.absolutePath);
          throw error;
        }
      }
      return nextPath;
    });
  }

  async deleteEntry(projectId: string, relativePath: string): Promise<void> {
    await this.withProjectLock(projectId, async () => {
      const project = await this.requireProject(projectId);
      await this.assertKnownEntry(project, relativePath);
      const source = await authorizeExistingEntry(
        project.rootPath,
        relativePath,
      );
      await validateWritingEntryTree(source.absolutePath);
      const metadata = await this.currentMetadata(project);
      const entries = flattenEntries(
        (await this.getStructure(projectId)).nodes,
      );
      // Persist parent identities before deletion so an empty volume remains usable.
      await writeMetadata(project.rootPath, {
        ...metadata,
        orderedPaths: entries.map((entry) => entry.relativePath),
      });
      await removeWritingEntry(source.absolutePath);
    });
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
    return this.withProjectLock(projectId, () =>
      this.withDocumentLock(lockKey, async () => {
        const project = await this.requireProject(projectId);
        const documentPath = await authorizeExistingDocument(
          project.rootPath,
          relativePath,
        );
        const beforeSave = await this.readDocument(projectId, relativePath);
        if (beforeSave.hash !== expectedHash) {
          throw new DocumentConflictError(expectedHash, beforeSave.hash);
        }

        await this.writeDocument(
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
      }),
    );
  }

  async applyDocumentBatch<T>(
    projectId: string,
    writes: readonly DocumentBatchWrite[],
    afterWrite: (documents: readonly AppliedBatchDocument[]) => Promise<T>,
  ): Promise<{
    readonly documents: readonly AppliedBatchDocument[];
    readonly afterWriteResult: T;
  }> {
    return this.withProjectLock(projectId, async () => {
      if (writes.length === 0 || writes.length > 20) {
        throw new ProjectServiceError("The document batch size is invalid.");
      }
      const project = await this.requireProject(projectId);
      const pathKeys = new Set<string>();
      const prepared = [] as {
        relativePath: string;
        absolutePath: string;
        content: string;
        expectedHash: string;
        originalContent: string;
        mode: number;
      }[];

      for (const write of writes) {
        const relativePath = write.relativePath.replaceAll("\\", "/");
        const pathKey = relativePath.toLocaleLowerCase("en-US");
        if (pathKeys.has(pathKey)) {
          throw new ProjectServiceError(
            "A document batch may write each path only once.",
          );
        }
        pathKeys.add(pathKey);
        const absolutePath = await authorizeExistingDocument(
          project.rootPath,
          relativePath,
        );
        const current = await this.readDocument(projectId, relativePath);
        if (current.hash !== write.expectedHash) {
          throw new DocumentConflictError(write.expectedHash, current.hash);
        }
        prepared.push({
          relativePath,
          absolutePath,
          content: write.content,
          expectedHash: write.expectedHash,
          originalContent: current.content,
          mode: current.mode,
        });
      }

      const written: typeof prepared = [];
      try {
        for (const document of prepared) {
          await this.writeDocument(
            document.absolutePath,
            document.content,
            document.mode,
            async () => {
              const currentHash = hashContent(
                await readFile(document.absolutePath),
              );
              if (currentHash !== document.expectedHash) {
                throw new DocumentConflictError(
                  document.expectedHash,
                  currentHash,
                );
              }
            },
          );
          written.push(document);
        }
      } catch (error) {
        for (const document of [...written].reverse()) {
          await this.writeDocument(
            document.absolutePath,
            document.originalContent,
            document.mode,
            async () => {
              const appliedHash = hashContent(document.content);
              const currentHash = hashContent(
                await readFile(document.absolutePath),
              );
              if (currentHash !== appliedHash) {
                throw new DocumentConflictError(appliedHash, currentHash);
              }
            },
          );
        }
        throw error;
      }

      const documents = await Promise.all(
        prepared.map(async (document): Promise<AppliedBatchDocument> => ({
          relativePath: document.relativePath,
          hash: hashContent(document.content),
          mtimeMs: (await stat(document.absolutePath)).mtimeMs,
        })),
      );
      const afterWriteResult = await afterWrite(documents);
      for (const document of documents) {
        this.publishDocumentSaved({
          type: "document-saved",
          projectId,
          ...document,
        });
      }
      return { documents, afterWriteResult };
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
      const metadata = {
        ...createMetadata(title, options.template),
        ...(preview.metadata.orderedPaths
          ? { orderedPaths: preview.metadata.orderedPaths }
          : {}),
      };
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
    const canonicalRoot = await realpath(project.rootPath);
    if (
      canonicalRoot !== project.rootPath ||
      !(await lstat(project.rootPath)).isDirectory()
    ) {
      throw new InvalidProjectPathError(
        "The registered project root no longer resolves to its original directory.",
      );
    }
    return project;
  }

  private async assertKnownEntry(
    project: RegisteredProject,
    relativePath: string,
  ): Promise<void> {
    const normalizedPath = relativePath.replaceAll("\\", "/");
    const structure = await buildProjectStructure(
      project.projectId,
      project.rootPath,
      project.metadata.template,
    );
    if (
      !containsStructurePath(structure.nodes, normalizedPath) &&
      !containsStructurePath(structure.unclassified, normalizedPath)
    ) {
      throw new InvalidProjectPathError(
        "Only entries in the recognized project structure may be changed.",
      );
    }
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

  private async withProjectLock<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.operationQueue.run(projectId, () => {
      this.options.assertCanMutate?.(projectId);
      return operation();
    });
  }
}
