import { readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";

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
  return { projectId, template, ...structure };
}
