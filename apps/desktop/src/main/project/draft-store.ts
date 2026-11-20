import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import {
  DocumentDraftSchema,
  type DocumentDraft,
  type DocumentDraftRequest,
} from "@author-copilot/contracts";
import { atomicWriteFile } from "./file-utils.js";
import { InvalidProjectPathError } from "./errors.js";
import { validateDocumentRelativePath } from "./path-policy.js";

// The caller captures the identity-specific runtime directory and serializes
// operations. Drafts never live in the model's accessible workspace.
export async function operateDrafts(
  directory: string,
  request: DocumentDraftRequest,
): Promise<DocumentDraft[]> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (
    (await realpath(directory)) !== directory ||
    (await lstat(directory)).isSymbolicLink()
  )
    throw new InvalidProjectPathError("The draft directory was redirected.");
  const read = async (name: string): Promise<DocumentDraft> => {
    const path = join(directory, name);
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 64 * 1024 * 1024
    )
      throw new InvalidProjectPathError(
        "Draft storage is invalid or redirected.",
      );
    const draft = DocumentDraftSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    const key = createHash("sha256").update(draft.relativePath).digest("hex");
    if (draft.projectId !== request.projectId || `${key}.json` !== name)
      throw new InvalidProjectPathError("Draft identity mismatch.");
    return draft;
  };
  if (request.action === "list") {
    const drafts = [];
    for (const name of await readdir(directory)) {
      if (/^[a-f0-9]{64}\.json$/u.test(name)) drafts.push(await read(name));
    }
    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const relativePath = validateDocumentRelativePath(
    request.relativePath,
  ).replaceAll("\\", "/");
  const key = createHash("sha256").update(relativePath).digest("hex");
  const name = `${key}.json`;
  const path = join(directory, name);
  let previous: DocumentDraft | undefined;
  try {
    previous = await read(name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (request.action === "delete") {
    if (previous?.revision === request.revision)
      await rm(path, { force: true });
    return [];
  }
  if (!previous && (await readdir(directory)).length >= 2000)
    throw new Error(
      "Draft limit reached. Review existing drafts before writing more.",
    );
  const draft = DocumentDraftSchema.parse({
    projectId: request.projectId,
    baseHash: request.baseHash,
    content: request.content,
    revision: request.revision,
    relativePath,
    updatedAt: new Date().toISOString(),
  });
  await atomicWriteFile(path, JSON.stringify(draft), 0o600);
  return [draft];
}
