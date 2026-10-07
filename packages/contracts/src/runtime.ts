import { z } from "zod";

export const RuntimeInfoRequestSchema = z.strictObject({});

export type RuntimeInfoRequest = z.infer<typeof RuntimeInfoRequestSchema>;

export const RuntimePlatformSchema = z.enum(["darwin", "win32"]);
export const RuntimeArchitectureSchema = z.enum(["x64", "arm64"]);

export const RuntimeInfoSchema = z.strictObject({
  appVersion: z.string().trim().min(1),
  electronVersion: z.string().trim().min(1),
  nodeVersion: z.string().trim().min(1),
  platform: RuntimePlatformSchema,
  arch: RuntimeArchitectureSchema,
  packaged: z.boolean(),
});

export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;
