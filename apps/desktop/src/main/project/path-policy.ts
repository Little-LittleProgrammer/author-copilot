import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { PROJECT_METADATA_FILE_NAME } from "@author-copilot/project-schema";

import {
  InvalidProjectPathError,
  SymbolicLinkNotAllowedError,
} from "./errors.js";

function isInside(rootPath: string, candidatePath: string): boolean {
  const pathFromRoot = relative(rootPath, candidatePath);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

export function validateProjectEntryName(name: string): string {
  const normalized = name.trim();
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.length > 252 ||
    /[<>:"/\\|?*\0]/u.test(normalized) ||
    /[. ]$/u.test(normalized)
  ) {
    throw new InvalidProjectPathError(
      "The name cannot be used for a project entry.",
    );
  }
  return normalized;
}

export async function authorizeExistingEntry(
  rootPath: string,
  relativePath: string,
): Promise<{ readonly absolutePath: string; readonly isDocument: boolean }> {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath)
  ) {
    throw new InvalidProjectPathError("A relative project path is required.");
  }

  const portableSegments = relativePath.replaceAll("\\", "/").split("/");
  if (
    portableSegments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) ||
    portableSegments.some((segment) => segment.toLowerCase() === ".git") ||
    portableSegments.at(-1)?.toLowerCase() ===
      PROJECT_METADATA_FILE_NAME.toLowerCase()
  ) {
    throw new InvalidProjectPathError("The project entry path is not allowed.");
  }

  const canonicalRoot = await realpath(rootPath);
  const candidatePath = resolve(canonicalRoot, ...portableSegments);
  if (!isInside(canonicalRoot, candidatePath)) {
    throw new InvalidProjectPathError(
      "The entry path escapes the project root.",
    );
  }

  let currentPath = canonicalRoot;
  for (const segment of portableSegments) {
    currentPath = resolve(currentPath, segment);
    const entryStats = await lstat(currentPath);
    if (entryStats.isSymbolicLink()) {
      throw new SymbolicLinkNotAllowedError(
        "Symbolic links are not allowed in project entry paths.",
      );
    }
  }

  const entryStats = await lstat(candidatePath);
  const isDocument = entryStats.isFile();
  if (
    (!entryStats.isDirectory() && !isDocument) ||
    (isDocument && !portableSegments.at(-1)?.toLowerCase().endsWith(".md"))
  ) {
    throw new InvalidProjectPathError(
      "Only project folders and writing documents may be renamed.",
    );
  }

  return { absolutePath: candidatePath, isDocument };
}

export function validateDocumentRelativePath(relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath)
  ) {
    throw new InvalidProjectPathError(
      "A relative Markdown document path is required.",
    );
  }

  const portableSegments = relativePath.replaceAll("\\", "/").split("/");
  if (
    portableSegments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) ||
    portableSegments.some((segment) => segment.toLowerCase() === ".git") ||
    portableSegments.at(-1)?.toLowerCase() ===
      PROJECT_METADATA_FILE_NAME.toLowerCase() ||
    !portableSegments.at(-1)?.toLowerCase().endsWith(".md")
  ) {
    throw new InvalidProjectPathError(
      "Only ordinary Markdown files inside a registered project may be accessed.",
    );
  }

  return portableSegments.join(sep);
}

export async function authorizeExistingDocument(
  rootPath: string,
  relativePath: string,
): Promise<string> {
  const normalizedRelativePath = validateDocumentRelativePath(relativePath);
  const canonicalRoot = await realpath(rootPath);
  const candidatePath = resolve(canonicalRoot, normalizedRelativePath);

  if (!isInside(canonicalRoot, candidatePath)) {
    throw new InvalidProjectPathError(
      "The document path escapes the project root.",
    );
  }

  let currentPath = canonicalRoot;
  for (const segment of normalizedRelativePath.split(sep)) {
    currentPath = resolve(currentPath, segment);
    const entryStats = await lstat(currentPath);
    if (entryStats.isSymbolicLink()) {
      throw new SymbolicLinkNotAllowedError(
        "Symbolic links are not allowed in document paths.",
      );
    }
  }

  const documentStats = await lstat(candidatePath);
  if (!documentStats.isFile()) {
    throw new InvalidProjectPathError(
      "The document path is not a regular file.",
    );
  }

  const canonicalDocument = await realpath(candidatePath);
  if (!isInside(canonicalRoot, canonicalDocument)) {
    throw new InvalidProjectPathError(
      "The document path escapes the project root.",
    );
  }

  return candidatePath;
}
