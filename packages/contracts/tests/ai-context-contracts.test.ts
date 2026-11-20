import { describe, expect, it } from "vitest";

import {
  AiAssembledContextSchema,
  AiContextAssemblyRequestSchema,
} from "../src/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";

const permissions = {
  readCurrentDocument: true,
  readProjectStructure: true,
  retrieveKnowledge: true,
  proposeChanges: false,
} as const;

describe("AI context contracts", () => {
  it("validates an editor context request without accepting project escapes", () => {
    expect(
      AiContextAssemblyRequestSchema.parse({
        projectId,
        currentDocument: {
          relativePath: "第一卷/第一章/01-正文.md",
          content: "# 第一章\n\n雨夜。",
          selection: { startLine: 3, endLine: 3 },
        },
        instruction: "  续写这一幕  ",
        permissions,
      }),
    ).toMatchObject({
      instruction: "续写这一幕",
      retrievalLimit: 5,
    });
    expect(
      AiContextAssemblyRequestSchema.safeParse({
        projectId,
        currentDocument: {
          relativePath: "../秘密.md",
          content: "secret",
        },
        instruction: "读取",
        permissions,
      }).success,
    ).toBe(false);
  });

  it("locks provider context sections into the required assembly order", () => {
    const sections = [
      {
        kind: "current",
        contextKind: "document",
        relativePath: "第一卷/第一章/01-正文.md",
        baselineHash: "a".repeat(64),
        startLine: 1,
        endLine: 1,
        text: "雨夜。",
      },
      {
        kind: "structure",
        path: [
          {
            kind: "document",
            name: "01-正文",
            relativePath: "第一卷/第一章/01-正文.md",
          },
        ],
      },
      {
        kind: "knowledge",
        scope: "current_document",
        status: "not_initialized",
        indexVersion: null,
        hits: [],
        degradationReason: "index_not_ready",
      },
      {
        kind: "request",
        instruction: "续写",
        permissions,
      },
    ] as const;

    expect(
      AiAssembledContextSchema.safeParse({ projectId, sections }).success,
    ).toBe(true);
    expect(
      AiAssembledContextSchema.safeParse({
        projectId,
        sections: [sections[1], sections[0], sections[2], sections[3]],
      }).success,
    ).toBe(false);
  });
});
