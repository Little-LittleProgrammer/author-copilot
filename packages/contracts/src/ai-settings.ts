import { z } from "zod";
import { AppErrorSchema } from "./errors.js";

export const ApiBaseUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  }, "Use HTTPS, or HTTP on localhost, without credentials, query or fragment.")
  .transform((value) => value.replace(/\/+$/u, "").replace(/\/v1$/u, ""));
export const ModelIdSchema = z.string().trim().min(1).max(200);
export const ProviderIdSchema = z.union([z.literal("anthropic"), z.uuid()]);
export const AiSelectionSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("custom"),
    providerId: ProviderIdSchema,
    model: ModelIdSchema,
  }),
  z.strictObject({ mode: z.literal("platform"), model: ModelIdSchema }),
]);
export const ProviderSchema = z.strictObject({
  id: ProviderIdSchema,
  name: z.string().trim().min(1).max(80),
  baseURL: ApiBaseUrlSchema,
  configured: z.boolean(),
});
export const ModelPriceSchema = z.strictObject({
  input: z.number().int().min(0).max(1e12),
  output: z.number().int().min(0).max(1e12),
  cacheRead: z.number().int().min(0).max(1e12),
  cacheWrite: z.number().int().min(0).max(1e12),
});
export const AiModelSchema = z.strictObject({
  id: ModelIdSchema,
  name: z.string(),
  price: ModelPriceSchema.optional(),
});
export const AccountUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
});
export const SessionTokensSchema = z.strictObject({
  user: AccountUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number().int(),
});
export const AiSettingsStateSchema = z.strictObject({
  providers: z.array(ProviderSchema),
  selection: AiSelectionSchema,
  platformConfigured: z.boolean(),
  user: AccountUserSchema.nullable(),
});
export const UsageRecordSchema = z.strictObject({
  id: z.string(),
  model: z.string(),
  status: z.enum([
    "reserved",
    "settled",
    "released",
    "pending_review",
    "credit",
  ]),
  reservedMicro: z.number().int(),
  chargedMicro: z.number().int(),
  createdAt: z.string(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
});
export const AccountSummarySchema = z.strictObject({
  availableMicro: z.number().int(),
  heldMicro: z.number().int(),
  paymentEnabled: z.literal(false),
  records: z.array(UsageRecordSchema),
});
const PasswordSchema = z.string().min(10).max(256);
export const LoginRequestSchema = z.strictObject({
  email: z.email().transform((value) => value.toLowerCase()),
  password: PasswordSchema,
});
export const ResetPasswordSchema = z.strictObject({
  token: z.string().min(20).max(512),
  password: PasswordSchema,
});
export const AiSettingsRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("state") }),
  z.strictObject({
    action: z.literal("saveProvider"),
    id: ProviderIdSchema.optional(),
    name: z.string().trim().min(1).max(80),
    baseURL: ApiBaseUrlSchema,
    apiKey: z
      .string()
      .min(1)
      .max(16384)
      .refine((v) => !/[\0\r\n]/u.test(v))
      .optional(),
  }),
  z.strictObject({ action: z.literal("deleteProvider"), id: ProviderIdSchema }),
  z.strictObject({
    action: z.literal("models"),
    providerId: ProviderIdSchema.optional(),
  }),
  z.strictObject({ action: z.literal("select"), selection: AiSelectionSchema }),
  z.strictObject({ action: z.literal("login"), ...LoginRequestSchema.shape }),
  z.strictObject({
    action: z.literal("register"),
    ...LoginRequestSchema.shape,
  }),
  z.strictObject({ action: z.literal("forgotPassword"), email: z.email() }),
  z.strictObject({
    action: z.literal("resetPassword"),
    ...ResetPasswordSchema.shape,
  }),
  z.strictObject({ action: z.literal("logout") }),
  z.strictObject({ action: z.literal("account") }),
]);
export const AiSettingsResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    state: AiSettingsStateSchema.optional(),
    models: z.array(AiModelSchema).optional(),
    account: AccountSummarySchema.optional(),
    notice: z.string().optional(),
  }),
  z.strictObject({ ok: z.literal(false), error: AppErrorSchema }),
]);
export type AiSelection = z.infer<typeof AiSelectionSchema>;
export type AiProvider = z.infer<typeof ProviderSchema>;
export type AiModel = z.infer<typeof AiModelSchema>;
export type ModelPrice = z.infer<typeof ModelPriceSchema>;
export type AccountUser = z.infer<typeof AccountUserSchema>;
export type AccountSummary = z.infer<typeof AccountSummarySchema>;
export type SessionTokens = z.infer<typeof SessionTokensSchema>;
export type AiSettingsState = z.infer<typeof AiSettingsStateSchema>;
export type AiSettingsRequest = z.infer<typeof AiSettingsRequestSchema>;
export type AiSettingsResponse = z.infer<typeof AiSettingsResponseSchema>;
