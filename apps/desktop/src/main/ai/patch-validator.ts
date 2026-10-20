import { createHash } from "node:crypto";

import type {
  AiPatchEdit,
  AiPatchFile,
  AiPatchProposal,
} from "@author-copilot/contracts";
import { AiPatchProposalSchema } from "@author-copilot/contracts";

import type { ProjectService } from "../project/project-service.js";

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_PROPOSAL_BYTES = 5 * 1024 * 1024;

export type AiPatchValidationErrorCode =
  | "baseline_mismatch"
  | "duplicate_change_id"
  | "duplicate_path"
  | "invalid_range"
  | "no_change"
  | "overlapping_edits"
  | "size_limit"
  | "source_mismatch";

export class AiPatchValidationError extends Error {
  constructor(
    readonly code: AiPatchValidationErrorCode,
    message: string,
    readonly relativePath?: string,
    readonly changeId?: string,
  ) {
    super(message);
    this.name = "AiPatchValidationError";
  }
}

export interface ValidatedAiPatchFile extends Omit<AiPatchFile, "edits"> {
  readonly edits: readonly AiPatchEdit[];
  readonly originalContent: string;
  readonly proposedContent: string;
  readonly proposedHash: string;
}

export interface ValidatedAiPatchProposal {
  readonly summary: string;
  readonly files: readonly ValidatedAiPatchFile[];
}

export interface AiPatchValidatorOptions {
  readonly projectService: Pick<ProjectService, "readDocument">;
  readonly maxFileBytes?: number;
  readonly maxProposalBytes?: number;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function portablePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

function isUnicodeBoundary(content: string, offset: number): boolean {
  if (offset === 0 || offset === content.length) return true;
  const previous = content.charCodeAt(offset - 1);
  const current = content.charCodeAt(offset);
  return !(
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  );
}

function sortedEdits(
  file: AiPatchFile,
  changeIds: Set<string>,
): readonly AiPatchEdit[] {
  for (const edit of file.edits) {
    if (changeIds.has(edit.changeId)) {
      throw new AiPatchValidationError(
        "duplicate_change_id",
        "Patch change IDs must be unique within a proposal.",
        file.relativePath,
        edit.changeId,
      );
    }
    changeIds.add(edit.changeId);
  }
  return [...file.edits].sort(
    (left, right) =>
      left.startOffset - right.startOffset || left.endOffset - right.endOffset,
  );
}

function applyValidatedEdits(
  content: string,
  file: AiPatchFile,
  edits: readonly AiPatchEdit[],
): string {
  let previous: AiPatchEdit | undefined;
  for (const edit of edits) {
    if (
      edit.endOffset > content.length ||
      !isUnicodeBoundary(content, edit.startOffset) ||
      !isUnicodeBoundary(content, edit.endOffset)
    ) {
      throw new AiPatchValidationError(
        "invalid_range",
        "A patch edit is outside the document or splits a Unicode character.",
        file.relativePath,
        edit.changeId,
      );
    }
    if (
      previous !== undefined &&
      (edit.startOffset < previous.endOffset ||
        edit.startOffset === previous.startOffset)
    ) {
      throw new AiPatchValidationError(
        "overlapping_edits",
        "Patch edits must not overlap or share a start offset.",
        file.relativePath,
        edit.changeId,
      );
    }
    if (content.slice(edit.startOffset, edit.endOffset) !== edit.expectedText) {
      throw new AiPatchValidationError(
        "source_mismatch",
        "A patch edit does not match the expected source text.",
        file.relativePath,
        edit.changeId,
      );
    }
    if (edit.expectedText === edit.replacementText) {
      throw new AiPatchValidationError(
        "no_change",
        "A patch edit must change the document.",
        file.relativePath,
        edit.changeId,
      );
    }
    previous = edit;
  }

  let proposed = content;
  for (const edit of [...edits].reverse()) {
    proposed =
      proposed.slice(0, edit.startOffset) +
      edit.replacementText +
      proposed.slice(edit.endOffset);
  }
  return proposed;
}

export class AiPatchValidator {
  private readonly maxFileBytes: number;
  private readonly maxProposalBytes: number;

  constructor(private readonly options: AiPatchValidatorOptions) {
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxProposalBytes =
      options.maxProposalBytes ?? DEFAULT_MAX_PROPOSAL_BYTES;
  }

  async validate(
    projectId: string,
    input: unknown,
  ): Promise<ValidatedAiPatchProposal> {
    const proposal = AiPatchProposalSchema.parse(input);
    this.assertInputBudget(proposal);

    const paths = new Set<string>();
    const changeIds = new Set<string>();
    const files: ValidatedAiPatchFile[] = [];
    let proposedBytes = 0;

    for (const file of proposal.files) {
      const relativePath = portablePath(file.relativePath);
      const pathKey = relativePath.toLocaleLowerCase("en-US");
      if (paths.has(pathKey)) {
        throw new AiPatchValidationError(
          "duplicate_path",
          "A proposal may patch each document only once.",
          relativePath,
        );
      }
      paths.add(pathKey);

      const current = await this.options.projectService.readDocument(
        projectId,
        relativePath,
      );
      if (current.hash !== file.baselineHash) {
        throw new AiPatchValidationError(
          "baseline_mismatch",
          "The document changed after the patch baseline was created.",
          relativePath,
        );
      }

      const edits = sortedEdits(file, changeIds);
      const proposedContent = applyValidatedEdits(current.content, file, edits);
      const fileBytes = Buffer.byteLength(proposedContent);
      if (fileBytes > this.maxFileBytes) {
        throw new AiPatchValidationError(
          "size_limit",
          "The proposed document exceeds the file size limit.",
          relativePath,
        );
      }
      proposedBytes += fileBytes;
      if (proposedBytes > this.maxProposalBytes) {
        throw new AiPatchValidationError(
          "size_limit",
          "The proposed documents exceed the proposal size limit.",
          relativePath,
        );
      }

      files.push({
        relativePath,
        baselineHash: file.baselineHash,
        edits,
        originalContent: current.content,
        proposedContent,
        proposedHash: sha256(proposedContent),
      });
    }

    return { summary: proposal.summary, files };
  }

  private assertInputBudget(proposal: AiPatchProposal): void {
    let bytes = Buffer.byteLength(proposal.summary);
    for (const file of proposal.files) {
      bytes += Buffer.byteLength(file.relativePath);
      for (const edit of file.edits) {
        bytes += Buffer.byteLength(edit.expectedText);
        bytes += Buffer.byteLength(edit.replacementText);
        if (bytes > this.maxProposalBytes) {
          throw new AiPatchValidationError(
            "size_limit",
            "The patch payload exceeds the proposal size limit.",
            file.relativePath,
            edit.changeId,
          );
        }
      }
    }
  }
}
