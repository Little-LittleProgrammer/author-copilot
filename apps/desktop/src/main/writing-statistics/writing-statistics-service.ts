import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  WritingStatisticsRecordSchema,
  WritingStatisticsRequestSchema,
  WritingStatisticsSnapshotSchema,
  type WritingStatisticsRecord,
  type WritingStatisticsRequest,
  type WritingStatisticsSnapshot,
} from "@author-copilot/contracts";
import { atomicWriteFile } from "../project/file-utils.js";

const DayFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessions: z.record(
    z.uuid(),
    z.strictObject({
      sequence: z.int().positive(),
      netCharacters: z.int(),
    }),
  ),
});

/** One Main-owned writer; statistics never contain manuscript text. */
export class WritingStatisticsService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {}

  get(request: WritingStatisticsRequest): Promise<WritingStatisticsSnapshot> {
    return this.enqueue(() =>
      this.access(WritingStatisticsRequestSchema.parse(request)),
    );
  }

  record(request: WritingStatisticsRecord): Promise<WritingStatisticsSnapshot> {
    return this.enqueue(() =>
      this.access(WritingStatisticsRecordSchema.parse(request)),
    );
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async access(
    request: WritingStatisticsRequest | WritingStatisticsRecord,
  ): Promise<WritingStatisticsSnapshot> {
    const path = join(this.root, request.projectId, `${request.day}.json`);
    let data: z.infer<typeof DayFileSchema>;
    try {
      data = DayFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      data = { schemaVersion: 1, sessions: {} };
    }
    const previous = data.sessions[request.sessionId];
    const changed =
      "sequence" in request && request.sequence > (previous?.sequence ?? 0);
    if (changed && "sequence" in request) {
      data.sessions[request.sessionId] = {
        sequence: request.sequence,
        netCharacters: request.netCharacters,
      };
    }
    const current = data.sessions[request.sessionId];
    const snapshot = WritingStatisticsSnapshotSchema.parse({
      day: request.day,
      netCharacters: Object.values(data.sessions).reduce(
        (total, session) => total + session.netCharacters,
        0,
      ),
      sessionCharacters: current?.netCharacters ?? 0,
      sequence: current?.sequence ?? 0,
    });
    if (changed) {
      await mkdir(dirname(path), { recursive: true });
      await atomicWriteFile(path, `${JSON.stringify(data)}\n`, 0o600);
    }
    return snapshot;
  }
}
