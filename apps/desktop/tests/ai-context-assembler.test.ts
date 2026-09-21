import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AiAssembledContextSchema,
  AiContextDocumentSchema,
  type AiContextAssemblyRequest,
  type KnowledgeIndexStatusResult,
} from "@author-copilot/contracts";

import { AiContextAssembler, AiPatchValidator } from "../src/main/ai/index.js";
import { providerMessages } from "../src/main/ai/prompt.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const relativePath = "第一卷/第一章/01-正文.md";
const permissions = {
  readCurrentDocument: true,
  readProjectStructure: true,
  retrieveKnowledge: true,
  proposeChanges: false,
} as const;

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const readyStatus: KnowledgeIndexStatusResult = {
  projectId,
  status: "ready",
  indexVersion: "index-v1",
  updatedAt: "2026-08-04T00:00:00.000Z",
  documentCount: 2,
  chunkCount: 4,
  activeTaskId: null,
  lastError: null,
};

const notReadyStatus: KnowledgeIndexStatusResult = {
  projectId,
  status: "not_initialized",
  indexVersion: null,
  updatedAt: null,
  documentCount: 0,
  chunkCount: 0,
  activeTaskId: null,
  lastError: null,
};

function request(
  overrides: Partial<AiContextAssemblyRequest> = {},
): AiContextAssemblyRequest {
  return {
    projectId,
    currentDocument: {
      relativePath,
      content: "# 第一章\n\n雨夜里，林舟回到车站。\n铜钥匙仍在长椅下。",
      selection: { startLine: 3, endLine: 4 },
    },
    instruction: "铜钥匙与车站有什么联系？",
    permissions,
    retrievalLimit: 5,
    ...overrides,
  };
}

function projectService(
  nodes: readonly unknown[] = [
    {
      kind: "volume",
      name: "第一卷",
      relativePath: "第一卷",
      children: [
        {
          kind: "chapter",
          name: "第一章",
          relativePath: "第一卷/第一章",
          children: [
            {
              kind: "document",
              name: "01-正文",
              relativePath,
            },
          ],
        },
      ],
    },
  ],
) {
  return {
    getStructure: vi.fn().mockResolvedValue({
      projectId,
      template: "novel",
      nodes,
      unclassified: [],
    }),
    readDocument: vi.fn().mockResolvedValue({
      content: "saved",
      hash: "a".repeat(64),
      mode: 0o600,
      mtimeMs: 1,
    }),
  };
}

describe("AiContextAssembler", () => {
  it("supplies complete baselines for selected and retrieved documents that validate as a multi-file proposal", async () => {
    const otherPath = "附加/第二章.md";
    const currentText = "雨夜正文";
    const otherText = "另一章\n雨夜回忆";
    const contents: Record<string, string> = {
      [relativePath]: currentText,
      [otherPath]: otherText,
    };
    const projects = projectService([
      { kind: "document", name: "当前章", relativePath },
      {
        kind: "chapter",
        name: "附加",
        relativePath: "附加",
        children: [
          { kind: "document", name: "第二章", relativePath: otherPath },
        ],
      },
    ]);
    projects.readDocument.mockImplementation(
      async (_id: string, path: string) => {
        const content = contents[path];
        if (content === undefined) throw new Error("missing fixture");
        return { content, hash: hash(content), mode: 0o600, mtimeMs: 1 };
      },
    );
    const assembler = new AiContextAssembler({
      projectService: projects,
      knowledgeService: {
        getStatus: vi.fn().mockResolvedValue(readyStatus),
        search: vi.fn().mockResolvedValue({
          status: readyStatus,
          hits: [
            {
              relativePath: otherPath,
              titleContext: [],
              startLine: 2,
              endLine: 2,
              score: 1,
              text: "雨夜回忆",
              indexVersion: "index-v1",
            },
          ],
        }),
      },
    });
    const context = await assembler.assemble(
      request({
        currentDocument: { relativePath, content: currentText },
        contextPaths: ["附加"],
        permissions: { ...permissions, proposeChanges: true },
      }),
    );
    const message = providerMessages(context, []).at(-1)?.content;
    expect(typeof message).toBe("string");
    if (typeof message !== "string")
      throw new Error("Expected serialized provider context");
    const serialized = message.slice(message.indexOf("\n") + 1);
    const providerContext = z
      .object({ documents: z.array(AiContextDocumentSchema) })
      .parse(JSON.parse(serialized));
    const other = providerContext.documents?.find(
      (doc) => doc.relativePath === otherPath,
    );
    expect(other).toEqual({
      relativePath: otherPath,
      text: otherText,
      baselineHash: hash(otherText),
    });
    const candidateDocuments = [
      {
        relativePath,
        text: context.sections[0].text,
        baselineHash: context.sections[0].baselineHash,
      },
      ...(providerContext.documents ?? []),
    ];
    const proposal = {
      summary: "两章修改",
      files: candidateDocuments.map((doc, i) => ({
        relativePath: doc.relativePath,
        baselineHash: doc.baselineHash,
        edits: [
          {
            changeId: `edit-${i}`,
            startOffset: doc.text.indexOf("雨夜"),
            endOffset: doc.text.indexOf("雨夜") + 2,
            expectedText: "雨夜",
            replacementText: "清晨",
          },
        ],
      })),
    };
    const validated = await new AiPatchValidator({
      projectService: projects,
    }).validate(projectId, proposal);
    expect(validated.files.map((file) => file.proposedContent)).toEqual([
      "清晨正文",
      "另一章\n清晨回忆",
    ]);
  });

  it("uses explicitly selected documents even without an initialized index", async () => {
    const projects = projectService([
      { kind: "document", name: "当前", relativePath },
      { kind: "document", name: "设定", relativePath: "设定.md" },
    ]);
    const assembler = new AiContextAssembler({
      projectService: projects,
      knowledgeService: {
        getStatus: vi.fn().mockResolvedValue(notReadyStatus),
        search: vi.fn(),
      },
    });
    const context = await assembler.assemble(
      request({ contextPaths: ["设定.md"] }),
    );
    expect(context.documents).toEqual([
      { relativePath: "设定.md", text: "saved", baselineHash: "a".repeat(64) },
    ]);
    await expect(
      assembler.assemble(request({ contextPaths: ["not-in-project.md"] })),
    ).rejects.toMatchObject({ code: "invalid_context_path" });
  });

  it("assembles selection, structure, sourced retrieval, and request in order", async () => {
    const projects = projectService();
    const knowledge = {
      getStatus: vi.fn().mockResolvedValue(readyStatus),
      search: vi.fn().mockResolvedValue({
        status: readyStatus,
        hits: [
          {
            relativePath: "第一卷/第二章/01-正文.md",
            titleContext: ["第二章", "旧车站"],
            startLine: 8,
            endLine: 9,
            score: 0.91,
            text: "父亲把铜钥匙留在了旧车站。",
            indexVersion: "index-v1",
          },
        ],
      }),
    };
    const assembler = new AiContextAssembler({
      projectService: projects,
      knowledgeService: knowledge,
    });

    const result = await assembler.assemble(request());

    expect(() => AiAssembledContextSchema.parse(result)).not.toThrow();
    expect(result.sections.map((section) => section.kind)).toEqual([
      "current",
      "structure",
      "knowledge",
      "request",
    ]);
    expect(result.sections[0]).toEqual({
      kind: "current",
      contextKind: "selection",
      relativePath,
      baselineHash: hash(request().currentDocument.content),
      startLine: 3,
      endLine: 4,
      text: "雨夜里，林舟回到车站。\n铜钥匙仍在长椅下。",
    });
    expect(result.sections[1].path.map((entry) => entry.name)).toEqual([
      "第一卷",
      "第一章",
      "01-正文",
    ]);
    expect(result.sections[2]).toMatchObject({
      scope: "full_book",
      status: "ready",
      indexVersion: "index-v1",
      degradationReason: null,
      hits: [
        expect.objectContaining({
          relativePath: "第一卷/第二章/01-正文.md",
          startLine: 8,
          endLine: 9,
        }),
      ],
    });
    expect(result.sections[3]).toEqual({
      kind: "request",
      instruction: "铜钥匙与车站有什么联系？",
      permissions,
    });
    expect(knowledge.search).toHaveBeenCalledWith(
      projectId,
      "铜钥匙与车站有什么联系？",
      5,
    );
  });

  it("degrades to the entire current document while the index is not ready", async () => {
    const knowledge = {
      getStatus: vi.fn().mockResolvedValue(notReadyStatus),
      search: vi.fn(),
    };
    const assembler = new AiContextAssembler({
      projectService: projectService(),
      knowledgeService: knowledge,
    });
    const currentDocument = {
      relativePath,
      content: "第一行\n第二行",
    };

    const result = await assembler.assemble(request({ currentDocument }));

    expect(result.sections[0]).toMatchObject({
      contextKind: "document",
      startLine: 1,
      endLine: 2,
      text: "第一行\n第二行",
    });
    expect(result.sections[2]).toEqual({
      kind: "knowledge",
      scope: "current_document",
      status: "not_initialized",
      indexVersion: null,
      hits: [],
      degradationReason: "index_not_ready",
    });
    expect(knowledge.search).not.toHaveBeenCalled();
  });

  it("does not retrieve full-book context without task permission", async () => {
    const knowledge = {
      getStatus: vi.fn().mockResolvedValue(readyStatus),
      search: vi.fn(),
    };
    const assembler = new AiContextAssembler({
      projectService: projectService(),
      knowledgeService: knowledge,
    });

    const result = await assembler.assemble(
      request({
        permissions: { ...permissions, retrieveKnowledge: false },
      }),
    );

    expect(result.sections[2]).toMatchObject({
      scope: "current_document",
      indexVersion: null,
      hits: [],
      degradationReason: "permission_denied",
    });
    expect(knowledge.search).not.toHaveBeenCalled();
  });

  it("contains retrieval failures and reports a stale current-document scope", async () => {
    const staleStatus: KnowledgeIndexStatusResult = {
      ...readyStatus,
      status: "stale",
      lastError: "Source changed.",
    };
    const knowledge = {
      getStatus: vi
        .fn()
        .mockResolvedValueOnce(readyStatus)
        .mockResolvedValueOnce(staleStatus),
      search: vi.fn().mockRejectedValue(new Error("index changed")),
    };
    const assembler = new AiContextAssembler({
      projectService: projectService(),
      knowledgeService: knowledge,
    });

    const result = await assembler.assemble(request());

    expect(result.sections[2]).toEqual({
      kind: "knowledge",
      scope: "current_document",
      status: "stale",
      indexVersion: null,
      hits: [],
      degradationReason: "retrieval_failed",
    });
  });

  it("rejects selections outside the editor content", async () => {
    const getStatus = vi.fn().mockResolvedValue(notReadyStatus);
    const assembler = new AiContextAssembler({
      projectService: projectService(),
      knowledgeService: {
        getStatus,
        search: vi.fn(),
      },
    });

    await expect(
      assembler.assemble(
        request({
          currentDocument: {
            relativePath,
            content: "只有一行",
            selection: { startLine: 1, endLine: 2 },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "invalid_selection",
    });
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("rejects a current document missing from the project structure", async () => {
    const assembler = new AiContextAssembler({
      projectService: projectService([]),
      knowledgeService: {
        getStatus: vi.fn().mockResolvedValue(notReadyStatus),
        search: vi.fn(),
      },
    });

    await expect(assembler.assemble(request())).rejects.toMatchObject({
      code: "current_document_not_found",
    });
  });
});
import { createHash } from "node:crypto";
