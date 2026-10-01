import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  AI_CONTEXT_MAX_INSTRUCTION_CHARACTERS,
  AgentToolNameSchema,
  type AgentState,
  type AiChatEvent,
  type AiContextSelection,
  type AiPatchReview,
  type ConversationMessage,
} from "@author-copilot/contracts";
import {
  ArrowUp,
  BookOpen,
  Bot,
  Check,
  ChevronLeft,
  History,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { MessageKey } from "../../i18n/index.js";
import { AiConnectionSelector } from "./AiSettingsDialog.js";
import { AgentChanges } from "./AgentChanges.js";
import { getAssistantApi } from "./assistant-api.js";
import { conversationHistory } from "./conversation-state.js";
import { useConversations } from "./use-conversations.js";

interface ChatPanelProps {
  readonly previewHost: HTMLElement | null;
  readonly onPreviewOpenChange: (open: boolean) => void;
  readonly blocked: boolean;
  readonly contextPaths: readonly string[];
  readonly content: string;
  readonly documentPath: string | undefined;
  readonly onOpenSource: (relativePath: string) => void;
  readonly onProposalReady: (review: AiPatchReview) => void;
  readonly projectId: string;
  readonly projectName: string;
  readonly selection: AiContextSelection | undefined;
  readonly refreshKey: number;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onFilesChanged: () => Promise<void>;
  readonly onClose: () => void;
  readonly onKnowledge: () => void;
  readonly t: (key: MessageKey) => string;
}
interface ActiveRun {
  conversationId: string;
  messageId: string;
  mode: "ask" | "agent";
  id?: string;
}

export function ChatPanel(props: ChatPanelProps): JSX.Element {
  const {
    projectId,
    projectName,
    documentPath,
    contextPaths,
    selection,
    content,
    blocked,
    t,
  } = props;
  const api = useMemo(() => getAssistantApi(), []);
  const agent = window.authorCopilot.assistant.agent;
  const history = useConversations(projectId, t("chatNewConversation"));
  const latest = useRef({ props, history });
  useEffect(() => {
    latest.current = { props, history };
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{ messageId: string; path: string }>();
  const [renaming, setRenaming] = useState<string>();
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>({ running: false });
  const [agentLoaded, setAgentLoaded] = useState(false);
  const active = useRef<ActiveRun | undefined>(undefined);
  const [activeConversation, setActiveConversation] = useState<string>();
  const sending = useRef(false);
  const queued = useRef<AiChatEvent[]>([]);
  const sequences = useRef(new Map<string, number>());
  const refreshing = useRef<Promise<void> | undefined>(undefined);
  const taskConversation = useRef<ActiveRun | undefined>(undefined);
  const completed = useRef(new Set<string>());
  const streamedTasks = useRef(new Set<string>());
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const current = history.current;
  const previewVisible =
    !historyOpen &&
    current?.messages.some(
      (message) =>
        message.id === preview?.messageId && message.review !== undefined,
    ) === true;
  const onPreviewOpenChange = props.onPreviewOpenChange;
  useEffect(() => {
    onPreviewOpenChange(previewVisible);
    return () => onPreviewOpenChange(false);
  }, [onPreviewOpenChange, previewVisible]);
  const instruction = current ? (drafts[current.id] ?? "") : "";
  const working =
    busy || activeConversation !== undefined || agentState.running;

  const applyChatEvent = useCallback((event: AiChatEvent) => {
    const run = active.current;
    if (run?.mode !== "ask" || run.id !== event.runId) return;
    if (event.sequence <= (sequences.current.get(event.runId) ?? -1)) return;
    sequences.current.set(event.runId, event.sequence);
    const { history: store, props: callbacks } = latest.current;
    store.patchMessage(
      run.conversationId,
      run.messageId,
      (message) => {
        if (event.type === "ai.chat.delta")
          return { ...message, content: message.content + event.text };
        if (event.type === "ai.chat.failed")
          return { ...message, status: "failed", error: event.error.message };
        if (event.type === "ai.chat.cancelled")
          return { ...message, status: "cancelled" };
        return {
          ...message,
          status: "complete",
          content:
            event.type === "ai.proposal.ready"
              ? event.review.summary
              : message.content,
        };
      },
      event.type !== "ai.chat.delta",
    );
    if (event.type === "ai.proposal.ready")
      callbacks.onProposalReady(event.review);
    if (event.type !== "ai.chat.delta") {
      active.current = undefined;
      setActiveConversation(undefined);
      sequences.current.delete(event.runId);
    }
  }, []);
  useEffect(() => {
    const unsubscribe = api.onEvent((event) => {
      if (active.current?.id === event.runId) applyChatEvent(event);
      else if (sending.current && active.current?.mode === "ask")
        queued.current.push(event);
    });
    return () => {
      unsubscribe();
      if (active.current?.mode === "ask" && active.current.id)
        void api.cancel(active.current.id).catch(() => undefined);
    };
  }, [api, applyChatEvent]);

  const refreshAgent = useCallback((): Promise<void> => {
    if (refreshing.current) return refreshing.current;
    const pending = (async () => {
      const result = await agent.getState({ projectId });
      if (!result.ok) throw new Error(result.error.message);
      const state = result.state;
      setAgentState(state);
      setAgentLoaded(true);
      const { props: callbacks, history: store } = latest.current;
      callbacks.onBusyChange(state.running || sending.current);
      if (!state.taskId || !store.loaded || sending.current) return;
      let target = taskConversation.current;
      if (target?.id !== state.taskId) {
        const summary = store.summaries.find((entry) =>
          entry.taskIds.includes(state.taskId!),
        );
        const conversation = summary
          ? await store.load(summary.id)
          : store.create("agent");
        let message = conversation.messages.find(
          (entry) => entry.taskId === state.taskId,
        );
        if (!message) {
          message = {
            id: crypto.randomUUID(),
            role: "assistant",
            mode: "agent",
            taskId: state.taskId,
            status: "interrupted",
            content: callbacks.t("agentInterrupted"),
          };
          store.update(
            {
              ...conversation,
              title: callbacks.t("chatRecoveredConversation"),
              messages: [...conversation.messages, message],
            },
            true,
          );
        }
        target = {
          conversationId: conversation.id,
          messageId: message.id,
          mode: "agent",
          id: state.taskId,
        };
        taskConversation.current = target;
      }
      const terminal = state.event;
      const status: ConversationMessage["status"] = state.running
        ? "streaming"
        : terminal?.type === "agent.task.completed"
          ? "complete"
          : terminal?.type === "agent.task.cancelled"
            ? "cancelled"
            : terminal?.type === "agent.task.failed"
              ? "failed"
              : "interrupted";
      const text =
        terminal?.type === "agent.task.completed"
          ? terminal.summary
          : state.running
            ? callbacks.t(
                terminal?.type === "agent.task.progress"
                  ? (
                      {
                        initializing: "agentInitializing",
                        running: "agentWorking",
                        responding: "agentResponding",
                        tool: "agentTool",
                        finalizing: "agentFinalizing",
                      } as const
                    )[terminal.phase]
                  : "aiChatThinking",
              )
            : terminal?.type === "agent.task.cancelled"
              ? callbacks.t(
                  terminal.reason === "timeout"
                    ? "agentTimedOut"
                    : "agentCancelled",
                )
              : callbacks.t(
                  status === "failed" ? "agentFailed" : "agentInterrupted",
                );
      const previous = store.cache.current
        .get(target.conversationId)
        ?.messages.find((entry) => entry.id === target.messageId);
      if (
        previous?.content !== text ||
        previous.status !== status ||
        previous.review?.reviewDigest !== state.review?.reviewDigest
      ) {
        store.patchMessage(
          target.conversationId,
          target.messageId,
          (message) => ({
            ...message,
            status,
            content:
              state.running && streamedTasks.current.has(state.taskId!)
                ? message.content
                : text,
            ...(state.review ? { review: state.review } : {}),
            ...(terminal?.type === "agent.task.failed"
              ? { error: terminal.error.message }
              : {}),
          }),
          !state.running,
        );
      }
      if (state.running) {
        active.current = target;
        setActiveConversation(target.conversationId);
      } else {
        if (active.current?.mode === "agent") {
          active.current = undefined;
          setActiveConversation(undefined);
        }
        if (!completed.current.has(state.taskId)) {
          completed.current.add(state.taskId);
          await callbacks.onFilesChanged();
        }
        // A text-only Agent response needs no file approval. Persist the answer
        // before closing its empty recovery snapshot so it survives a reload.
        if (state.review?.files.length === 0 && !callbacks.blocked) {
          const conversation = store.cache.current.get(target.conversationId);
          if (conversation) await store.save(conversation);
          const retained = await agent.retain({
            projectId,
            taskId: state.taskId,
            reviewDigest: state.review.reviewDigest,
          });
          if (!retained.ok) throw new Error(retained.error.message);
          setAgentState({ running: false });
          taskConversation.current = undefined;
        }
      }
    })();
    refreshing.current = pending;
    void pending
      .finally(() => {
        refreshing.current = undefined;
      })
      .catch(() => undefined);
    return pending;
  }, [agent, projectId]);
  useEffect(() => {
    if (!history.loaded) return;
    const refresh = () => {
      if (!sending.current)
        void refreshAgent().catch((reason: unknown) =>
          setError(
            reason instanceof Error ? reason.message : t("errorGeneric"),
          ),
        );
    };
    refresh();
    const unsubscribe = agent.onEvent((event) => {
      if (event.projectId !== projectId) return;
      if (event.type === "agent.task.delta") {
        const target = taskConversation.current;
        if (!target || target.id !== event.taskId) return;
        if (event.sequence <= (sequences.current.get(event.taskId) ?? -1))
          return;
        sequences.current.set(event.taskId, event.sequence);
        const started = streamedTasks.current.has(event.taskId);
        streamedTasks.current.add(event.taskId);
        latest.current.history.patchMessage(
          target.conversationId,
          target.messageId,
          (message) => ({
            ...message,
            status: "streaming",
            content: ((started ? message.content : "") + event.text).slice(
              0,
              200_000,
            ),
          }),
        );
      } else refresh();
    });
    const timer = setInterval(() => {
      if (active.current?.mode === "agent") refresh();
    }, 1500);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [agent, history.loaded, projectId, refreshAgent, props.refreshKey, t]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [current?.messages, current?.id]);

  const perform = async (action: () => Promise<void>): Promise<void> => {
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorGeneric"));
    }
  };
  const send = async (): Promise<void> => {
    const normalized = instruction.trim();
    if (
      !current ||
      !normalized ||
      working ||
      sending.current ||
      !history.loaded ||
      !agentLoaded ||
      current.messages.length >= 1998
    )
      return;
    if (current.mode === "ask" && !documentPath) return;
    if (current.mode === "agent" && (blocked || agentState.taskId)) return;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    follow.current = true;
    const user: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      mode: current.mode,
      content: normalized,
      status: "complete",
    };
    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      mode: current.mode,
      content: "",
      status: "streaming",
    };
    const run: ActiveRun = {
      conversationId: current.id,
      messageId: message.id,
      mode: current.mode,
    };
    active.current = run;
    setActiveConversation(current.id);
    const next = {
      ...current,
      title:
        current.messages.length === 0 ? normalized.slice(0, 80) : current.title,
      updatedAt: new Date().toISOString(),
      messages: [...current.messages, user, message],
    };
    history.update(next);
    setDrafts((items) => ({ ...items, [current.id]: "" }));
    try {
      await history.save(next);
      if (run.mode === "ask" && documentPath) {
        const response = await api.start({
          projectId,
          mode: "chat",
          currentDocument: {
            relativePath: documentPath,
            content,
            ...(selection ? { selection } : {}),
          },
          contextPaths: [...contextPaths],
          instruction: normalized,
          history: conversationHistory(current.messages),
          retrievalLimit: 5,
        });
        run.id = response.runId;
        history.patchMessage(
          current.id,
          message.id,
          (entry) => ({
            ...entry,
            runId: response.runId,
            context: response.context,
          }),
          true,
        );
        for (const event of queued.current
          .filter((entry) => entry.runId === response.runId)
          .sort((a, b) => a.sequence - b.sequence))
          applyChatEvent(event);
        queued.current = [];
      } else {
        props.onBusyChange(true);
        const response = await agent.start({
          projectId,
          prompt: normalized,
          ...(documentPath ? { documentPath } : {}),
          contextPaths: [...contextPaths],
          ...(selection ? { selection } : {}),
          history: conversationHistory(current.messages),
          timeoutMs: 300_000,
          readableFileTypes: ["markdown"],
          writableFileTypes: ["markdown"],
          allowedTools: [...AgentToolNameSchema.options],
        });
        if (!response.ok) throw new Error(response.error.message);
        run.id = response.capability.taskId;
        taskConversation.current = run;
        history.patchMessage(
          current.id,
          message.id,
          (entry) => ({ ...entry, taskId: response.capability.taskId }),
          true,
        );
      }
    } catch (reason) {
      const messageText =
        reason instanceof Error ? reason.message : t("aiChatStartFailed");
      history.patchMessage(
        current.id,
        message.id,
        (entry) => ({ ...entry, status: "failed", error: messageText }),
        true,
      );
      setDrafts((items) => ({ ...items, [current.id]: normalized }));
      active.current = undefined;
      setActiveConversation(undefined);
      props.onBusyChange(false);
    } finally {
      sending.current = false;
      setBusy(false);
      if (run.mode === "agent") void perform(refreshAgent);
    }
  };
  const settle = async (resolution: "kept" | "undone") => {
    const target = taskConversation.current;
    if (!target?.id || blocked || busy || agentState.running) return;
    setBusy(true);
    sending.current = true;
    props.onBusyChange(true);
    await refreshing.current?.catch(() => undefined);
    await perform(async () => {
      if (resolution === "kept") {
        if (!agentState.review) return;
        const result = await agent.retain({
          projectId,
          taskId: target.id!,
          reviewDigest: agentState.review.reviewDigest,
        });
        if (!result.ok) throw new Error(result.error.message);
      } else {
        const result = await window.authorCopilot.taskRecovery.restore({
          projectId,
          taskId: target.id!,
        });
        if (!result.ok) throw new Error(result.error.message);
        if (result.result.status !== "complete") {
          await props.onFilesChanged();
          throw new Error(
            `${t("agentRestoreConflict")} ${result.result.conflicts.map((entry) => entry.path ?? projectName).join(", ")} ${result.result.failures.map((entry) => entry.message).join("; ")}`,
          );
        }
      }
      history.patchMessage(
        target.conversationId,
        target.messageId,
        (message) => ({ ...message, resolution }),
        true,
      );
      await props.onFilesChanged();
    });
    sending.current = false;
    setBusy(false);
    props.onBusyChange(false);
    await perform(refreshAgent);
  };
  const cancel = () =>
    perform(async () => {
      const run = active.current;
      if (!run?.id) return;
      const result =
        run.mode === "ask"
          ? await api.cancel(run.id)
          : await agent.cancel({ projectId, taskId: run.id });
      if (!result.accepted) throw new Error(t("aiChatCancelFailed"));
    });
  const pendingHere = current?.messages.some(
    (message) => message.taskId === agentState.taskId,
  );
  const sendDisabled =
    working ||
    !history.loaded ||
    !agentLoaded ||
    !instruction.trim() ||
    (current?.mode === "ask"
      ? !documentPath
      : blocked || agentState.taskId !== undefined);

  return (
    <section className="copilot-chat" data-testid="ai-chat-panel">
      <header className="copilot-header">
        <strong>{historyOpen ? t("chatHistory") : t("aiChat")}</strong>
        <div>
          <button
            type="button"
            title={t("chatNewConversation")}
            aria-label={t("chatNewConversation")}
            disabled={!history.loaded || working}
            onClick={() => {
              history.create(current?.mode);
              setHistoryOpen(false);
              follow.current = true;
            }}
          >
            <Plus size={17} />
          </button>
          <button
            type="button"
            title={t("chatHistory")}
            aria-label={t("chatHistory")}
            aria-pressed={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <History size={17} />
          </button>
          <button
            type="button"
            title={t("assistantKnowledgeMode")}
            aria-label={t("assistantKnowledgeMode")}
            onClick={props.onKnowledge}
          >
            <BookOpen size={16} />
          </button>
          <button type="button" aria-label={t("close")} onClick={props.onClose}>
            <X size={17} />
          </button>
        </div>
      </header>
      {historyOpen ? (
        <div className="copilot-history">
          <label className="copilot-history-search">
            <Search size={14} />
            <input
              aria-label={t("chatSearchHistory")}
              placeholder={t("chatSearchHistory")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="copilot-back"
            onClick={() => setHistoryOpen(false)}
          >
            <ChevronLeft size={14} />
            {t("chatBack")}
          </button>
          {history.summaries
            .filter((entry) =>
              entry.title
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((entry) => (
              <div
                className="copilot-history-item"
                key={entry.id}
                data-active={current?.id === entry.id}
              >
                {renaming === entry.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (title.trim())
                        void perform(async () => {
                          const conversation = await history.load(entry.id);
                          history.update(
                            { ...conversation, title: title.trim() },
                            true,
                          );
                          setRenaming(undefined);
                        });
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={t("chatRename")}
                      maxLength={120}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRenaming(undefined);
                      }}
                    />
                    <button type="submit" aria-label={t("save")}>
                      <Check size={14} />
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="copilot-history-open"
                    onClick={() =>
                      void perform(async () => {
                        await history.open(entry.id);
                        setHistoryOpen(false);
                        follow.current = true;
                      })
                    }
                  >
                    <MessageSquare size={15} />
                    <span>
                      <strong>{entry.title}</strong>
                      <small>
                        {new Date(entry.updatedAt).toLocaleDateString()} ·{" "}
                        {entry.mode === "ask" ? "Ask" : "Agent"}
                      </small>
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  title={t("chatRename")}
                  aria-label={`${t("chatRename")}: ${entry.title}`}
                  onClick={() => {
                    setRenaming(entry.id);
                    setTitle(entry.title);
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  disabled={
                    entry.id === activeConversation ||
                    entry.taskIds.includes(agentState.taskId ?? "")
                  }
                  title={t("chatDelete")}
                  aria-label={`${t("chatDelete")}: ${entry.title}`}
                  onClick={() => setDeleting(entry.id)}
                >
                  <Trash2 size={13} />
                </button>
                {deleting === entry.id ? (
                  <div className="copilot-delete-confirm">
                    <span>{t("chatDeleteConfirm")}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void perform(async () => {
                          await history.remove(entry.id);
                          setDeleting(undefined);
                        })
                      }
                    >
                      {t("chatDelete")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(undefined)}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          {history.summaries.length === 0 ? (
            <p className="copilot-hint">{t("chatHistoryEmpty")}</p>
          ) : null}
        </div>
      ) : (
        <>
          {current && current.messages.length > 0 ? (
            <div className="copilot-session-title" title={current.title}>
              {current.title}
            </div>
          ) : null}
          <div
            className="copilot-messages"
            ref={scroll}
            onScroll={() => {
              const node = scroll.current;
              if (node)
                follow.current =
                  node.scrollHeight - node.scrollTop - node.clientHeight < 70;
            }}
          >
            {!current || current.messages.length === 0 ? (
              <div className="copilot-empty">
                <Bot size={34} strokeWidth={1.5} />
                <h3>{t("chatWelcome")}</h3>
                <p>{t("chatWelcomeDescription")}</p>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      current &&
                      setDrafts((items) => ({
                        ...items,
                        [current.id]: t("chatSuggestionAsk"),
                      }))
                    }
                  >
                    {t("chatSuggestionAsk")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (current) {
                        history.update({ ...current, mode: "agent" });
                        setDrafts((items) => ({
                          ...items,
                          [current.id]: t("chatSuggestionAgent"),
                        }));
                      }
                    }}
                  >
                    {t("chatSuggestionAgent")}
                  </button>
                </div>
              </div>
            ) : (
              current.messages.map((message) => (
                <article
                  className={`copilot-message ${message.role}`}
                  key={message.id}
                >
                  {message.role === "assistant" ? (
                    <header>
                      <Bot size={16} />
                      <strong>Author Copilot</strong>
                      <span>{message.mode === "ask" ? "Ask" : "Agent"}</span>
                    </header>
                  ) : null}
                  <div className="copilot-message-content">
                    {message.content ||
                      (message.status === "streaming"
                        ? t("aiChatThinking")
                        : "")}
                  </div>
                  {message.status === "streaming" ? (
                    <span className="copilot-progress" role="status">
                      {t("chatWorking")}
                    </span>
                  ) : null}
                  {message.status === "interrupted" ? (
                    <small className="copilot-hint">
                      {t("chatInterrupted")}
                    </small>
                  ) : null}
                  {message.status === "cancelled" && message.mode === "ask" ? (
                    <small className="copilot-hint">
                      {t("aiChatCancelled")}
                    </small>
                  ) : null}
                  {message.error ? (
                    <p className="copilot-error" role="alert">
                      {message.error}
                    </p>
                  ) : null}
                  {message.context && message.context.sources.length > 0 ? (
                    <details className="copilot-sources">
                      <summary>
                        {t("chatSources")} · {message.context.sources.length}
                      </summary>
                      {message.context.sources.map((source) => (
                        <button
                          type="button"
                          key={`${source.sourceId}:${source.relativePath}`}
                          onClick={() =>
                            props.onOpenSource(source.relativePath)
                          }
                        >
                          {source.relativePath}
                        </button>
                      ))}
                    </details>
                  ) : null}
                  {message.review && message.review.files.length > 0 ? (
                    <AgentChanges
                      review={message.review}
                      previewHost={props.previewHost}
                      previewPath={
                        preview?.messageId === message.id
                          ? preview.path
                          : undefined
                      }
                      onPreviewPathChange={(path) =>
                        setPreview(
                          path ? { messageId: message.id, path } : undefined,
                        )
                      }
                      resolution={message.resolution}
                      actionable={
                        message.taskId === agentState.taskId &&
                        !agentState.running
                      }
                      busy={busy || blocked}
                      onKeep={() => void settle("kept")}
                      onUndo={() => void settle("undone")}
                      t={t}
                    />
                  ) : null}
                </article>
              ))
            )}
          </div>
          {agentState.taskId && !agentState.running && !pendingHere ? (
            <button
              type="button"
              className="copilot-pending"
              onClick={() => {
                const target = taskConversation.current;
                if (target)
                  void perform(() => history.open(target.conversationId));
              }}
            >
              {t("chatReviewPendingTask")}
            </button>
          ) : null}
          <div className="copilot-composer">
            <div className="copilot-context">
              <button
                type="button"
                title={t("aiContext")}
                onClick={props.onKnowledge}
              >
                <Plus size={13} />
                {t("chatAddContext")}
              </button>
              {documentPath ? (
                <span title={documentPath}>
                  {documentPath.split("/").at(-1)}
                </span>
              ) : (
                <span>{projectName}</span>
              )}
              {selection ? (
                <span>
                  {t("aiChatSelection")} {selection.startLine}–
                  {selection.endLine}
                </span>
              ) : null}
              {contextPaths.length > 0 ? (
                <span>+{contextPaths.length}</span>
              ) : null}
            </div>
            <textarea
              data-testid="ai-chat-input"
              aria-label={t("aiChatPlaceholder")}
              value={instruction}
              maxLength={AI_CONTEXT_MAX_INSTRUCTION_CHARACTERS}
              rows={3}
              placeholder={t(
                current?.mode === "agent"
                  ? "chatAgentPlaceholder"
                  : "aiChatPlaceholder",
              )}
              disabled={!history.loaded}
              onChange={(event) => {
                if (current)
                  setDrafts((items) => ({
                    ...items,
                    [current.id]: event.target.value,
                  }));
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="copilot-composer-toolbar">
              <select
                data-testid="assistant-mode"
                aria-label={t("chatMode")}
                value={current?.mode ?? "ask"}
                disabled={working || !current}
                onChange={(event) => {
                  if (current)
                    history.update({
                      ...current,
                      mode: event.target.value === "agent" ? "agent" : "ask",
                    });
                }}
              >
                <option value="ask">Ask</option>
                <option value="agent">Agent</option>
              </select>
              <AiConnectionSelector compact t={t} />
              {activeConversation ? (
                <button
                  type="button"
                  data-testid="ai-chat-cancel"
                  className="copilot-send"
                  disabled={busy}
                  aria-label={t("agentCancel")}
                  title={t("agentCancel")}
                  onClick={() => void cancel()}
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="ai-chat-send"
                  className="copilot-send"
                  disabled={sendDisabled}
                  aria-label={t("aiChatSend")}
                  title={t("aiChatSend")}
                  onClick={() => void send()}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
          <p className="copilot-composer-note">
            {current?.mode === "agent"
              ? blocked
                ? t("agentSaveFirst")
                : agentState.taskId
                  ? t("chatReviewBeforeContinue")
                  : t("chatAgentNotice")
              : documentPath
                ? t("chatAskNotice")
                : t("aiChatSelectDocument")}
          </p>
        </>
      )}
      {error || history.error || agentState.versionError ? (
        <div className="copilot-error" role="alert">
          {error || history.error || agentState.versionError?.message}
          <button
            type="button"
            onClick={() =>
              void perform(async () => {
                if (current) await history.save(current);
                if (!history.loaded) history.reload();
                history.setError(undefined);
                await refreshAgent();
              })
            }
          >
            {t("agentRefresh")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
