import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import { ProjectServiceError, SymbolicLinkNotAllowedError } from "./errors.js";

export async function copyDirectoryWithoutSymlinks(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const sourceStats = await lstat(sourcePath);
  if (sourceStats.isSymbolicLink()) {
    throw new SymbolicLinkNotAllowedError(
      "Projects containing symbolic links cannot be copied.",
    );
  }
  if (!sourceStats.isDirectory()) {
    throw new ProjectServiceError("The import source is not a directory.");
  }

  await mkdir(destinationPath);
  const entries = await readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourceEntry = join(sourcePath, entry.name);
    const destinationEntry = join(destinationPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new SymbolicLinkNotAllowedError(
        `Projects containing symbolic links cannot be copied: ${entry.name}`,
      );
    }
    if (entry.isDirectory()) {
      await copyDirectoryWithoutSymlinks(sourceEntry, destinationEntry);
    } else if (entry.isFile()) {
      await copyFile(sourceEntry, destinationEntry);
    } else {
      throw new ProjectServiceError(
        `Unsupported filesystem entry in project: ${entry.name}`,
      );
    }
  }
}
