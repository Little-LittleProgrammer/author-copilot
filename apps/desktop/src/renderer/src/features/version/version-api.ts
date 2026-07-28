import type {
  VersionCreateResponse,
  VersionOperationError,
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

export function getVersionApi():
  | {
      readonly create: (input: {
        readonly message: string;
        readonly projectId: string;
      }) => Promise<VersionResult>;
    }
  | undefined {
  const raw = window.authorCopilot.version;
  if (raw === undefined) return undefined;
  return {
    async create(input) {
      return unwrap(await raw.create(input));
    },
  };
}
