import { z } from "zod";

import {
  AiCurrentDocumentContextSchema,
  AiInstructionSchema,
} from "./ai-context.js";
import { AppErrorSchema } from "./errors.js";
import { AiPatchReviewSchema } from "./ai-patch.js";
import {
  KnowledgeIndexStatusSchema,
  KnowledgeSearchHitSchema,
} from "./index-status.js";

export const AI_CHAT_MAX_HISTORY_MESSAGES = 20;
export const AI_CHAT_MAX_MESSAGE_CHARACTERS = 20_000;

export const AiChatHistoryMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(AI_CHAT_MAX_MESSAGE_CHARACTERS),
});

export type AiChatHistoryMessage = z.infer<typeof AiChatHistoryMessageSchema>;

export const AiChatStartRequestSchema = z.strictObject({
  projectId: z.uuid(),
  mode: z.enum(["chat", "proposal"]).optional(),
  currentDocument: AiCurrentDocumentContextSchema,
  instruction: AiInstructionSchema,
  history: z
    .array(AiChatHistoryMessageSchema)
    .max(AI_CHAT_MAX_HISTORY_MESSAGES)
    .default([]),
  retrievalLimit: z.number().int().min(1).max(20).default(5),
});

export type AiChatStartRequest = z.infer<typeof AiChatStartRequestSchema>;

export const AiChatSourceSchema = KnowledgeSearchHitSchema.extend({
  sourceId: z.number().int().positive(),
});

export type AiChatSource = z.infer<typeof AiChatSourceSchema>;

export const AiChatContextMetadataSchema = z.strictObject({
  scope: z.enum(["current_document", "full_book"]),
  knowledgeStatus: KnowledgeIndexStatusSchema,
  indexVersion: z.string().trim().min(1).nullable(),
  degradationReason: z
    .enum(["index_not_ready", "permission_denied", "retrieval_failed"])
    .nullable(),
  sources: z.array(AiChatSourceSchema).max(20),
});

export type AiChatContextMetadata = z.infer<typeof AiChatContextMetadataSchema>;

export const AiChatStartResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    runId: z.uuid(),
    context: AiChatContextMetadataSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: AppErrorSchema,
  }),
]);

export type AiChatStartResponse = z.infer<typeof AiChatStartResponseSchema>;

const AiChatEventBaseSchema = z.strictObject({
  runId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
});

export const AiChatDeltaEventSchema = AiChatEventBaseSchema.extend({
  type: z.literal("ai.chat.delta"),
  text: z.string().min(1),
});

export const AiChatCompletedEventSchema = AiChatEventBaseSchema.extend({
  type: z.literal("ai.chat.completed"),
});

export const AiProposalReadyEventSchema = AiChatEventBaseSchema.extend({
  type: z.literal("ai.proposal.ready"),
  review: AiPatchReviewSchema,
});

export const AiChatFailedEventSchema = AiChatEventBaseSchema.extend({
  type: z.literal("ai.chat.failed"),
  error: AppErrorSchema,
});

export const AiChatCancelledEventSchema = AiChatEventBaseSchema.extend({
  type: z.literal("ai.chat.cancelled"),
  reason: z.enum(["user", "shutdown"]),
});

export const AiChatEventSchema = z.discriminatedUnion("type", [
  AiChatDeltaEventSchema,
  AiProposalReadyEventSchema,
  AiChatCompletedEventSchema,
  AiChatFailedEventSchema,
  AiChatCancelledEventSchema,
]);

export type AiChatEvent = z.infer<typeof AiChatEventSchema>;

export const AiChatCancelRequestSchema = z.strictObject({
  runId: z.uuid(),
});

export type AiChatCancelRequest = z.infer<typeof AiChatCancelRequestSchema>;

export const AiChatCancelResponseSchema = z.strictObject({
  runId: z.uuid(),
  accepted: z.boolean(),
});

export type AiChatCancelResponse = z.infer<typeof AiChatCancelResponseSchema>;
