import type {
  AiChatCancelResponse,
  AiChatEvent,
  AiChatStartRequest,
  AiChatStartResponse,
  AppError,
} from "@author-copilot/contracts";

export class AssistantApiError extends Error {
  constructor(public readonly error: AppError) {
    super(error.message);
    this.name = "AssistantApiError";
  }
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
