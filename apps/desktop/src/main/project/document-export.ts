import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { Worker } from "node:worker_threads";
import type { ProjectExportRequest } from "@author-copilot/contracts";
import { atomicWriteFile } from "./file-utils.js";
import { authorizeExistingDocument } from "./path-policy.js";
import type {
  ProjectDocument,
  ProjectStructure,
  ProjectStructureNode,
} from "./types.js";

export class DocumentExportError extends Error {
  constructor(
    readonly reason:
      "empty" | "too_large" | "changed" | "destination" | "failed",
  ) {
    super(`Document export failed: ${reason}`);
  }
}

export interface ExportBlock {
  readonly kind: "heading" | "body";
  readonly text: string;
  readonly level?: 1 | 2 | 3 | 4;
  readonly pageBreak?: boolean;
}
export interface ManuscriptSnapshot {
  readonly title: string;
  readonly fileTitle: string;
  readonly blocks: readonly ExportBlock[];
  readonly documentCount: number;
}
type Entry = ProjectStructureNode | ProjectDocument;
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
const MAX_EXPORT_LINES = 100_000;

function title(name: string): string {
  return name.replace(/^\d{4}-/u, "");
}
function find(nodes: readonly Entry[], path: string): Entry | undefined {
  for (const node of nodes) {
    if (node.relativePath === path) return node;
    if (node.kind !== "document") {
      const child = find(node.children, path);
      if (child) return child;
    }
  }
  return undefined;
}

/** Read only recognized manuscripts, in the same order as the sidebar. */
export async function snapshotManuscript(
  rootPath: string,
  projectTitle: string,
  structure: ProjectStructure,
  request: ProjectExportRequest,
): Promise<ManuscriptSnapshot> {
  let nodes: readonly Entry[] = structure.nodes;
  let fileTitle = projectTitle;
  if (request.scope === "chapter") {
    const selected = find(nodes, request.relativePath.replaceAll("\\", "/"));
    if (
      !selected ||
      (selected.kind !== "chapter" && selected.kind !== "document")
    )
      throw new DocumentExportError("empty");
    // A novel chapter includes all its scenes, even when the editor opens its body directly.
    const chapter =
      structure.template === "novel"
        ? find(nodes, selected.relativePath.split("/").slice(0, 2).join("/"))
        : selected;
    if (!chapter) throw new DocumentExportError("empty");
    nodes = [chapter];
    fileTitle = `${projectTitle}-${title(chapter.name)}`;
  }
  const blocks: ExportBlock[] = [
    { kind: "heading", text: projectTitle, level: 1 },
  ];
  let bytes = Buffer.byteLength(projectTitle);
  let lines = 1;
  let documentCount = 0;
  let chapterCount = 0;
  const snapshots: {
    path: string;
    size: number;
    mtimeMs: number;
    ino: number;
    dev: number;
  }[] = [];
  const visit = async (
    entries: readonly Entry[],
    level: 2 | 3 | 4,
  ): Promise<void> => {
    for (const [index, entry] of entries.entries()) {
      const heading = title(entry.name);
      const chapterStart =
        entry.kind === "chapter" ||
        (structure.template === "screenplay" && entry.kind === "document");
      const hideBodyTitle =
        structure.template === "novel" &&
        entry.kind === "document" &&
        entry.name === "01-正文";
      if (!hideBodyTitle) {
        const newGroup =
          (entry.kind === "volume" || entry.kind === "act") &&
          documentCount > 0;
        blocks.push({
          kind: "heading",
          text: heading,
          level,
          pageBreak:
            newGroup || (chapterStart && chapterCount > 0 && index > 0),
        });
        bytes += Buffer.byteLength(heading);
        lines += 1;
      }
      if (chapterStart) chapterCount += 1;
      if (entry.kind !== "document") {
        await visit(entry.children, Math.min(level + 1, 4) as 3 | 4);
        continue;
      }
      if (++documentCount > 2000) throw new DocumentExportError("too_large");
      const path = await authorizeExistingDocument(
        rootPath,
        entry.relativePath,
      );
      const handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size + bytes > MAX_EXPORT_BYTES)
          throw new DocumentExportError("too_large");
        // Bound the allocation even if an external editor grows the file while it is read.
        const buffer = Buffer.alloc(before.size + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const read = await handle.read(
            buffer,
            offset,
            buffer.length - offset,
            offset,
          );
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        const after = await handle.stat();
        if (
          offset !== before.size ||
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs
        )
          throw new DocumentExportError("changed");
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(
            buffer.subarray(0, offset),
          );
        } catch {
          throw new DocumentExportError("failed");
        }
        text = text.replace(/\r\n?/gu, "\n");
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))
          throw new DocumentExportError("failed");
        bytes += offset;
        lines += text.split("\n").length;
        if (lines > MAX_EXPORT_LINES || bytes > MAX_EXPORT_BYTES)
          throw new DocumentExportError("too_large");
        blocks.push({ kind: "body", text });
        snapshots.push({
          path,
          size: after.size,
          mtimeMs: after.mtimeMs,
          ino: after.ino,
          dev: after.dev,
        });
      } finally {
        await handle.close();
      }
    }
  };
  await visit(nodes, 2);
  if (!documentCount) throw new DocumentExportError("empty");
  for (const snapshot of snapshots) {
    const current = await lstat(snapshot.path);
    if (
      current.isSymbolicLink() ||
      current.size !== snapshot.size ||
      current.mtimeMs !== snapshot.mtimeMs ||
      current.ino !== snapshot.ino ||
      current.dev !== snapshot.dev
    )
      throw new DocumentExportError("changed");
  }
  return { title: projectTitle, fileTitle, blocks, documentCount };
}

export function suggestedExportName(
  snapshot: ManuscriptSnapshot,
  format: ProjectExportRequest["format"],
): string {
  const stem = Array.from(
    snapshot.fileTitle.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_"),
  )
    .slice(0, 50)
    .join("")
    .replace(/[. ]+$/u, "");
  const portable = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(stem)
    ? `_${stem}`
    : stem;
  return `${portable || "Manuscript"}.${format}`;
}

function renderInWorker(
  snapshot: ManuscriptSnapshot,
  format: ProjectExportRequest["format"],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "./document-export-worker.ts"
          : "./document-export-worker.js",
        import.meta.url,
      ),
      {
        workerData: { snapshot, format },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      },
    );
    let settled = false;
    const finish = (bytes?: Uint8Array): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (bytes) resolve(Buffer.from(bytes));
      else reject(new DocumentExportError("failed"));
    };
    const timer = setTimeout(() => finish(), 30_000);
    worker.once("message", (value: unknown) =>
      finish(value instanceof Uint8Array ? value : undefined),
    );
    worker.once("error", () => finish());
    worker.once("exit", () => finish());
  });
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return (
    child === "" ||
    (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  );
}

export async function writeManuscriptExport(
  snapshot: ManuscriptSnapshot,
  format: ProjectExportRequest["format"],
  destination: string,
  projectRoots: readonly string[],
): Promise<string> {
  const parent = await realpath(dirname(destination));
  const target = join(parent, basename(destination));
  // A delivery file must never replace a manuscript, metadata or another registered work.
  if (
    projectRoots.some((root) => inside(root, target)) ||
    !target.toLowerCase().endsWith(`.${format}`)
  )
    throw new DocumentExportError("destination");
  const inspect = async () => {
    try {
      const entry = await lstat(target);
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new DocumentExportError("destination");
      return entry;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return undefined;
      throw error;
    }
  };
  // The native save dialog has already asked before replacing this existing file.
  const before = await inspect();
  const bytes = await renderInWorker(snapshot, format);
  await atomicWriteFile(target, bytes, 0o600, async () => {
    if ((await realpath(dirname(destination))) !== parent)
      throw new DocumentExportError("destination");
    const current = await inspect();
    if (
      current?.ino !== before?.ino ||
      current?.dev !== before?.dev ||
      current?.mtimeMs !== before?.mtimeMs ||
      current?.size !== before?.size
    )
      throw new DocumentExportError("changed");
  });
  return basename(target);
}
