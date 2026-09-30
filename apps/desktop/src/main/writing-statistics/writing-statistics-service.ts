import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  WritingStatisticsHistoryRequestSchema,
  WritingStatisticsHistorySchema,
  type WritingStatisticsHistoryRequest,
  type WritingStatisticsHistory,
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

  history(
    request: WritingStatisticsHistoryRequest,
  ): Promise<WritingStatisticsHistory> {
    return this.enqueue(async () => {
      const { projectId, endDay } =
        WritingStatisticsHistoryRequestSchema.parse(request);
      // These are date labels, not instants. UTC arithmetic avoids DST gaps.
      const end = new Date(`${endDay}T00:00:00.000Z`);
      const days = [];
      for (let offset = 6; offset >= 0; offset--) {
        const date = new Date(end);
        date.setUTCDate(date.getUTCDate() - offset);
        const day = date.toISOString().slice(0, 10);
        const data = await this.readDay(projectId, day);
        days.push({
          day,
          netCharacters: Object.values(data.sessions).reduce(
            (total, session) => total + session.netCharacters,
            0,
          ),
        });
      }
      return WritingStatisticsHistorySchema.parse({
        days,
        netCharacters: days.reduce(
          (total, day) => total + day.netCharacters,
          0,
        ),
      });
    });
  }

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

  private async readDay(
    projectId: string,
    day: string,
  ): Promise<z.infer<typeof DayFileSchema>> {
    try {
      return DayFileSchema.parse(
        JSON.parse(
          await readFile(join(this.root, projectId, `${day}.json`), "utf8"),
        ),
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      return { schemaVersion: 1, sessions: {} };
    }
  }

  private async access(
    request: WritingStatisticsRequest | WritingStatisticsRecord,
  ): Promise<WritingStatisticsSnapshot> {
    const path = join(this.root, request.projectId, `${request.day}.json`);
    const data = await this.readDay(request.projectId, request.day);
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
