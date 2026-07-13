import { z } from "zod";

export const AppErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "IPC_CHANNEL_NOT_ALLOWED",
  "IPC_ORIGIN_NOT_ALLOWED",
  "PATH_NOT_AUTHORIZED",
  "NOT_FOUND",
  "CONFLICT",
  "IO_FAILED",
  "GIT_FAILED",
  "INDEX_UNAVAILABLE",
  "AI_UNAVAILABLE",
  "RATE_LIMITED",
  "CANCELLED",
  "TIMEOUT",
  "INTERNAL_ERROR",
]);

export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>;

export const AppErrorSchema = z.strictObject({
  code: AppErrorCodeSchema,
  message: z.string().trim().min(1),
  retryable: z.boolean(),
  requestId: z.string().trim().min(1).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type AppError = z.infer<typeof AppErrorSchema>;

export const AppErrorResponseSchema = z.strictObject({
  error: AppErrorSchema,
});

export type AppErrorResponse = z.infer<typeof AppErrorResponseSchema>;
