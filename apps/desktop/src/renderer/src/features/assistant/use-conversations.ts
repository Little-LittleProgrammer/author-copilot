import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Conversation,
  ConversationMessage,
  ConversationRequest,
  ConversationSummary,
} from "@author-copilot/contracts";
import { summarizeConversation } from "./conversation-state.js";

export function useConversations(projectId: string, untitled: string) {
  const cache = useRef(new Map<string, Conversation>());
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [current, setCurrent] = useState<Conversation>();
  const currentId = useRef<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string>();
  const pending = useRef(Promise.resolve());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const titles = useRef(untitled);
  titles.current = untitled;
  const request = useCallback(async (input: ConversationRequest) => {
    const result = await window.authorCopilot.assistant.conversation(input);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  }, []);
  const save = useCallback(
    (conversation: Conversation): Promise<void> => {
      const timer = timers.current.get(conversation.id);
      if (timer) clearTimeout(timer);
      timers.current.delete(conversation.id);
      const next = pending.current.then(async () => {
        await request({ action: "save", conversation });
      });
      pending.current = next.catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
      return next;
    },
    [request],
  );
  const update = useCallback(
    (conversation: Conversation, immediate = false): void => {
      cache.current.set(conversation.id, conversation);
      setSummaries((items) =>
        [
          summarizeConversation(conversation),
          ...items.filter((item) => item.id !== conversation.id),
        ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
      if (currentId.current === conversation.id) setCurrent(conversation);
      const timer = timers.current.get(conversation.id);
      if (timer) clearTimeout(timer);
      if (immediate) void save(conversation).catch(() => undefined);
      else
        timers.current.set(
          conversation.id,
          setTimeout(() => {
            void save(conversation).catch(() => undefined);
          }, 350),
        );
    },
    [save],
  );
  const create = useCallback(
    (mode: Conversation["mode"] = "ask"): Conversation => {
      const conversation: Conversation = {
        id: crypto.randomUUID(),
        projectId,
        title: titles.current,
        mode,
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      cache.current.set(conversation.id, conversation);
      currentId.current = conversation.id;
      setCurrent(conversation);
      return conversation;
    },
    [projectId],
  );
  const load = useCallback(
    async (id: string): Promise<Conversation> => {
      const cached = cache.current.get(id);
      if (cached) return cached;
      const result = await request({ action: "get", projectId, id });
      if (!result.conversation) throw new Error("Conversation not found.");
      const conversation = {
        ...result.conversation,
        messages: result.conversation.messages.map((message) =>
          message.status === "streaming"
            ? { ...message, status: "interrupted" as const }
            : message,
        ),
      };
      cache.current.set(id, conversation);
      return conversation;
    },
    [projectId, request],
  );
  const open = useCallback(
    async (id: string): Promise<void> => {
      currentId.current = id;
      const conversation = await load(id);
      if (currentId.current === id) setCurrent(conversation);
    },
    [load],
  );
  useEffect(() => {
    let alive = true;
    void request({ action: "list", projectId })
      .then(async (result) => {
        if (!alive) return;
        const items = result.conversations ?? [];
        setSummaries(items);
        if (items[0]) {
          const conversation = await load(items[0].id);
          if (!alive) return;
          currentId.current = conversation.id;
          setCurrent(conversation);
        } else create();
        setLoaded(true);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (alive)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    const scheduled = timers.current;
    const sessions = cache.current;
    return () => {
      alive = false;
      for (const [id, timer] of scheduled) {
        clearTimeout(timer);
        const conversation = sessions.get(id);
        if (conversation) void save(conversation).catch(() => undefined);
      }
    };
  }, [create, load, projectId, request, save, revision]);
  const patchMessage = useCallback(
    (
      id: string,
      messageId: string,
      patch: (message: ConversationMessage) => ConversationMessage,
      immediate = false,
    ) => {
      const conversation = cache.current.get(id);
      if (!conversation) return;
      update(
        {
          ...conversation,
          updatedAt: new Date().toISOString(),
          messages: conversation.messages.map((message) =>
            message.id === messageId ? patch(message) : message,
          ),
        },
        immediate,
      );
    },
    [update],
  );
  const remove = useCallback(
    async (id: string): Promise<void> => {
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer);
      timers.current.delete(id);
      await pending.current;
      await request({ action: "delete", projectId, id });
      cache.current.delete(id);
      setSummaries((items) => items.filter((item) => item.id !== id));
      if (currentId.current === id) create();
    },
    [create, projectId, request],
  );
  return {
    cache,
    summaries,
    current,
    loaded,
    error,
    setError,
    reload: () => setRevision((value) => value + 1),
    create,
    load,
    open,
    update,
    save,
    patchMessage,
    remove,
  };
}
