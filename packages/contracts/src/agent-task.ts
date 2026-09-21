import { z } from "zod";

import { AppErrorSchema } from "./errors.js";

export const AGENT_TASK_MAX_SUMMARY_CHARACTERS = 100_000;

const AgentTaskEventBaseSchema = z.strictObject({
  taskId: z.uuid(),
  projectId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
});

export const AgentTaskStartedEventSchema = AgentTaskEventBaseSchema.extend({
  type: z.literal("agent.task.started"),
});

export const AgentTaskProgressPhaseSchema = z.enum([
  "initializing",
  "running",
  "responding",
  "tool",
  "finalizing",
]);

export const AgentTaskProgressEventSchema = AgentTaskEventBaseSchema.extend({
  type: z.literal("agent.task.progress"),
  phase: AgentTaskProgressPhaseSchema,
});

export const AgentTaskCompletedEventSchema = AgentTaskEventBaseSchema.extend({
  type: z.literal("agent.task.completed"),
  summary: z.string().max(AGENT_TASK_MAX_SUMMARY_CHARACTERS),
  durationMs: z.number().int().nonnegative(),
  numTurns: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  permissionDenialCount: z.number().int().nonnegative(),
});

export const AgentTaskCancelledEventSchema = AgentTaskEventBaseSchema.extend({
  type: z.literal("agent.task.cancelled"),
  reason: z.enum(["user", "timeout", "shutdown"]),
});

export const AgentTaskFailedEventSchema = AgentTaskEventBaseSchema.extend({
  type: z.literal("agent.task.failed"),
  error: AppErrorSchema,
});

export const AgentTaskEventSchema = z.discriminatedUnion("type", [
  AgentTaskStartedEventSchema,
  AgentTaskProgressEventSchema,
  AgentTaskCompletedEventSchema,
  AgentTaskCancelledEventSchema,
  AgentTaskFailedEventSchema,
]);

export type AgentTaskEvent = z.infer<typeof AgentTaskEventSchema>;
export type AgentTaskProgressPhase = z.infer<
  typeof AgentTaskProgressPhaseSchema
>;
export type AgentTaskTerminalEvent = Extract<
  AgentTaskEvent,
  {
    readonly type:
      "agent.task.completed" | "agent.task.cancelled" | "agent.task.failed";
  }
>;
