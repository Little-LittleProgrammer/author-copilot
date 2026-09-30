import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Worker as NodeWorker } from "node:worker_threads";

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;

export type ImportFailureReason =
  | "unsupported"
  | "too_large"
  | "unreadable"
  | "empty"
  | "changed"
  | "too_many_chapters";
export class DocumentImportError extends Error {
  constructor(readonly reason: ImportFailureReason) {
    super(`Document import failed: ${reason}`);
    this.name = "DocumentImportError";
  }
}

export interface DocumentImportPreview {
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly title: string;
  readonly format: "txt" | "doc" | "docx";
  readonly content: string;
}

async function readSource(path: string): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new DocumentImportError("unsupported");
    if (info.size > MAX_IMPORT_BYTES)
      throw new DocumentImportError("too_large");
    // Read a bounded snapshot even if another process grows the file during import.
    const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_IMPORT_BYTES + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > info.size) throw new DocumentImportError("changed");
    return buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
}

function decodeText(buffer: Buffer): string {
  let encoding = "utf-8";
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = "utf-16le";
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = "utf-16be";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    if (
      encoding !== "utf-8" ||
      buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    )
      throw new DocumentImportError("unreadable");
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(buffer);
    } catch {
      throw new DocumentImportError("unreadable");
    }
  }
}

// Word parsing runs outside Electron's main thread. A malformed document cannot
// keep the UI busy indefinitely; only plain body text crosses the worker boundary.
function extractWord(bytes: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "./document-import-worker.ts"
          : "./document-import-worker.js",
        import.meta.url,
      ),
      {
        workerData: {
          bytes,
          maxBytes: MAX_TEXT_BYTES,
        },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      },
    );
    let settled = false;
    const finish = (
      content?: string,
      reason: ImportFailureReason = "unreadable",
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (content !== undefined) resolve(content);
      else reject(new DocumentImportError(reason));
    };
    const timer = setTimeout(() => finish(), 15_000);
    worker.once("message", (value: unknown) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "content" in value &&
        typeof value.content === "string"
      )
        finish(value.content);
      else
        finish(
          undefined,
          typeof value === "object" &&
            value !== null &&
            "error" in value &&
            value.error === "too_large"
            ? "too_large"
            : "unreadable",
        );
    });
    worker.once("error", () => finish());
    worker.once("exit", () => {
      if (!settled) finish();
    });
  });
}

export async function previewDocumentImport(
  path: string,
): Promise<DocumentImportPreview> {
  const sourcePath = await realpath(path);
  const extension = extname(sourcePath).toLowerCase();
  if (![".txt", ".doc", ".docx"].includes(extension))
    throw new DocumentImportError("unsupported");
  const format = extension.slice(1) as DocumentImportPreview["format"];
  const bytes = await readSource(sourcePath);
  let content = format === "txt" ? decodeText(bytes) : await extractWord(bytes);
  content = content
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\u000c/gu, "\n");
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/u.test(content))
    throw new DocumentImportError("unreadable");
  if (!content.trim()) throw new DocumentImportError("empty");
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES)
    throw new DocumentImportError("too_large");
  // The source name becomes a portable new-project folder, never a destination path.
  const title =
    basename(sourcePath, extname(sourcePath))
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
      .slice(0, 180)
      .replace(/[. ]+$/u, "")
      .trim() || "Imported work";
  return {
    sourcePath,
    sourceHash: createHash("sha256").update(bytes).digest("hex"),
    title,
    format,
    content,
  };
}

export async function assertImportSourceUnchanged(
  preview: DocumentImportPreview,
): Promise<void> {
  const bytes = await readSource(preview.sourcePath);
  if (createHash("sha256").update(bytes).digest("hex") !== preview.sourceHash)
    throw new DocumentImportError("changed");
}
