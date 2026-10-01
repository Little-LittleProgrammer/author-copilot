import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ApiBaseUrlSchema, ModelPriceSchema } from "@author-copilot/contracts";

export const RelayConfigSchema = z
  .strictObject({
    baseURL: ApiBaseUrlSchema,
    apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/u),
    defaultModel: z.string().min(1),
    models: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          name: z.string(),
          maxOutputTokens: z.number().int().positive().max(32768),
          price: ModelPriceSchema,
        }),
      )
      .min(1),
  })
  .superRefine((config, context) => {
    if (
      !config.models.some((model) => model.id === config.defaultModel) ||
      new Set(config.models.map((model) => model.id)).size !==
        config.models.length
    )
      context.addIssue({
        code: "custom",
        message: "Default model must be enabled and model IDs unique.",
      });
  });
export type RelayConfig = z.infer<typeof RelayConfigSchema>;
export async function loadRelayConfig(): Promise<RelayConfig> {
  const path = process.env.RELAY_CONFIG;
  if (!path) throw new Error("Platform relay is not configured.");
  return RelayConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
