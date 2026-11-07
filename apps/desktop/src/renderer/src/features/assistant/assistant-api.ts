import type {
  AiChatCancelResponse,
  AiChatEvent,
  AiChatStartRequest,
  AiChatStartResponse,
  AiPatchApplyResponse,
  AppError,
} from "@author-copilot/contracts";

export class AssistantApiError extends Error {
  constructor(public readonly error: AppError) {
    super(error.message);
    this.name = "AssistantApiError";
  }
}

export function getProposalApi(): {
  readonly apply: (
    projectId: string,
    proposalId: string,
    acceptedChangeIds: readonly string[],
  ) => Promise<AiPatchApplyResponse>;
  readonly discard: (projectId: string, proposalId: string) => Promise<boolean>;
} {
  const raw = window.authorCopilot.assistant.proposal;
  return {
    apply: (projectId, proposalId, acceptedChangeIds) =>
      raw.apply({
        projectId,
        proposalId,
        acceptedChangeIds: [...acceptedChangeIds],
      }),
    async discard(projectId, proposalId) {
      return (await raw.discard({ projectId, proposalId })).discarded;
    },
  };
}

export function getAssistantApi(): {
  readonly start: (
    request: AiChatStartRequest,
  ) => Promise<Extract<AiChatStartResponse, { readonly ok: true }>>;
  readonly cancel: (runId: string) => Promise<AiChatCancelResponse>;
  readonly onEvent: (listener: (event: AiChatEvent) => void) => () => void;
} {
  const raw = window.authorCopilot.assistant.chat;
  return {
    async start(request) {
      const response = await raw.start(request);
      if (!response.ok) throw new AssistantApiError(response.error);
      return response;
    },
    cancel: (runId) => raw.cancel({ runId }),
    onEvent: raw.onEvent,
  };
}
