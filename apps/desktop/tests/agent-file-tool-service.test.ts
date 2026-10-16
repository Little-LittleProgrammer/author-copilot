import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AgentCapabilityService,
  AgentFileToolService,
  AGENT_MCP_SERVER_NAME,
  createAgentMcpServer,
  createAgentToolDefinitions,
} from "../src/main/ai/agent/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";
const relativePath = "第一卷/第一章/正文.md";
const content = "雨夜。\n她推开门。\n";
const hash = createHash("sha256").update(content).digest("hex");
const context = { projectId, taskId };
const allTools = [
  "mcp__author_copilot__read_text",
  "mcp__author_copilot__write_text",
  "mcp__author_copilot__edit_text",
  "mcp__author_copilot__glob",
  "mcp__author_copilot__grep",
] as const;

function fixture(
  allowedTools: readonly (typeof allTools)[number][] = allTools,
) {
  const capabilityService = new AgentCapabilityService({});
  const capability = capabilityService.grant(
    {
      projectId,
      readableFileTypes: ["markdown"],
      writableFileTypes: ["markdown"],
      allowedTools,
      timeoutMs: 60_000,
    },
    taskId,
  );
  const readDocument = vi.fn(async () => ({
    content,
    hash,
    mode: 0o644,
    mtimeMs: 1,
  }));
  const getStructure = vi.fn(async () => ({
    projectId,
    template: "novel" as const,
    nodes: [
      {
        kind: "volume" as const,
        name: "第一卷",
        relativePath: "第一卷",
        children: [
          {
            kind: "chapter" as const,
            name: "第一章",
            relativePath: "第一卷/第一章",
            children: [
              {
                kind: "document" as const,
                name: "正文",
                relativePath,
              },
            ],
          },
        ],
      },
    ],
    unclassified: [
      {
        kind: "document" as const,
        name: "设定",
        relativePath: "设定.md",
      },
      {
        kind: "document" as const,
        name: "隐藏",
        relativePath: ".private/隐藏.md",
      },
    ],
  }));
  const writeTaskFile = vi.fn(async () => undefined);
  return {
    capabilityService,
    readDocument,
    getStructure,
    writeTaskFile,
    service: new AgentFileToolService({
      capabilityService,
      projectService: { readDocument, getStructure },
      taskSnapshotService: { writeTaskFile },
    }),
    capability,
  };
}

describe("AgentFileToolService", () => {
  it("revokes an edit waiting for its baseline and drains it before completion", async () => {
    const fx = fixture();
    let resolveRead!: (
      value: Awaited<ReturnType<typeof fx.readDocument>>,
    ) => void;
    const read = {
      promise: new Promise<Awaited<ReturnType<typeof fx.readDocument>>>(
        (resolve) => {
          resolveRead = resolve;
        },
      ),
    };
    fx.readDocument.mockReturnValueOnce(read.promise);
    const pending = fx.service.editText(context, {
      relativePath,
      expectedHash: hash,
      startOffset: 0,
      endOffset: 2,
      expectedText: "雨夜",
      replacementText: "清晨",
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: "task_not_found",
    });
    fx.capabilityService.revoke(taskId);
    let drained = false;
    const draining = fx.service.drain(taskId).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    resolveRead({ content, hash, mode: 0o644, mtimeMs: 1 });
    await rejected;
    await draining;
    expect(fx.writeTaskFile).not.toHaveBeenCalled();
    expect(drained).toBe(true);
  });

  it("reads, globs, and greps only project Markdown documents", async () => {
    const fx = fixture();

    await expect(fx.service.readText(context, relativePath)).resolves.toEqual({
      relativePath,
      content,
      hash,
    });
    await expect(fx.service.glob(context, "**/*.md")).resolves.toEqual([
      relativePath,
    ]);
    await expect(
      fx.service.grep(context, { query: "推开", limit: 5 }),
    ).resolves.toEqual([
      { relativePath, line: 2, text: "她推开门。" },
      { relativePath: "设定.md", line: 2, text: "她推开门。" },
    ]);
  });

  it("passes optimistic hashes through ledger-backed writes and edits", async () => {
    const fx = fixture();

    await fx.service.writeText(context, {
      relativePath: "第一卷/新章.md",
      content: "新章\n",
      expectedHash: null,
    });
    expect(fx.writeTaskFile).toHaveBeenCalledWith(
      projectId,
      taskId,
      "第一卷/新章.md",
      "新章\n",
      null,
      expect.any(Function),
    );

    await fx.service.editText(context, {
      relativePath,
      expectedHash: hash,
      startOffset: 4,
      endOffset: 8,
      expectedText: "她推开门",
      replacementText: "她轻叩门",
    });
    expect(fx.writeTaskFile).toHaveBeenLastCalledWith(
      projectId,
      taskId,
      relativePath,
      "雨夜。\n她轻叩门。\n",
      hash,
      expect.any(Function),
    );
  });

  it("rejects hidden paths, traversal patterns, and ungranted write tools", async () => {
    const readOnly = fixture([
      "mcp__author_copilot__read_text",
      "mcp__author_copilot__glob",
      "mcp__author_copilot__grep",
    ]);

    await expect(
      readOnly.service.readText(context, ".claude/instructions.md"),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(readOnly.service.glob(context, "../**/*.md")).rejects.toThrow(
      "glob pattern",
    );
    await expect(
      readOnly.service.writeText(context, {
        relativePath,
        content: "overwrite",
        expectedHash: hash,
      }),
    ).rejects.toMatchObject({ code: "tool_not_authorized" });
    expect(readOnly.writeTaskFile).not.toHaveBeenCalled();
  });

  it("binds SDK tool handlers to task context and redacts failures", async () => {
    const fx = fixture();
    fx.readDocument.mockRejectedValueOnce(
      new Error("sensitive /absolute/project/path"),
    );
    const definition = createAgentToolDefinitions(context, fx.service).find(
      (candidate) => candidate.name === "read_text",
    );

    const result = await definition?.handler({ relativePath }, {});

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).not.toContain("/absolute/project/path");
  });

  it("creates only the application-owned in-process MCP server", () => {
    const fx = fixture();
    const server = createAgentMcpServer({
      capability: fx.capability,
      fileTools: fx.service,
    });

    expect(server).toMatchObject({
      type: "sdk",
      name: AGENT_MCP_SERVER_NAME,
    });
    expect(server.instance).toBeDefined();
  });
});
