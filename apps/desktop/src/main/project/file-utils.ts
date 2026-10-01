import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is unavailable on some supported platforms/filesystems.
  }
}

export async function atomicWriteFile(
  targetPath: string,
  content: string,
  mode?: number,
  beforeReplace?: () => void | Promise<void>,
): Promise<void> {
  const parent = dirname(targetPath);
  await mkdir(parent, { recursive: true });

  const temporaryPath = join(
    parent,
    `.${basename(targetPath)}.${randomUUID()}.tmp`,
  );
  let handle;

  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    if (mode !== undefined) {
      await chmod(temporaryPath, mode);
    }

    await beforeReplace?.();
    await rename(temporaryPath, targetPath);
    await syncDirectory(parent);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
