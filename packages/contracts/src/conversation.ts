import { z } from "zod";
import { AiChatContextMetadataSchema } from "./ai-chat.js";
import { AgentReviewSchema } from "./agent-workflow.js";
import { AppErrorSchema } from "./errors.js";
import { CreativeNoteReferencesSchema } from "./creative-notes.js";

export const ConversationMessageSchema = z.strictObject({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  mode: z.enum(["ask", "agent"]),
  content: z.string().max(200_000),
  status: z.enum([
    "streaming",
    "complete",
    "cancelled",
    "failed",
    "interrupted",
  ]),
  runId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  context: AiChatContextMetadataSchema.optional(),
  creativeNotes: CreativeNoteReferencesSchema.optional(),
  review: AgentReviewSchema.optional(),
  resolution: z.enum(["kept", "undone"]).optional(),
  error: z.string().max(10_000).optional(),
});
export const ConversationSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  mode: z.enum(["ask", "agent"]),
  updatedAt: z.iso.datetime(),
  messages: z.array(ConversationMessageSchema).max(2_000),
});
export const ConversationSummarySchema = ConversationSchema.omit({
  messages: true,
}).extend({ taskIds: z.array(z.uuid()) });
const project = { projectId: z.uuid() };
export const ConversationRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list"), ...project }),
  z.strictObject({ action: z.literal("get"), ...project, id: z.uuid() }),
  z.strictObject({
    action: z.literal("save"),
    conversation: ConversationSchema,
  }),
  z.strictObject({ action: z.literal("delete"), ...project, id: z.uuid() }),
]);
export const ConversationResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    conversations: z.array(ConversationSummarySchema).optional(),
    conversation: ConversationSchema.optional(),
  }),
  z.strictObject({ ok: z.literal(false), error: AppErrorSchema }),
]);
export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export type ConversationRequest = z.infer<typeof ConversationRequestSchema>;
export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;
