import { describe, expect, it } from "vitest";

import {
  ContentHashSchema,
  DocumentReadResponseSchema,
  DocumentSaveRequestSchema,
  IPC_INVOKE_CONTRACTS,
  IPC_INVOKE_CHANNELS,
  ProjectConfirmImportRequestSchema,
  ProjectCreateRequestSchema,
  ProjectDeleteEntryRequestSchema,
  ProjectImportPreviewResponseSchema,
  ProjectOperationErrorCodeSchema,
  ProjectOperationErrorSchema,
  ProjectRenameEntryRequestSchema,
  ProjectStructureNodeSchema,
  ProjectUpdateRequestSchema,
  RelativeProjectPathSchema,
} from "../src/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);

describe("project contracts", () => {
  it("keeps project templates local to the shared contract", () => {
    expect(
      ProjectCreateRequestSchema.parse({
        title: "长夜之后",
        template: "novel",
      }),
    ).toEqual({ title: "长夜之后", template: "novel" });
    expect(
      ProjectCreateRequestSchema.safeParse({
        title: "A screenplay",
        template: "screenplay",
        directory: "/Users/example/work",
      }).success,
    ).toBe(false);
  });

  it("exposes only a source display name in import previews", () => {
    const preview = {
      ok: true,
      previewToken: "preview-token",
      sourceRoot: { displayName: "旧作" },
      template: "novel",
      recognizedTree: [
        {
          role: "volume",
          displayName: "第一卷",
          relativePath: "第一卷",
          children: [
            {
              role: "chapter",
              displayName: "第一章",
              relativePath: "第一卷/第一章",
              children: [],
            },
          ],
        },
      ],
      unclassifiedFiles: [
        { displayName: "随笔.md", relativePath: "资料/随笔.md" },
      ],
    };

    expect(ProjectImportPreviewResponseSchema.parse(preview)).toEqual(preview);
    expect(
      ProjectImportPreviewResponseSchema.safeParse({
        ...preview,
        sourceRoot: {
          displayName: "旧作",
          absolutePath: "/Users/example/旧作",
        },
      }).success,
    ).toBe(false);
  });

  it("keeps native destination selection in the main process", () => {
    expect(
      ProjectConfirmImportRequestSchema.safeParse({
        previewToken: "preview-token",
        mode: "in_place",
        reassignProjectId: true,
      }).success,
    ).toBe(true);
    expect(
      ProjectConfirmImportRequestSchema.safeParse({
        previewToken: "preview-token",
        mode: "copy",
      }).success,
    ).toBe(true);
    expect(
      ProjectConfirmImportRequestSchema.safeParse({
        previewToken: "preview-token",
        mode: "copy",
        reassignProjectId: true,
      }).success,
    ).toBe(false);
    expect(
      ProjectConfirmImportRequestSchema.safeParse({
        previewToken: "preview-token",
        mode: "copy",
        destinationToken: "not-allowed",
      }).success,
    ).toBe(false);
    expect(
      ProjectConfirmImportRequestSchema.safeParse({
        previewToken: "preview-token",
        mode: "in_place",
        destinationToken: "not-allowed",
      }).success,
    ).toBe(false);
  });

  it("rejects absolute and escaping document paths", () => {
    expect(RelativeProjectPathSchema.parse("第一卷/第一章/01-正文.md")).toBe(
      "第一卷/第一章/01-正文.md",
    );
    for (const path of [
      "/etc/passwd",
      "C:\\Users\\example\\secret.md",
      "第一卷/../secret.md",
      "第一卷//正文.md",
    ]) {
      expect(RelativeProjectPathSchema.safeParse(path).success).toBe(false);
    }
  });

  it("validates recursive structure nodes strictly", () => {
    const node = {
      kind: "directory",
      role: "chapter",
      displayName: "第一章",
      relativePath: "第一卷/第一章",
      children: [
        {
          kind: "document",
          role: "scene",
          displayName: "01-正文.md",
          relativePath: "第一卷/第一章/01-正文.md",
          children: [],
        },
      ],
    };

    expect(ProjectStructureNodeSchema.parse(node)).toEqual(node);
    expect(
      ProjectStructureNodeSchema.safeParse({ ...node, absolutePath: "/tmp/a" })
        .success,
    ).toBe(false);
  });

  it("requires optimistic save hashes and returns fresh file metadata", () => {
    expect(ContentHashSchema.parse(hash)).toBe(hash);
    expect(
      DocumentSaveRequestSchema.parse({
        projectId,
        relativePath: "第一幕/01-开场.md",
        expectedHash: hash,
        content: "# 开场\n",
      }),
    ).toEqual({
      projectId,
      relativePath: "第一幕/01-开场.md",
      expectedHash: hash,
      content: "# 开场\n",
    });
    expect(
      DocumentReadResponseSchema.safeParse({
        ok: true,
        relativePath: "第一幕/01-开场.md",
        content: "# 开场\n",
        contentHash: hash,
        mtimeMs: 1_720_000_000_000,
        absolutePath: "/tmp/第一幕/01-开场.md",
      }).success,
    ).toBe(false);
  });

  it("validates project and structure rename mutations", () => {
    expect(
      ProjectUpdateRequestSchema.parse({ projectId, title: "长夜新编" }),
    ).toEqual({ projectId, title: "长夜新编" });
    expect(
      ProjectRenameEntryRequestSchema.parse({
        projectId,
        relativePath: "第一卷/第一章",
        name: "雨夜",
      }),
    ).toEqual({
      projectId,
      relativePath: "第一卷/第一章",
      name: "雨夜",
    });
    expect(
      ProjectRenameEntryRequestSchema.safeParse({
        projectId,
        relativePath: "../第一章",
        name: "雨夜",
      }).success,
    ).toBe(false);
    expect(
      ProjectDeleteEntryRequestSchema.parse({
        projectId,
        relativePath: "第一卷/第一章",
      }),
    ).toEqual({ projectId, relativePath: "第一卷/第一章" });
  });

  it("defines the complete structured project error vocabulary", () => {
    expect(ProjectOperationErrorCodeSchema.options).toEqual([
      "cancelled",
      "not_found",
      "conflict",
      "duplicate_project_id",
      "invalid_path",
      "io_error",
      "invalid_metadata",
    ]);
    expect(
      ProjectOperationErrorSchema.parse({
        code: "conflict",
        message: "The document changed on disk.",
        retryable: true,
      }),
    ).toEqual({
      code: "conflict",
      message: "The document changed on disk.",
      retryable: true,
    });
    expect(
      DocumentReadResponseSchema.parse({
        ok: false,
        error: {
          code: "not_found",
          message: "Document not found.",
          retryable: false,
          details: { relativePath: "missing.md" },
        },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "not_found",
        message: "Document not found.",
        retryable: false,
        details: { relativePath: "missing.md" },
      },
    });
  });

  it("binds all M2 invoke channels to strict request and response schemas", () => {
    const createContract =
      IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.projectCreate];
    expect(
      createContract.request.safeParse({
        title: "长夜之后",
        template: "novel",
        unexpected: true,
      }).success,
    ).toBe(false);

    const readContract = IPC_INVOKE_CONTRACTS[IPC_INVOKE_CHANNELS.documentRead];
    expect(
      readContract.request.parse({
        projectId,
        relativePath: "第一卷/第一章/01-正文.md",
      }),
    ).toEqual({
      projectId,
      relativePath: "第一卷/第一章/01-正文.md",
    });
  });
});
