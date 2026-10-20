import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import {
  parseProjectMetadata,
  PROJECT_METADATA_FILE_NAME,
} from "@author-copilot/project-schema";
import { SymbolicLinkNotAllowedError } from "./errors.js";
import { authorizeExistingEntry } from "./path-policy.js";

import type {
  ProjectDocument,
  ProjectStructure,
  ProjectStructureNode,
  ProjectTemplate,
} from "./types.js";

interface ScannedDocument extends ProjectDocument {
  readonly segments: readonly string[];
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

async function scanMarkdownFiles(rootPath: string): Promise<ScannedDocument[]> {
  const canonicalRoot = await realpath(rootPath);
  const documents: ScannedDocument[] = [];

  async function visit(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "author-copilot.json") {
        continue;
      }

      const entryPath = join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }

      const relativePath = portablePath(relative(canonicalRoot, entryPath));
      documents.push({
        kind: "document",
        name: entry.name.slice(0, -3),
        relativePath,
        segments: relativePath.split("/"),
      });
    }
  }

  await visit(canonicalRoot);
  return documents;
}

function buildNovelStructure(documents: readonly ScannedDocument[]): {
  readonly nodes: readonly ProjectStructureNode[];
  readonly unclassified: readonly ProjectDocument[];
} {
  const classified = documents.filter(
    (document) => document.segments.length === 3,
  );
  const unclassified = documents.filter(
    (document) => document.segments.length !== 3,
  );
  const volumes = new Map<string, Map<string, ScannedDocument[]>>();

  for (const document of classified) {
    const [volumeName, chapterName] = document.segments;
    if (volumeName === undefined || chapterName === undefined) continue;
    const chapters = volumes.get(volumeName) ?? new Map();
    const chapterDocuments = chapters.get(chapterName) ?? [];
    chapterDocuments.push(document);
    chapters.set(chapterName, chapterDocuments);
    volumes.set(volumeName, chapters);
  }

  const nodes = [...volumes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map<ProjectStructureNode>(([volumeName, chapters]) => ({
      kind: "volume",
      name: volumeName,
      relativePath: volumeName,
      children: [...chapters.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map<ProjectStructureNode>(([chapterName, chapterDocuments]) => ({
          kind: "chapter",
          name: chapterName,
          relativePath: `${volumeName}/${chapterName}`,
          children: chapterDocuments.map((document) => ({
            kind: document.kind,
            name: document.name,
            relativePath: document.relativePath,
          })),
        })),
    }));

  return {
    nodes,
    unclassified: unclassified.map((document) => ({
      kind: document.kind,
      name: document.name,
      relativePath: document.relativePath,
    })),
  };
}

function buildScreenplayStructure(documents: readonly ScannedDocument[]): {
  readonly nodes: readonly ProjectStructureNode[];
  readonly unclassified: readonly ProjectDocument[];
} {
  const classified = documents.filter(
    (document) => document.segments.length === 2,
  );
  const unclassified = documents.filter(
    (document) => document.segments.length !== 2,
  );
  const acts = new Map<string, ScannedDocument[]>();

  for (const document of classified) {
    const actName = document.segments[0];
    if (actName === undefined) continue;
    const actDocuments = acts.get(actName) ?? [];
    actDocuments.push(document);
    acts.set(actName, actDocuments);
  }

  const nodes = [...acts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map<ProjectStructureNode>(([actName, actDocuments]) => ({
      kind: "act",
      name: actName,
      relativePath: actName,
      children: actDocuments.map((document) => ({
        kind: document.kind,
        name: document.name,
        relativePath: document.relativePath,
      })),
    }));

  return {
    nodes,
    unclassified: unclassified.map((document) => ({
      kind: document.kind,
      name: document.name,
      relativePath: document.relativePath,
    })),
  };
}

export async function buildProjectStructure(
  projectId: string,
  rootPath: string,
  template: ProjectTemplate,
): Promise<ProjectStructure> {
  const documents = await scanMarkdownFiles(rootPath);
  const structure =
    template === "novel"
      ? buildNovelStructure(documents)
      : buildScreenplayStructure(documents);
  // Order lives with the work, so copies and Git branch changes preserve it.
  let orderedPaths: readonly string[] = [];
  try {
    const metadataPath = join(rootPath, PROJECT_METADATA_FILE_NAME);
    if ((await lstat(metadataPath)).isSymbolicLink()) {
      throw new SymbolicLinkNotAllowedError(
        "Project metadata cannot be a symbolic link.",
      );
    }
    orderedPaths =
      parseProjectMetadata(JSON.parse(await readFile(metadataPath, "utf8")))
        .orderedPaths ?? [];
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  // Keep known empty groups visible after their last manuscript is deleted.
  const nodes = [...structure.nodes];
  for (const path of orderedPaths) {
    const segments = path.split("/");
    if (segments.length > (template === "novel" ? 2 : 1)) continue;
    const [groupName, chapterName] = segments;
    if (groupName === undefined) continue;
    const groupIndex = nodes.findIndex(
      (node) => node.relativePath === groupName,
    );
    const group = nodes[groupIndex];
    if (
      group &&
      (chapterName === undefined ||
        group.children.some((child) => child.relativePath === path))
    )
      continue;
    try {
      if ((await authorizeExistingEntry(rootPath, path)).isDocument) continue;
    } catch (error) {
      if (
        error instanceof SymbolicLinkNotAllowedError ||
        (error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        continue;
      throw error;
    }
    const parent: ProjectStructureNode = group ?? {
      kind: template === "novel" ? "volume" : "act",
      name: groupName,
      relativePath: groupName,
      children: [],
    };
    const restored =
      chapterName === undefined
        ? parent
        : {
            ...parent,
            children: [
              ...parent.children,
              {
                kind: "chapter" as const,
                name: chapterName,
                relativePath: path,
                children: [],
              },
            ],
          };
    if (groupIndex < 0) nodes.push(restored);
    else nodes[groupIndex] = restored;
  }
  const positions = new Map(orderedPaths.map((path, index) => [path, index]));
  const applyOrder = <T extends ProjectStructureNode | ProjectDocument>(
    nodes: readonly T[],
  ): T[] =>
    [...nodes]
      .sort(
        (left, right) =>
          (positions.get(left.relativePath) ?? Infinity) -
          (positions.get(right.relativePath) ?? Infinity),
      )
      .map((node) => ({
        ...node,
        ...(node.kind === "document"
          ? {}
          : { children: applyOrder(node.children) }),
      }));
  return {
    projectId,
    template,
    ...structure,
    nodes: applyOrder(nodes),
  };
}
