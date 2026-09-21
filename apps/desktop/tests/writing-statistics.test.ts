import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WritingStatisticsRecordSchema,
  type WritingStatisticsRecord,
} from "@author-copilot/contracts";
import { WritingStatisticsService } from "../src/main/writing-statistics/writing-statistics-service.js";
import {
  countWritingCharacters,
  localWritingDay,
  WritingRate,
  WritingStatisticsTracker,
} from "../src/renderer/src/features/editor/writing-statistics.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "writing-statistics-"));
  roots.push(root);
  return {
    root,
    service: new WritingStatisticsService(root),
    request: {
      projectId: randomUUID(),
      sessionId: randomUUID(),
      day: "2026-09-19",
    },
  };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("writing statistics persistence", () => {
  it("keeps signed net totals through restarts, sessions, retries and out-of-order requests", async () => {
    const { root, service, request } = await fixture();
    expect(await service.get(request)).toMatchObject({ netCharacters: 0 });
    await Promise.all([
      service.record({ ...request, sequence: 2, netCharacters: 12 }),
      service.record({ ...request, sequence: 1, netCharacters: 7 }),
      service.record({ ...request, sequence: 2, netCharacters: 12 }),
    ]);
    const next = { ...request, sessionId: randomUUID() };
    await service.record({ ...next, sequence: 1, netCharacters: -15 });
    const restarted = new WritingStatisticsService(root);
    expect(await restarted.get(next)).toMatchObject({
      netCharacters: -3,
      sessionCharacters: -15,
    });
    expect(
      await restarted.get({ ...request, projectId: randomUUID() }),
    ).toMatchObject({ netCharacters: 0 });
    expect(
      await restarted.get({ ...request, day: "2026-09-20" }),
    ).toMatchObject({ netCharacters: 0 });
  });

  it("rejects malformed input and preserves corrupt statistics instead of resetting history", async () => {
    const { root, service, request } = await fixture();
    for (const changes of [
      { projectId: "../escape" },
      { day: "2026-02-30" },
      { netCharacters: 1.5 },
      { sequence: 0 },
      { content: "private manuscript" },
    ]) {
      expect(
        WritingStatisticsRecordSchema.safeParse({
          ...request,
          sequence: 1,
          netCharacters: 1,
          ...changes,
        }).success,
      ).toBe(false);
    }
    await service.record({ ...request, sequence: 1, netCharacters: 10 });
    const path = join(root, request.projectId, `${request.day}.json`);
    await writeFile(path, "damaged");
    await expect(
      service.record({ ...request, sequence: 2, netCharacters: 20 }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("damaged");
    // A failed write does not poison subsequent projects' queue.
    await expect(
      service.get({ ...request, projectId: randomUUID() }),
    ).resolves.toMatchObject({ netCharacters: 0 });
  });
});

describe("manual writing activity", () => {
  it("does not display zero as historical data while storage is unavailable", async () => {
    const tracker = new WritingStatisticsTracker(
      randomUUID(),
      randomUUID(),
      undefined,
    );
    expect(tracker.snapshot().today).toBeUndefined();
    await tracker.refresh();
    expect(tracker.snapshot()).toMatchObject({
      today: undefined,
      failed: true,
    });
    tracker.record("", "雨夜", true);
    expect(tracker.snapshot()).toMatchObject({
      today: undefined,
      failed: true,
      pending: true,
    });
  });

  it("counts Unicode characters and punctuation without whitespace or surrogate inflation", () => {
    expect(countWritingCharacters("　雨夜，\r\nA B\t𠮷🙂")).toBe(7);
    expect(localWritingDay(new Date(2026, 8, 19, 0, 1))).toBe("2026-09-19");
  });

  it("estimates recent typing, pauses after idle, and restarts without the idle gap", () => {
    const rate = new WritingRate();
    rate.record(5, 1000);
    expect(rate.value(1000)).toBe(30);
    rate.record(5, 11_000);
    expect(rate.value(21_000)).toBe(30);
    expect(rate.value(41_000)).toBe(0);
    rate.record(2, 200_000);
    expect(rate.value(200_000)).toBe(12);
    expect(rate.value(199_999)).toBe(0);
    for (let second = 0; second <= 90; second += 10)
      rate.record(10, second * 1000);
    expect(rate.value(90_000)).toBe(60);
  });

  it("tracks manual deltas independently of saves, excludes paste from speed, and splits midnight", async () => {
    const { service, request } = await fixture();
    let now = new Date(2026, 8, 19, 23, 59, 59);
    const api = {
      get: async (input: {
        projectId: string;
        sessionId: string;
        day: string;
      }) => ({ ok: true as const, snapshot: await service.get(input) }),
      record: async (input: WritingStatisticsRecord) => ({
        ok: true as const,
        snapshot: await service.record(input),
      }),
    };
    const tracker = new WritingStatisticsTracker(
      request.projectId,
      request.sessionId,
      api,
      () => now,
    );
    await tracker.refresh();
    tracker.record("已有正文", "已有正文雨夜", true);
    tracker.record("已有正文雨夜", "已有正文雨夜粘贴的文字", false);
    await tracker.refresh();
    expect(tracker.snapshot()).toMatchObject({
      today: 7,
      rate: 12,
      failed: false,
      pending: false,
    });
    tracker.record("已有正文雨夜粘贴的文字", "已有正文雨夜", false);
    await tracker.refresh();
    expect(tracker.snapshot().today).toBe(2);
    now = new Date(2026, 8, 20, 0, 0, 1);
    tracker.record("已有正文雨夜", "已有正文雨夜新", true);
    await tracker.refresh();
    expect(tracker.snapshot().today).toBe(1);
    expect(await service.get(request)).toMatchObject({ netCharacters: 2 });
    expect(await service.get({ ...request, day: "2026-09-20" })).toMatchObject({
      netCharacters: 1,
    });
  });

  it("retries an acknowledged-on-disk write after response loss without double-counting", async () => {
    const { service, request } = await fixture();
    let fail = true;
    const tracker = new WritingStatisticsTracker(
      request.projectId,
      request.sessionId,
      {
        get: async (input) => ({
          ok: true as const,
          snapshot: await service.get(input),
        }),
        record: async (input) => {
          const snapshot = await service.record(input);
          if (fail) throw new Error("lost response");
          return { ok: true, snapshot };
        },
      },
      () => new Date(2026, 8, 19),
    );
    await tracker.refresh();
    tracker.record("", "雨夜", true);
    await tracker.refresh();
    expect(tracker.snapshot()).toMatchObject({
      today: 2,
      failed: true,
      pending: true,
    });
    fail = false;
    await tracker.refresh();
    expect(tracker.snapshot()).toMatchObject({
      today: 2,
      failed: false,
      pending: false,
    });
    expect(await service.get(request)).toMatchObject({ netCharacters: 2 });
  });
});
