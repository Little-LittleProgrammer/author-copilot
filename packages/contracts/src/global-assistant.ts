import { z } from "zod";
import { AppErrorSchema } from "./errors.js";
export const GlobalAssistantMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(200_000),
  createdAt: z.iso.datetime(),
});
export const GlobalAssistantRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("get") }),
  z.strictObject({
    action: z.literal("send"),
    prompt: z.string().trim().min(1).max(20_000),
  }),
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({ action: z.literal("clear") }),
]);
export const GlobalAssistantResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    accountId: z.string().min(1),
    running: z.boolean(),
    messages: z.array(GlobalAssistantMessageSchema).max(100),
  }),
  z.strictObject({ ok: z.literal(false), error: AppErrorSchema }),
]);
export type GlobalAssistantMessage = z.infer<
  typeof GlobalAssistantMessageSchema
>;
export type GlobalAssistantRequest = z.infer<
  typeof GlobalAssistantRequestSchema
>;
export type GlobalAssistantResponse = z.infer<
  typeof GlobalAssistantResponseSchema
>;

export const WorkspaceChangedEventSchema = z.strictObject({});
