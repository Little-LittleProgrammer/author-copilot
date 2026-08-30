import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import type {
  AiChatContextMetadata,
  AiChatEvent,
  AiChatHistoryMessage,
  AiChatSource,
  AiContextSelection,
  AiPatchReview,
} from "@author-copilot/contracts";
import { AI_CONTEXT_MAX_INSTRUCTION_CHARACTERS } from "@author-copilot/contracts";
import { BookOpen, Send, Square, UserRound, WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import type { MessageKey } from "../../i18n/index.js";
import { getAssistantApi } from "./assistant-api.js";

interface ChatPanelProps {
  readonly canPropose: boolean;
  readonly content: string;
  readonly documentPath: string | undefined;
  readonly onOpenSource: (relativePath: string) => void;
  readonly onProposalReady: (review: AiPatchReview) => void;
  readonly projectId: string;
  readonly selection: AiContextSelection | undefined;
  readonly t: (key: MessageKey) => string;
}

interface ChatMessage {
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly runId?: string;
  readonly context?: AiChatContextMetadata;
  readonly status?: "cancelled" | "complete" | "failed" | "streaming";
  readonly content: string;
  readonly error?: string;
}

export function ChatPanel({
  canPropose,
  content,
  documentPath,
  onOpenSource,
  onProposalReady,
  projectId,
  selection,
  t,
}: ChatPanelProps): JSX.Element {
  const api = useMemo(() => getAssistantApi(), []);
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRun = useRef<string | null>(null);
  const queuedEvents = useRef<AiChatEvent[]>([]);
  const lastSequence = useRef(new Map<string, number>());

  const applyEvent = useCallback(
    (event: AiChatEvent): void => {
      const previousSequence = lastSequence.current.get(event.runId) ?? -1;
      if (event.sequence <= previousSequence) return;
      lastSequence.current.set(event.runId, event.sequence);
      if (event.type !== "ai.chat.delta") {
        activeRun.current = null;
        setActiveRunId(null);
      }
      if (event.type === "ai.proposal.ready") {
        onProposalReady(event.review);
      }
      setMessages((current) =>
        current.map((message) => {
          if (message.runId !== event.runId) return message;
          if (event.type === "ai.chat.delta") {
            return { ...message, content: message.content + event.text };
          }
          if (event.type === "ai.chat.completed") {
            return { ...message, status: "complete" };
          }
          if (event.type === "ai.proposal.ready") {
            return {
              ...message,
              status: "complete",
              content:
                message.content.length > 0
                  ? message.content
                  : event.review.summary,
            };
          }
          if (event.type === "ai.chat.cancelled") {
            return { ...message, status: "cancelled" };
          }
          return {
            ...message,
            status: "failed",
            error: event.error.message,
          };
        }),
      );
    },
    [onProposalReady],
  );

  useEffect(() => {
    const remove = api.onEvent((event) => {
      if (activeRun.current === event.runId) applyEvent(event);
      else queuedEvents.current.push(event);
    });
    return () => {
      remove();
      const runId = activeRun.current;
      if (runId !== null) void api.cancel(runId);
    };
  }, [api, applyEvent]);

  const send = useCallback(
    async (mode: "chat" | "proposal"): Promise<void> => {
      const normalized = instruction.trim();
      if (
        normalized.length === 0 ||
        documentPath === undefined ||
        activeRun.current !== null
      ) {
        return;
      }
      setStarting(true);
      setStartError(undefined);
      try {
        const history: AiChatHistoryMessage[] = messages.flatMap((message) => {
          if (
            message.content.trim().length === 0 ||
            (message.role === "assistant" && message.status !== "complete")
          ) {
            return [];
          }
          return [{ role: message.role, content: message.content }];
        });
        const result = await api.start({
          projectId,
          mode,
          currentDocument: {
            relativePath: documentPath,
            content,
            ...(mode === "chat" && selection !== undefined
              ? { selection }
              : {}),
          },
          instruction: normalized,
          history: history.slice(-20),
          retrievalLimit: 5,
        });
        activeRun.current = result.runId;
        setActiveRunId(result.runId);
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "user", content: normalized },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            runId: result.runId,
            context: result.context,
            status: "streaming",
            content: "",
          },
        ]);
        setInstruction("");
        const ready = queuedEvents.current
          .filter((event) => event.runId === result.runId)
          .sort((left, right) => left.sequence - right.sequence);
        queuedEvents.current = queuedEvents.current.filter(
          (event) => event.runId !== result.runId,
        );
        for (const event of ready) applyEvent(event);
      } catch (reason) {
        setStartError(
          reason instanceof Error ? reason.message : t("aiChatStartFailed"),
        );
      } finally {
        setStarting(false);
      }
    },
    [
      api,
      applyEvent,
      content,
      documentPath,
      instruction,
      messages,
      projectId,
      selection,
      t,
    ],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const runId = activeRun.current;
    if (runId === null) return;
    const result = await api.cancel(runId);
    if (!result.accepted) setStartError(t("aiChatCancelFailed"));
  }, [api, t]);

  return (
    <section className="chat-panel" data-testid="ai-chat-panel">
      <header className="chat-header">
        <div>
          <WandSparkles size={18} aria-hidden="true" />
          <div>
            <h3>{t("aiChat")}</h3>
            <span>{t("aiChatDescription")}</span>
          </div>
        </div>
      </header>

      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <WandSparkles size={28} aria-hidden="true" />
            <p>
              {t(
                documentPath === undefined
                  ? "aiChatSelectDocument"
                  : "aiChatEmpty",
              )}
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`chat-message ${message.role}`}
              key={message.id}
            >
              <div className="chat-avatar" aria-hidden="true">
                {message.role === "user" ? (
                  <UserRound size={14} />
                ) : (
                  <WandSparkles size={14} />
                )}
              </div>
              <div className="chat-bubble">
                {message.content.length === 0 &&
                message.status === "streaming" ? (
                  <span className="chat-thinking">{t("aiChatThinking")}</span>
                ) : (
                  <p>{message.content}</p>
                )}
                {message.error !== undefined ? (
                  <span className="chat-error" role="alert">
                    {message.error}
                  </span>
                ) : null}
                {message.status === "cancelled" ? (
                  <span className="chat-muted">{t("aiChatCancelled")}</span>
                ) : null}
                {message.context !== undefined ? (
                  <ChatSources
                    context={message.context}
                    onOpenSource={onOpenSource}
                    t={t}
                  />
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send("chat");
        }}
      >
        {startError !== undefined ? (
          <p className="chat-error" role="alert">
            {startError}
          </p>
        ) : null}
        {selection !== undefined ? (
          <span className="chat-selection">
            {t("aiChatSelection")} {selection.startLine}-{selection.endLine}
          </span>
        ) : null}
        <Textarea
          data-testid="ai-chat-input"
          maxLength={AI_CONTEXT_MAX_INSTRUCTION_CHARACTERS}
          rows={3}
          value={instruction}
          disabled={documentPath === undefined}
          placeholder={t("aiChatPlaceholder")}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send("chat");
            }
          }}
        />
        <div>
          <span>
            {documentPath === undefined
              ? t("aiChatSelectDocument")
              : t("aiChatContextNotice")}
          </span>
          {activeRunId !== null ? (
            <Button
              data-testid="ai-chat-cancel"
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void cancel()}
            >
              <Square size={13} />
              {t("cancel")}
            </Button>
          ) : (
            <div className="chat-submit-actions">
              <Button
                data-testid="ai-proposal-create"
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  starting ||
                  !canPropose ||
                  documentPath === undefined ||
                  instruction.trim().length === 0
                }
                title={!canPropose ? t("aiProposalSaveFirst") : undefined}
                onClick={() => void send("proposal")}
              >
                <WandSparkles size={13} />
                {t("aiProposalCreate")}
              </Button>
              <Button
                data-testid="ai-chat-send"
                type="submit"
                size="sm"
                disabled={
                  starting ||
                  documentPath === undefined ||
                  instruction.trim().length === 0
                }
              >
                <Send size={13} />
                {starting ? t("aiChatStarting") : t("aiChatSend")}
              </Button>
            </div>
          )}
        </div>
      </form>
    </section>
  );
}

function ChatSources({
  context,
  onOpenSource,
  t,
}: {
  readonly context: AiChatContextMetadata;
  readonly onOpenSource: (relativePath: string) => void;
  readonly t: (key: MessageKey) => string;
}): JSX.Element {
  return (
    <div className="chat-sources">
      <span className="chat-scope">
        <BookOpen size={12} aria-hidden="true" />
        {t(
          context.scope === "full_book"
            ? "aiChatFullBookContext"
            : "aiChatCurrentDocumentContext",
        )}
      </span>
      {context.sources.length > 0 ? (
        <div>
          {context.sources.map((source: AiChatSource) => (
            <button
              key={`${source.sourceId}:${source.relativePath}:${source.startLine}`}
              type="button"
              title={`${source.relativePath}:${source.startLine}-${source.endLine}`}
              onClick={() => onOpenSource(source.relativePath)}
            >
              [{source.sourceId}] {source.relativePath.replace(/\.md$/iu, "")}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
