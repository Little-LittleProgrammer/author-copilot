import { createHash } from "node:crypto";

import type { AiPatchProposal } from "@author-copilot/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  AiPatchValidationError,
  AiPatchValidator,
} from "../src/main/ai/patch-validator.js";
import { InvalidProjectPathError } from "../src/main/project/errors.js";
import type { ProjectService } from "../src/main/project/project-service.js";

const projectId = "10000000-0000-4000-8000-000000000001";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function proposal(
  content: string,
  overrides: Partial<AiPatchProposal["files"][number]> = {},
): AiPatchProposal {
  return {
    summary: "收紧开场节奏",
    files: [
      {
        relativePath: "第一卷/第一章/正文.md",
        baselineHash: hash(content),
        edits: [
          {
            changeId: "ending",
            startOffset: 4,
            endOffset: 6,
            expectedText: "开门",
            replacementText: "推门而入",
          },
          {
            changeId: "opening",
            startOffset: 0,
            endOffset: 2,
            expectedText: "雨夜",
            replacementText: "暴雨之夜",
          },
        ],
        ...overrides,
      },
    ],
  };
}

function validator(
  content = "雨夜，她开门。",
  options: {
    readonly maxFileBytes?: number;
    readonly maxProposalBytes?: number;
  } = {},
): {
  readonly service: AiPatchValidator;
  readonly readDocument: ReturnType<typeof vi.fn>;
} {
  const readDocument = vi.fn().mockResolvedValue({
    content,
    hash: hash(content),
    mtimeMs: 1,
    mode: 0o600,
  });
  return {
    service: new AiPatchValidator({
      projectService: {
        readDocument,
      } as unknown as Pick<ProjectService, "readDocument">,
      ...options,
    }),
    readDocument,
  };
}

describe("AI patch validator", () => {
  it("validates, sorts, and applies edits without writing documents", async () => {
    const content = "雨夜，她开门。";
    const { service, readDocument } = validator(content);

    await expect(
      service.validate(projectId, proposal(content)),
    ).resolves.toEqual({
      summary: "收紧开场节奏",
      files: [
        {
          relativePath: "第一卷/第一章/正文.md",
          baselineHash: hash(content),
          edits: [
            {
              changeId: "opening",
              startOffset: 0,
              endOffset: 2,
              expectedText: "雨夜",
              replacementText: "暴雨之夜",
            },
            {
              changeId: "ending",
              startOffset: 4,
              endOffset: 6,
              expectedText: "开门",
              replacementText: "推门而入",
            },
          ],
          originalContent: content,
          proposedContent: "暴雨之夜，她推门而入。",
          proposedHash: hash("暴雨之夜，她推门而入。"),
        },
      ],
    });
    expect(readDocument).toHaveBeenCalledWith(
      projectId,
      "第一卷/第一章/正文.md",
    );
  });

  it("rejects stale baselines before applying edits", async () => {
    const content = "雨夜，她开门。";
    const { service } = validator(content);

    await expect(
      service.validate(
        projectId,
        proposal(content, { baselineHash: "b".repeat(64) }),
      ),
    ).rejects.toMatchObject({ code: "baseline_mismatch" });
  });

  it.each([
    {
      name: "mismatched source text",
      edits: [
        {
          changeId: "mismatch",
          startOffset: 0,
          endOffset: 2,
          expectedText: "晴天",
          replacementText: "雨夜",
        },
      ],
      code: "source_mismatch",
    },
    {
      name: "overlapping ranges",
      edits: [
        {
          changeId: "first",
          startOffset: 0,
          endOffset: 2,
          expectedText: "雨夜",
          replacementText: "夜雨",
        },
        {
          changeId: "second",
          startOffset: 1,
          endOffset: 3,
          expectedText: "夜，",
          replacementText: "，夜",
        },
      ],
      code: "overlapping_edits",
    },
    {
      name: "no-op replacements",
      edits: [
        {
          changeId: "noop",
          startOffset: 0,
          endOffset: 2,
          expectedText: "雨夜",
          replacementText: "雨夜",
        },
      ],
      code: "no_change",
    },
  ])("rejects $name", async ({ edits, code }) => {
    const content = "雨夜，她开门。";
    const { service } = validator(content);
    await expect(
      service.validate(projectId, proposal(content, { edits })),
    ).rejects.toMatchObject({ code });
  });

  it("rejects duplicate paths and duplicate change IDs", async () => {
    const content = "雨夜，她开门。";
    const { service } = validator(content);
    const input = proposal(content);
    input.files.push({
      ...input.files[0]!,
      relativePath: "第一卷\\第一章\\正文.md",
    });
    await expect(service.validate(projectId, input)).rejects.toMatchObject({
      code: "duplicate_path",
    });

    const duplicateIds = proposal(content, {
      edits: [
        {
          changeId: "same",
          startOffset: 0,
          endOffset: 2,
          expectedText: "雨夜",
          replacementText: "夜雨",
        },
        {
          changeId: "same",
          startOffset: 4,
          endOffset: 6,
          expectedText: "开门",
          replacementText: "推门",
        },
      ],
    });
    await expect(
      service.validate(projectId, duplicateIds),
    ).rejects.toMatchObject({ code: "duplicate_change_id" });
  });

  it("rejects Unicode-splitting offsets and payload size overages", async () => {
    const content = "A😀B";
    const { service } = validator(content);
    await expect(
      service.validate(
        projectId,
        proposal(content, {
          edits: [
            {
              changeId: "split-surrogate",
              startOffset: 1,
              endOffset: 2,
              expectedText: content.slice(1, 2),
              replacementText: "x",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_range" });

    const limited = validator("abc", { maxFileBytes: 3 }).service;
    await expect(
      limited.validate(
        projectId,
        proposal("abc", {
          edits: [
            {
              changeId: "grow",
              startOffset: 0,
              endOffset: 3,
              expectedText: "abc",
              replacementText: "abcd",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "size_limit" });
  });

  it("enforces aggregate input and proposed-document budgets", async () => {
    const content = "a".repeat(60);
    const inputLimited = validator(content, { maxProposalBytes: 10 });
    await expect(
      inputLimited.service.validate(projectId, proposal(content)),
    ).rejects.toMatchObject({ code: "size_limit" });
    expect(inputLimited.readDocument).not.toHaveBeenCalled();

    const outputLimited = validator(content, {
      maxFileBytes: 100,
      maxProposalBytes: 100,
    });
    const edit = {
      changeId: "change-a",
      startOffset: 0,
      endOffset: 1,
      expectedText: "a",
      replacementText: "b",
    };
    await expect(
      outputLimited.service.validate(projectId, {
        summary: "edit",
        files: [
          {
            relativePath: "a.md",
            baselineHash: hash(content),
            edits: [edit],
          },
          {
            relativePath: "b.md",
            baselineHash: hash(content),
            edits: [{ ...edit, changeId: "change-b" }],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "size_limit", relativePath: "b.md" });
    expect(outputLimited.readDocument).toHaveBeenCalledTimes(2);
  });

  it("propagates project path authorization failures", async () => {
    const readDocument = vi
      .fn()
      .mockRejectedValue(new InvalidProjectPathError("outside project"));
    const service = new AiPatchValidator({
      projectService: {
        readDocument,
      } as unknown as Pick<ProjectService, "readDocument">,
    });
    const input = proposal("雨夜，她开门。");

    await expect(service.validate(projectId, input)).rejects.toBeInstanceOf(
      InvalidProjectPathError,
    );
    expect(readDocument).toHaveBeenCalledOnce();
  });

  it("exposes typed validation errors without document contents", () => {
    const error = new AiPatchValidationError(
      "source_mismatch",
      "source mismatch",
      "正文.md",
      "change-1",
    );
    expect(error).toMatchObject({
      code: "source_mismatch",
      relativePath: "正文.md",
      changeId: "change-1",
    });
    expect(error).not.toHaveProperty("content");
  });
});
