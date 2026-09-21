import { z } from "zod";
import {
  AgentTaskCapabilityGrantRequestSchema,
  AgentTaskCapabilitySchema,
} from "./agent-capability.js";
import { AgentTaskEventSchema } from "./agent-task.js";
import { AppErrorSchema } from "./errors.js";
import { RelativeProjectPathSchema } from "./project.js";

export const AgentStartRequestSchema =
  AgentTaskCapabilityGrantRequestSchema.safeExtend({
    prompt: z.string().trim().min(1).max(200_000),
  });
export const AgentProjectRequestSchema = z.strictObject({
  projectId: z.uuid(),
});
export const AgentTaskRequestSchema = AgentProjectRequestSchema.extend({
  taskId: z.uuid(),
});
export const AgentRetainRequestSchema = AgentTaskRequestSchema.extend({
  reviewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const AgentReviewSchema = z.strictObject({
  taskId: z.uuid(),
  reviewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  files: z
    .array(
      z.strictObject({
        path: RelativeProjectPathSchema,
        before: z.string().nullable(),
        after: z.string().nullable(),
        truncated: z.boolean(),
      }),
    )
    .max(10_000),
});
export const AgentStateSchema = z.strictObject({
  running: z.boolean(),
  taskId: z.uuid().optional(),
  event: AgentTaskEventSchema.optional(),
  review: AgentReviewSchema.optional(),
  versionError: AppErrorSchema.optional(),
});
const failure = z.strictObject({ ok: z.literal(false), error: AppErrorSchema });
export const AgentStartResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    capability: AgentTaskCapabilitySchema,
  }),
  failure,
]);
export const AgentStateResponseSchema = z.union([
  z.strictObject({ ok: z.literal(true), state: AgentStateSchema }),
  failure,
]);
export const AgentCancelResponseSchema = z.strictObject({
  accepted: z.boolean(),
});
export const AgentRetainResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    commitId: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/u)
      .nullable(),
  }),
  failure,
]);
export type AgentStartRequest = z.infer<typeof AgentStartRequestSchema>;
export type AgentStartResponse = z.infer<typeof AgentStartResponseSchema>;
export type AgentProjectRequest = z.infer<typeof AgentProjectRequestSchema>;
export type AgentTaskRequest = z.infer<typeof AgentTaskRequestSchema>;
export type AgentRetainRequest = z.infer<typeof AgentRetainRequestSchema>;
export type AgentRetainResponse = z.infer<typeof AgentRetainResponseSchema>;
export type AgentCancelResponse = z.infer<typeof AgentCancelResponseSchema>;
export type AgentReview = z.infer<typeof AgentReviewSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type AgentStateResponse = z.infer<typeof AgentStateResponseSchema>;
