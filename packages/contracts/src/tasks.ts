import { z } from "zod";

export const LongTaskKindSchema = z.enum([
  "index_initialize",
  "index_update",
  "agent",
]);
export type LongTaskKind = z.infer<typeof LongTaskKindSchema>;

export const TaskProgressEventSchema = z.strictObject({
  type: z.literal("task.progress"),
  taskId: z.uuid(),
  taskKind: LongTaskKindSchema,
  phase: z.string().trim().min(1),
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive().nullable(),
  message: z.string().trim().min(1).optional(),
  timestamp: z.iso.datetime(),
});

export type TaskProgressEvent = z.infer<typeof TaskProgressEventSchema>;

export const TaskCancelRequestSchema = z.strictObject({
  taskId: z.uuid(),
});

export type TaskCancelRequest = z.infer<typeof TaskCancelRequestSchema>;

export const TaskCancelResultSchema = z.strictObject({
  taskId: z.uuid(),
  accepted: z.boolean(),
});

export type TaskCancelResult = z.infer<typeof TaskCancelResultSchema>;

export const TaskCancelledEventSchema = z.strictObject({
  type: z.literal("task.cancelled"),
  taskId: z.uuid(),
  taskKind: LongTaskKindSchema,
  reason: z.enum(["user", "timeout", "shutdown"]),
  timestamp: z.iso.datetime(),
});

export type TaskCancelledEvent = z.infer<typeof TaskCancelledEventSchema>;

export const LongTaskEventSchema = z.discriminatedUnion("type", [
  TaskProgressEventSchema,
  TaskCancelledEventSchema,
]);

export type LongTaskEvent = z.infer<typeof LongTaskEventSchema>;
