import { z } from "zod";

export const WritingStatisticsRequestSchema = z.strictObject({
  projectId: z.uuid(),
  sessionId: z.uuid(),
  day: z.iso.date(),
});

// Cumulative session totals make retries and delayed responses idempotent.
export const WritingStatisticsRecordSchema =
  WritingStatisticsRequestSchema.extend({
    sequence: z.int().positive(),
    netCharacters: z.int(),
  });

export const WritingStatisticsSnapshotSchema = z.strictObject({
  day: z.iso.date(),
  netCharacters: z.int(),
  sessionCharacters: z.int(),
  sequence: z.int().nonnegative(),
});

export const WritingStatisticsResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    snapshot: WritingStatisticsSnapshotSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.enum(["invalid_request", "unavailable"]),
  }),
]);

export const WritingStatisticsHistoryRequestSchema = z.strictObject({
  projectId: z.uuid(),
  // Leave room for six preceding calendar days, including at the ISO lower bound.
  endDay: z.iso.date().refine((day) => day >= "0000-01-07"),
});

export const WritingStatisticsHistorySchema = z.strictObject({
  days: z
    .array(
      z.strictObject({
        day: z.iso.date(),
        netCharacters: z.int(),
      }),
    )
    .length(7),
  netCharacters: z.int(),
});

export const WritingStatisticsHistoryResponseSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      ok: z.literal(true),
      history: WritingStatisticsHistorySchema,
    }),
    z.strictObject({
      ok: z.literal(false),
      error: z.enum(["invalid_request", "unavailable"]),
    }),
  ],
);

export type WritingStatisticsHistoryRequest = z.infer<
  typeof WritingStatisticsHistoryRequestSchema
>;
export type WritingStatisticsHistory = z.infer<
  typeof WritingStatisticsHistorySchema
>;
export type WritingStatisticsHistoryResponse = z.infer<
  typeof WritingStatisticsHistoryResponseSchema
>;

export type WritingStatisticsRequest = z.infer<
  typeof WritingStatisticsRequestSchema
>;
export type WritingStatisticsRecord = z.infer<
  typeof WritingStatisticsRecordSchema
>;
export type WritingStatisticsSnapshot = z.infer<
  typeof WritingStatisticsSnapshotSchema
>;
export type WritingStatisticsResponse = z.infer<
  typeof WritingStatisticsResponseSchema
>;
