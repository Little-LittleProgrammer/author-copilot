import { z } from "zod";

import { AppErrorSchema } from "./errors.js";

export const AnthropicCredentialStatusSchema = z.strictObject({
  configured: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
});

export const AnthropicCredentialStatusRequestSchema = z.strictObject({});

export const AnthropicCredentialSetRequestSchema = z.strictObject({
  apiKey: z
    .string()
    .min(1)
    .max(16 * 1024)
    .refine(
      (value) => !/[\0\r\n]/u.test(value),
      "The API key contains invalid characters.",
    ),
});

export const AnthropicCredentialDeleteRequestSchema = z.strictObject({});

export const AnthropicCredentialResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    status: AnthropicCredentialStatusSchema,
  }),
  z.strictObject({ ok: z.literal(false), error: AppErrorSchema }),
]);

export type AnthropicCredentialStatus = z.infer<
  typeof AnthropicCredentialStatusSchema
>;
export type AnthropicCredentialSetRequest = z.infer<
  typeof AnthropicCredentialSetRequestSchema
>;
export type AnthropicCredentialResponse = z.infer<
  typeof AnthropicCredentialResponseSchema
>;
