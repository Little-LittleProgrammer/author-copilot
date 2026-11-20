import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import type {
  CanUseTool,
  HookCallback,
  HookInput,
  Options,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentTaskCapability } from "@author-copilot/contracts";
import type { AgentCapabilityService } from "./capability-service.js";
import type { TaskSnapshotService } from "../../git/task-snapshot-service.js";

import {
  CREATIVE_ASSET_PATH,
  validateAssetEdit,
} from "../../creative-notes/asset-document.js";

export const NATIVE_READ_TOOLS = ["Read", "Glob", "Grep", "Skill"] as const;
export const NATIVE_WRITE_TOOLS = ["Write", "Edit"] as const;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return (
    part === "" ||
    (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part))
  );
}
function record(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error("Invalid tool input.");
  return input as Record<string, unknown>;
}

export interface NativeToolPolicyOptions {
  capability: AgentTaskCapability;
  capabilityService: Pick<AgentCapabilityService, "authorizeTask">;
  projectRoot: string;
  skills: readonly string[];
  skillReadRoots: readonly string[];
  snapshots?: Pick<
    TaskSnapshotService,
    "prepareNativeMutation" | "completeNativeMutation"
  >;
  readOnly?: boolean;
  onFilesChanged?: () => Promise<void>;
}

/** Hooks guard native tools; no model-facing filesystem tools are introduced. */
export class NativeToolPolicy {
  private readonly reads = new Map<string, string>();
  private readonly reading = new Map<string, { path: string; hash: string }>();
  private readonly pending = new Map<
    string,
    { path: string; mutationId: string; content: string }
  >();
  private readonly busyPaths = new Set<string>();
  private readonly operations = new Set<Promise<unknown>>();
  constructor(private readonly options: NativeToolPolicyOptions) {}

  private async assertSearchTree(path: string): Promise<void> {
    let remaining = 20_000;
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (--remaining < 0)
          throw new Error("Narrow the search to a smaller directory.");
        if (entry.name.toLowerCase() === ".git") continue;
        const target = join(directory, entry.name);
        const info = await lstat(target);
        if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
          throw new Error("Search paths cannot contain redirected files.");
        if (info.isDirectory()) await visit(target);
      }
    };
    if ((await lstat(path)).isDirectory()) await visit(path);
  }

  async authorize(
    tool: string,
    raw: unknown,
  ): Promise<{ path?: string; input: Record<string, unknown> }> {
    this.options.capabilityService.authorizeTask(this.options.capability);
    if (!this.options.capability.allowedTools.includes(tool as never))
      throw new Error("Tool is not granted to this task.");
    const input = record(raw);
    if (tool === "Skill") {
      const name = input.skill;
      if (typeof name !== "string" || !this.options.skills.includes(name))
        throw new Error("Skill is not available in this workspace.");
      return { input };
    }
    if (![...NATIVE_READ_TOOLS, ...NATIVE_WRITE_TOOLS].includes(tool as never))
      throw new Error("Tool is not enabled.");
    if (tool === "Glob") {
      const pattern = input.pattern;
      if (
        typeof pattern !== "string" ||
        isAbsolute(pattern) ||
        win32.isAbsolute(pattern) ||
        pattern.includes("\\") ||
        pattern.split("/").includes("..")
      )
        throw new Error("Glob patterns must stay inside the workspace.");
    }
    const writing = NATIVE_WRITE_TOOLS.includes(tool as never);
    if (writing && (this.options.readOnly || !this.options.snapshots))
      throw new Error("This workspace is read-only.");
    const value =
      input.file_path ??
      input.path ??
      (tool === "Glob" || tool === "Grep" ? "." : undefined);
    if (
      typeof value !== "string" ||
      value.includes("\0") ||
      (process.platform !== "win32" && value.includes("\\")) ||
      (!isAbsolute(value) && win32.isAbsolute(value))
    )
      throw new Error("Invalid file path.");
    if (value.replaceAll("\\", "/").split("/").includes(".."))
      throw new Error("Parent directory traversal is not allowed.");
    const path = resolve(this.options.projectRoot, value);
    const roots = writing
      ? [this.options.projectRoot]
      : [this.options.projectRoot, ...this.options.skillReadRoots];
    const allowedRoot = roots.find((root) => inside(root, path));
    if (!allowedRoot || (await realpath(allowedRoot)) !== allowedRoot)
      throw new Error("Path escapes this workspace.");
    const segments = relative(allowedRoot, path).split(sep).filter(Boolean);
    if (
      segments.some(
        (part) =>
          /[<>:"|?*]/u.test(part) ||
          /[. ]$/u.test(part) ||
          [".git", ".mcp.json", ".claude.json"].includes(part.toLowerCase()),
      )
    )
      throw new Error("Internal paths are protected.");
    if (writing) {
      const relativePath = relative(this.options.projectRoot, path)
        .split(sep)
        .join("/");
      const normalized = relativePath.toLowerCase();
      if (
        !normalized.endsWith(".md") ||
        normalized === "claude.md" ||
        normalized === "author-copilot.json" ||
        (normalized.startsWith(".claude/") &&
          !normalized.startsWith(".claude/skills/"))
      )
        throw new Error(
          "Only manuscript, asset and Skill Markdown edits are enabled.",
        );
    }
    let cursor = allowedRoot;
    for (const segment of segments) {
      cursor = join(cursor, segment);
      try {
        const info = await lstat(cursor);
        if (
          info.isSymbolicLink() ||
          (!info.isFile() && !info.isDirectory()) ||
          (info.isFile() && info.nlink > 1)
        )
          throw new Error("Redirected file paths are not allowed.");
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }
    if (tool === "Glob" || tool === "Grep") await this.assertSearchTree(path);
    return {
      path,
      input: {
        ...input,
        ...(tool === "Read" || writing ? { file_path: path } : { path }),
      },
    };
  }

  readonly canUseTool: CanUseTool = async (tool, input) => {
    try {
      return {
        behavior: "allow",
        updatedInput: (await this.authorize(tool, input)).input,
      };
    } catch (error) {
      return {
        behavior: "deny",
        message:
          error instanceof Error
            ? error.message
            : "Workspace permission denied.",
      };
    }
  };

  private async before(input: HookInput) {
    if (input.hook_event_name !== "PreToolUse")
      throw new Error("Unexpected hook event.");
    const { path, input: toolInput } = await this.authorize(
      input.tool_name,
      input.tool_input,
    );
    if (input.tool_name === "Read" && path)
      this.reading.set(input.tool_use_id, {
        path,
        hash: hash(await readFile(path, "utf8")),
      });
    if (NATIVE_WRITE_TOOLS.includes(input.tool_name as never)) {
      if (!path || !this.options.snapshots)
        throw new Error("Write tracking is unavailable.");
      if (this.busyPaths.has(path))
        throw new Error("Wait for the pending edit to this file.");
      this.busyPaths.add(path);
      try {
        let before: string | null = null;
        try {
          before = await readFile(path, "utf8");
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ))
            throw error;
        }
        if (before !== null && this.reads.get(path) !== hash(before))
          throw new Error(
            "Read the current file before editing it; the baseline is missing or changed.",
          );
        let content: string;
        if (input.tool_name === "Write") {
          if (typeof toolInput.content !== "string")
            throw new Error("Invalid Write content.");
          content = toolInput.content;
        } else {
          if (
            before === null ||
            typeof toolInput.old_string !== "string" ||
            !toolInput.old_string ||
            typeof toolInput.new_string !== "string"
          )
            throw new Error("Invalid Edit baseline.");
          const parts = before.split(toolInput.old_string);
          if (
            parts.length < 2 ||
            (parts.length !== 2 && toolInput.replace_all !== true)
          )
            throw new Error("The Edit source must match exactly.");
          content =
            toolInput.replace_all === true
              ? parts.join(toolInput.new_string)
              : before.replace(
                  toolInput.old_string,
                  () => toolInput.new_string as string,
                );
        }
        if (
          /^\.claude\/skills\//u.test(
            relative(this.options.projectRoot, path)
              .split(sep)
              .join("/")
              .toLowerCase(),
          ) &&
          (/^\s*hooks\s*:/mu.test(content) || /!`/u.test(content))
        )
          throw new Error(
            "Executable Skill hooks and substitutions are disabled.",
          );
        if (
          relative(this.options.projectRoot, path).split(sep).join("/") ===
          CREATIVE_ASSET_PATH
        )
          validateAssetEdit(before, content);
        const mutationId = await this.options.snapshots.prepareNativeMutation(
          this.options.capability.projectId,
          this.options.capability.taskId,
          relative(this.options.projectRoot, path).split(sep).join("/"),
          content,
          before === null ? null : hash(before),
        );
        this.pending.set(input.tool_use_id, { path, mutationId, content });
      } catch (error) {
        this.busyPaths.delete(path);
        throw error;
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "allow" as const,
        updatedInput: toolInput,
      },
    };
  }

  private async after(input: HookInput) {
    if (
      input.hook_event_name !== "PostToolUse" &&
      input.hook_event_name !== "PostToolUseFailure"
    )
      return {};
    const pending = this.pending.get(input.tool_use_id);
    if (pending) {
      try {
        await this.options.snapshots!.completeNativeMutation(
          this.options.capability.projectId,
          this.options.capability.taskId,
          pending.mutationId,
        );
        this.reads.set(pending.path, hash(pending.content));
        await this.options.onFilesChanged?.();
      } finally {
        this.pending.delete(input.tool_use_id);
        this.busyPaths.delete(pending.path);
      }
    } else if (
      input.hook_event_name === "PostToolUse" &&
      input.tool_name === "Read"
    ) {
      const reading = this.reading.get(input.tool_use_id);
      this.reading.delete(input.tool_use_id);
      if (
        reading &&
        reading.hash === hash(await readFile(reading.path, "utf8"))
      )
        this.reads.set(reading.path, reading.hash);
    }
    return {};
  }

  private hook(operation: (input: HookInput) => Promise<object>): HookCallback {
    return async (input, _id, options) => {
      if (options.signal.aborted)
        return { continue: false, stopReason: "Workspace task was cancelled." };
      const pending = operation(input);
      this.operations.add(pending);
      try {
        return await pending;
      } catch {
        return {
          ...(input.hook_event_name === "PreToolUse"
            ? {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason:
                    "The operation violates the workspace policy or needs a fresh file read.",
                },
              }
            : {
                continue: false,
                stopReason: "Workspace mutation verification failed.",
              }),
        };
      } finally {
        this.operations.delete(pending);
      }
    };
  }

  hooks(): NonNullable<Options["hooks"]> {
    return {
      PreToolUse: [
        { hooks: [this.hook((input) => this.before(input))], timeout: 15 },
      ],
      PostToolUse: [
        { hooks: [this.hook((input) => this.after(input))], timeout: 15 },
      ],
      PostToolUseFailure: [
        { hooks: [this.hook((input) => this.after(input))], timeout: 15 },
      ],
    };
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.operations]);
    for (const item of this.pending.values())
      await this.options.snapshots?.completeNativeMutation(
        this.options.capability.projectId,
        this.options.capability.taskId,
        item.mutationId,
      );
    this.pending.clear();
    this.busyPaths.clear();
  }
}
