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
