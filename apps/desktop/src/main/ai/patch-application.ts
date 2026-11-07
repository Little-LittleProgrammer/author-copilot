import { randomUUID } from "node:crypto";

import {
  AiPatchApplyRequestSchema,
  AiPatchApplyResponseSchema,
  type AiPatchApplyRequest,
  type AiPatchApplyResponse,
  type AiPatchReview,
  type AppError,
} from "@author-copilot/contracts";

import { GitServiceError, type GitService } from "../git/index.js";
import {
  DocumentConflictError,
  InvalidProjectPathError,
  ProjectNotFoundError,
  SymbolicLinkNotAllowedError,
  type ProjectService,
} from "../project/index.js";
import type {
  ValidatedAiPatchFile,
  ValidatedAiPatchProposal,
} from "./patch-validator.js";
import { createAiPatchReview } from "./patch-review.js";

interface StoredProposal {
  readonly projectId: string;
  readonly proposal: ValidatedAiPatchProposal;
  readonly expiresAt: number;
}

export interface AiPatchApplicationOptions {
  readonly projectService: Pick<ProjectService, "applyDocumentBatch">;
  readonly gitService: Pick<
    GitService,
    "createVersionForPathsWhileProjectLocked"
  >;
  readonly createId?: () => string;
  readonly now?: () => number;
  readonly proposalTtlMs?: number;
  readonly maxProposals?: number;
}

const DEFAULT_PROPOSAL_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_PROPOSALS = 100;

function selectedContent(
  file: ValidatedAiPatchFile,
  acceptedChangeIds: ReadonlySet<string>,
): string | undefined {
  const accepted = file.edits.filter((edit) =>
    acceptedChangeIds.has(edit.changeId),
  );
  if (accepted.length === 0) return undefined;
  let content = file.originalContent;
  for (const edit of [...accepted].reverse()) {
    content =
      content.slice(0, edit.startOffset) +
      edit.replacementText +
      content.slice(edit.endOffset);
  }
  return content;
}

function versionMessage(summary: string): string {
  const normalized = summary.replace(/[\r\n]+/gu, " ").trim();
  return `AI: ${normalized}`.slice(0, 200);
}

function failed(error: AppError): AiPatchApplyResponse {
  return AiPatchApplyResponseSchema.parse({ ok: false, error });
}

function applicationError(error: unknown): AppError {
  if (error instanceof DocumentConflictError) {
    return {
      code: "CONFLICT",
      message:
        "A proposed document changed after review. Reload before applying the proposal.",
      retryable: true,
    };
  }
  if (error instanceof ProjectNotFoundError) {
    return {
      code: "NOT_FOUND",
      message: "The project was not found.",
      retryable: false,
    };
  }
  if (
    error instanceof InvalidProjectPathError ||
    error instanceof SymbolicLinkNotAllowedError
  ) {
    return {
      code: "PATH_NOT_AUTHORIZED",
      message: "A proposed document path is no longer authorized.",
      retryable: false,
    };
  }
  return {
    code: "IO_FAILED",
    message: "The accepted proposal could not be written atomically.",
    retryable: true,
  };
}

function gitError(error: unknown): AppError {
  return {
    code: "GIT_FAILED",
    message:
      error instanceof GitServiceError
        ? error.message
        : "The files were updated, but the Git version could not be created.",
    retryable: error instanceof GitServiceError ? error.retryable : true,
  };
}

export class AiPatchApplicationService {
  private readonly proposals = new Map<string, StoredProposal>();
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly proposalTtlMs: number;
  private readonly maxProposals: number;

  constructor(private readonly options: AiPatchApplicationOptions) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.proposalTtlMs = options.proposalTtlMs ?? DEFAULT_PROPOSAL_TTL_MS;
    this.maxProposals = options.maxProposals ?? DEFAULT_MAX_PROPOSALS;
  }

  createReview(
    projectId: string,
    proposal: ValidatedAiPatchProposal,
  ): AiPatchReview {
    this.removeExpired();
    while (this.proposals.size >= this.maxProposals) {
      const oldest = this.proposals.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.proposals.delete(oldest);
    }
    const proposalId = this.createId();
    this.proposals.set(proposalId, {
      projectId,
      proposal,
      expiresAt: this.now() + this.proposalTtlMs,
    });
    return createAiPatchReview(proposal, proposalId);
  }

  discard(projectId: string, proposalId: string): boolean {
    const stored = this.getProposal(projectId, proposalId);
    if (stored === undefined) return false;
    this.proposals.delete(proposalId);
    return true;
  }

  async apply(input: AiPatchApplyRequest): Promise<AiPatchApplyResponse> {
    const request = AiPatchApplyRequestSchema.parse(input);
    const stored = this.getProposal(request.projectId, request.proposalId);
    if (stored === undefined) {
      return failed({
        code: "NOT_FOUND",
        message: "The proposal expired or is no longer available.",
        retryable: false,
      });
    }
    const acceptedChangeIds = new Set(request.acceptedChangeIds);
    const knownChangeIds = new Set(
      stored.proposal.files.flatMap((file) =>
        file.edits.map((edit) => edit.changeId),
      ),
    );
    if (
      request.acceptedChangeIds.some(
        (changeId) => !knownChangeIds.has(changeId),
      )
    ) {
      return failed({
        code: "VALIDATION_FAILED",
        message: "The accepted proposal changes are invalid.",
        retryable: false,
      });
    }
    const writes = stored.proposal.files.flatMap((file) => {
      const content = selectedContent(file, acceptedChangeIds);
      return content === undefined
        ? []
        : [
            {
              relativePath: file.relativePath,
              expectedHash: file.baselineHash,
              content,
            },
          ];
    });

    try {
      const result = await this.options.projectService.applyDocumentBatch(
        request.projectId,
        writes,
        async () => {
          try {
            const version =
              await this.options.gitService.createVersionForPathsWhileProjectLocked(
                request.projectId,
                versionMessage(stored.proposal.summary),
                writes.map((write) => write.relativePath),
              );
            return version.created
              ? { status: "versioned" as const, version: version.version }
              : {
                  status: "version_failed" as const,
                  error: gitError(
                    new GitServiceError(
                      "git_failed",
                      "The accepted files changed, but Git reported no versionable changes.",
                      true,
                    ),
                  ),
                };
          } catch (error) {
            return {
              status: "version_failed" as const,
              error: gitError(error),
            };
          }
        },
      );
      this.proposals.delete(request.proposalId);
      const documents = result.documents.map((document) => ({
        relativePath: document.relativePath,
        hash: document.hash,
      }));
      if (result.afterWriteResult.status === "versioned") {
        return AiPatchApplyResponseSchema.parse({
          ok: true,
          status: "versioned",
          documents,
          version: result.afterWriteResult.version,
        });
      }
      return AiPatchApplyResponseSchema.parse({
        ok: true,
        status: "version_failed",
        documents,
        versionError: result.afterWriteResult.error,
      });
    } catch (error) {
      return failed(applicationError(error));
    }
  }

  private getProposal(
    projectId: string,
    proposalId: string,
  ): StoredProposal | undefined {
    this.removeExpired();
    const stored = this.proposals.get(proposalId);
    return stored?.projectId === projectId ? stored : undefined;
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [proposalId, proposal] of this.proposals) {
      if (proposal.expiresAt <= now) this.proposals.delete(proposalId);
    }
  }
}
