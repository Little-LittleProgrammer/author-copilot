import { parentPort, workerData } from "node:worker_threads";
import WordExtractor from "word-extractor";

const { bytes, maxBytes } = workerData as {
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
};
try {
  const document = await new WordExtractor().extract(Buffer.from(bytes));
  const content = document.getBody();
  parentPort?.postMessage(
    Buffer.byteLength(content, "utf8") > maxBytes
      ? { error: "too_large" }
      : { content },
  );
} catch {
  parentPort?.postMessage({ error: "unreadable" });
}
