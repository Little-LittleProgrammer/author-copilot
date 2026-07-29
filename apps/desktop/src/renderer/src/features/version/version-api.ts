import type {
  VersionCreateResponse,
  VersionDiff,
  VersionDiffResponse,
  VersionListResponse,
  VersionOperationError,
  VersionSummary,
} from "@author-copilot/contracts";

export class VersionApiError extends Error {
  public constructor(
    public readonly code: VersionOperationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "VersionApiError";
  }
}

export interface VersionResult {
  readonly created: boolean;
  readonly shortCommitId?: string;
}

function unwrap(response: VersionCreateResponse): VersionResult {
  if (!response.ok) {
    throw new VersionApiError(response.error.code, response.error.message);
  }
  return response.created
    ? { created: true, shortCommitId: response.version.shortCommitId }
    : { created: false };
}

function unwrapList(response: VersionListResponse): readonly VersionSummary[] {
  if (!response.ok) {
    throw new VersionApiError(response.error.code, response.error.message);
  }
  return response.versions;
}

function unwrapDiff(response: VersionDiffResponse): VersionDiff {
  if (!response.ok) {
    throw new VersionApiError(response.error.code, response.error.message);
  }
  return response.diff;
}

export function getVersionApi():
  | {
      readonly create: (input: {
        readonly message: string;
        readonly projectId: string;
      }) => Promise<VersionResult>;
      readonly list: (input: {
        readonly projectId: string;
        readonly limit?: number;
      }) => Promise<readonly VersionSummary[]>;
      readonly diff: (input: {
        readonly projectId: string;
        readonly commitId: string;
      }) => Promise<VersionDiff>;
    }
  | undefined {
  const raw = window.authorCopilot.version;
  if (raw === undefined) return undefined;
  return {
    async create(input) {
      return unwrap(await raw.create(input));
    },
    async list(input) {
      return unwrapList(
        await raw.list({
          projectId: input.projectId,
          limit: input.limit ?? 50,
        }),
      );
    },
    async diff(input) {
      return unwrapDiff(await raw.diff(input));
    },
  };
}

export type { VersionDiff, VersionSummary };
