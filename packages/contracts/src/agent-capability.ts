import { z } from "zod";

export const AGENT_TASK_MIN_TIMEOUT_MS = 1_000;
export const AGENT_TASK_MAX_TIMEOUT_MS = 10 * 60_000;

export const AgentFileTypeSchema = z.enum(["markdown"]);

export type AgentFileType = z.infer<typeof AgentFileTypeSchema>;

export const AgentToolNameSchema = z.enum([
  "mcp__author_copilot__read_text",
  "mcp__author_copilot__write_text",
  "mcp__author_copilot__edit_text",
  "mcp__author_copilot__glob",
  "mcp__author_copilot__grep",
]);

export type AgentToolName = z.infer<typeof AgentToolNameSchema>;

const AgentFileTypesSchema = z
  .array(AgentFileTypeSchema)
  .max(AgentFileTypeSchema.options.length)
  .refine(
    (fileTypes) => new Set(fileTypes).size === fileTypes.length,
    "Agent file types must be unique.",
  )
  .readonly();

const AgentToolsSchema = z
  .array(AgentToolNameSchema)
  .min(1)
  .max(AgentToolNameSchema.options.length)
  .refine(
    (tools) => new Set(tools).size === tools.length,
    "Agent tools must be unique.",
  )
  .readonly();

const AgentCapabilityPolicySchema = z
  .strictObject({
    readableFileTypes: AgentFileTypesSchema,
    writableFileTypes: AgentFileTypesSchema,
    allowedTools: AgentToolsSchema,
    timeoutMs: z
      .number()
      .int()
      .min(AGENT_TASK_MIN_TIMEOUT_MS)
      .max(AGENT_TASK_MAX_TIMEOUT_MS),
  })
  .superRefine((capability, context) => {
    const readable = new Set(capability.readableFileTypes);
    for (const fileType of capability.writableFileTypes) {
      if (!readable.has(fileType)) {
        context.addIssue({
          code: "custom",
          message: "Writable Agent file types must also be readable.",
          path: ["writableFileTypes"],
        });
      }
    }

    const tools = new Set(capability.allowedTools);
    const hasReadTool = [
      "mcp__author_copilot__read_text",
      "mcp__author_copilot__glob",
      "mcp__author_copilot__grep",
    ].some((tool) => tools.has(tool as AgentToolName));
    if (hasReadTool && capability.readableFileTypes.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Read tools require at least one readable file type.",
        path: ["readableFileTypes"],
      });
    }

    const hasWriteTool = [
      "mcp__author_copilot__write_text",
      "mcp__author_copilot__edit_text",
    ].some((tool) => tools.has(tool as AgentToolName));
    if (hasWriteTool && capability.writableFileTypes.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Write tools require at least one writable file type.",
        path: ["writableFileTypes"],
      });
    }
  });

export const AgentTaskCapabilityGrantRequestSchema =
  AgentCapabilityPolicySchema.safeExtend({
    projectId: z.uuid(),
  });

export type AgentTaskCapabilityGrantRequest = z.infer<
  typeof AgentTaskCapabilityGrantRequestSchema
>;

export const AgentTaskCapabilitySchema = AgentCapabilityPolicySchema.safeExtend(
  {
    taskId: z.uuid(),
    projectId: z.uuid(),
    createdAt: z.iso.datetime(),
  },
);

export type AgentTaskCapability = z.infer<typeof AgentTaskCapabilitySchema>;
