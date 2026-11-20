import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import {
  DocumentDraftSchema,
  type DocumentDraft,
} from "@author-copilot/contracts";
import { InvalidProjectPathError } from "./errors.js";

export const BACKUP_MANIFEST = "author-copilot-backup.json";
const FileSchema = z.strictObject({
  path: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  size: z.number().int().nonnegative(),
});
const ManifestSchema = z.strictObject({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  files: z.array(FileSchema).max(10000),
  drafts: z.array(DocumentDraftSchema).max(2000),
});
type BackupFile = z.infer<typeof FileSchema>;
const MAX_BYTES = 512 * 1024 * 1024;

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
  );
}

async function inventory(root: string): Promise<BackupFile[]> {
  if ((await realpath(root)) !== root || (await lstat(root)).isSymbolicLink())
    throw new InvalidProjectPathError("Backup source was redirected.");
  const files: BackupFile[] = [];
  let bytes = 0;
  const walk = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (directory === root && entry.name === BACKUP_MANIFEST) continue;
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink() || (await realpath(path)) !== path)
        throw new InvalidProjectPathError(
          "Backup cannot contain redirected entries.",
        );
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) {
        if (
          info.nlink !== 1 ||
          info.size > 128 * 1024 * 1024 ||
          path.endsWith(".lock")
        )
          throw new InvalidProjectPathError(
            "Backup contains linked, oversized or busy files.",
          );
        bytes += info.size;
        if (bytes > MAX_BYTES || files.length >= 10000)
          throw new Error("Backup exceeds the 512 MB / 10,000 file limit.");
        const content = await readFile(path);
        files.push({
          path: relative(root, path).split(sep).join("/"),
          size: content.length,
          hash: createHash("sha256").update(content).digest("hex"),
        });
      } else
        throw new InvalidProjectPathError(
          "Backup contains a non-regular entry.",
        );
    }
  };
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function validateBackup(root: string) {
  const manifestPath = join(root, BACKUP_MANIFEST);
  const info = await lstat(manifestPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > 64 * 1024 * 1024
  )
    throw new InvalidProjectPathError("Backup manifest is invalid.");
  const manifest = ManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const files = await inventory(root);
  const signature = (entries: readonly BackupFile[]) =>
    JSON.stringify(
      entries.map((entry) => [entry.path, entry.size, entry.hash]),
    );
  if (signature(files) !== signature(manifest.files))
    throw new Error("Backup is incomplete or changed. No work was restored.");
  // Git must be a self-contained repository. Do not carry configuration that
  // references files or executable helpers outside the restored work.
  for (const entry of files) {
    if (
      [
        ".git/commondir",
        ".git/gitdir",
        ".git/objects/info/alternates",
        ".git/objects/info/http-alternates",
      ].includes(entry.path)
    )
      throw new InvalidProjectPathError(
        "Linked Git repositories cannot be restored.",
      );
  }
  const git = files.find((entry) => entry.path === ".git");
  if (git)
    throw new InvalidProjectPathError(
      "Git directory redirection cannot be restored.",
    );
  return manifest;
}

export async function createProjectBackup(
  root: string,
  destination: string,
  title: string,
  registeredRoots: readonly string[],
  drafts: readonly DocumentDraft[],
) {
  const parent = await realpath(destination);
  if (registeredRoots.some((registered) => inside(registered, parent)))
    throw new InvalidProjectPathError(
      "Choose a backup location outside every registered work.",
    );
  const safeTitle = title
    .slice(0, 48)
    .replaceAll(/[<>:"/\\|?*\x00-\x1f]/gu, "_");
  const directoryName = `Author-Copilot-${safeTitle}-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}.author-copilot-backup`;
  const finalPath = join(parent, directoryName);
  const stage = join(parent, `.author-copilot-backup-${randomUUID()}.partial`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const files = await inventory(root);
    for (const entry of files) {
      const parts = entry.path.split("/");
      if (parts.length > 1)
        await mkdir(join(stage, ...parts.slice(0, -1)), {
          recursive: true,
          mode: 0o700,
        });
      await copyFile(join(root, ...parts), join(stage, ...parts));
    }
    if (
      JSON.stringify(files) !== JSON.stringify(await inventory(root)) ||
      JSON.stringify(files) !== JSON.stringify(await inventory(stage))
    )
      throw new Error(
        "Work changed while backing up. Retry after saving finishes.",
      );
    const manifest = JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      files,
      drafts,
    });
    if (Buffer.byteLength(manifest) > 64 * 1024 * 1024)
      throw new Error(
        "Backup recovery data exceeds the size limit. Save or review drafts first.",
      );
    await writeFile(join(stage, BACKUP_MANIFEST), manifest, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(stage, finalPath);
    return { directoryName: basename(finalPath), fileCount: files.length };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function sanitizeRestoredGit(root: string): Promise<void> {
  const git = join(root, ".git");
  try {
    await lstat(git);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await rm(join(git, "hooks"), { recursive: true, force: true });
  await writeFile(
    join(git, "config"),
    "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n",
    { mode: 0o600 },
  );
  await rm(join(git, "config.worktree"), { force: true });
}
