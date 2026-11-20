import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  BookOpenText,
  Database,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Progress } from "@/components/ui/progress.js";
import type { MessageKey } from "../../i18n/index.js";
import {
  getKnowledgeApi,
  type KnowledgeIndexStatusResult,
  type KnowledgeSearchHit,
} from "./knowledge-api.js";

interface KnowledgePanelProps {
  readonly onOpenSource: (relativePath: string) => void;
  readonly projectId: string;
  readonly t: (key: MessageKey) => string;
}

export function KnowledgePanel({
  onOpenSource,
  projectId,
  t,
}: KnowledgePanelProps): JSX.Element {
  const [status, setStatus] = useState<KnowledgeIndexStatusResult>();
  const [progress, setProgress] = useState(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly KnowledgeSearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const activeTaskId = useRef<string | null>(null);
  const api = useMemo(() => getKnowledgeApi(), []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const next = await api.getStatus(projectId);
      setStatus(next);
      activeTaskId.current = next.activeTaskId;
      if (next.status !== "updating") setProgress(0);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("knowledgeLoadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [api, projectId, t]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshStatus(), 0);
    const removeProgress = api.onProgress((event) => {
      if (event.taskId !== activeTaskId.current) return;
      setProgress(
        event.total === null
          ? 0
          : Math.round((event.completed / event.total) * 100),
      );
      if (event.phase === "complete") void refreshStatus();
    });
    const removeCancelled = api.onCancelled((event) => {
      if (event.taskId === activeTaskId.current) void refreshStatus();
    });
    return () => {
      window.clearTimeout(initialRefresh);
      removeProgress();
      removeCancelled();
    };
  }, [api, refreshStatus]);

  useEffect(() => {
    if (status?.status !== "updating") return;
    const timer = window.setInterval(() => void refreshStatus(), 500);
    return () => window.clearInterval(timer);
  }, [refreshStatus, status?.status]);

  const startIndex = useCallback(
    async (rebuild: boolean): Promise<void> => {
      if (
        !window.confirm(
          t(rebuild ? "knowledgeRebuildConfirm" : "knowledgeInitializeConfirm"),
        )
      ) {
        return;
      }
      setError(undefined);
      setHits([]);
      setLoading(true);
      try {
        const result = rebuild
          ? await api.rebuild(projectId)
          : await api.initialize(projectId);
        activeTaskId.current = result.taskId;
        setStatus(result.status);
        setProgress(0);
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : t("knowledgeStartFailed"),
        );
      } finally {
        setLoading(false);
      }
    },
    [api, projectId, t],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const taskId = activeTaskId.current;
    if (taskId === null) return;
    if (!(await api.cancel(taskId))) setError(t("knowledgeCancelFailed"));
  }, [api, t]);

  const search = useCallback(async (): Promise<void> => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) return;
    setSearching(true);
    setError(undefined);
    try {
      setHits(await api.search(projectId, normalizedQuery));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("knowledgeSearchFailed"),
      );
      await refreshStatus();
    } finally {
      setSearching(false);
    }
  }, [api, projectId, query, refreshStatus, t]);

  const state = status?.status ?? "not_initialized";
  return (
    <div className="knowledge-panel" data-testid="knowledge-panel">
      <header className="knowledge-header">
        <div>
          <Database size={20} aria-hidden="true" />
          <div>
            <h3>{t("knowledgeTitle")}</h3>
            <span className={`knowledge-state state-${state}`}>
              {t(
                state === "ready"
                  ? "knowledgeReady"
                  : state === "updating"
                    ? "knowledgeUpdating"
                    : state === "stale"
                      ? "knowledgeStale"
                      : "knowledgeNotInitialized",
              )}
            </span>
          </div>
        </div>
        {state === "ready" ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title={t("knowledgeRebuild")}
            aria-label={t("knowledgeRebuild")}
            onClick={() => void startIndex(true)}
          >
            <RefreshCw size={16} />
          </Button>
        ) : null}
      </header>

      {error !== undefined || (status?.lastError ?? null) !== null ? (
        <p className="knowledge-error" role="alert">
          {error ?? status?.lastError}
        </p>
      ) : null}

      {state === "updating" ? (
        <section className="knowledge-progress" aria-live="polite">
          <div>
            <span>{t("knowledgeIndexing")}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void cancel()}
          >
            <Square size={13} />
            {t("cancel")}
          </Button>
        </section>
      ) : state === "not_initialized" || state === "stale" ? (
        <section className="knowledge-empty">
          <BookOpenText size={28} aria-hidden="true" />
          <Button
            type="button"
            disabled={loading}
            onClick={() => void startIndex(state === "stale")}
          >
            <Database size={15} />
            {state === "stale" ? t("knowledgeRetry") : t("knowledgeInitialize")}
          </Button>
        </section>
      ) : (
        <>
          <form
            className="knowledge-search"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Input
              type="search"
              maxLength={500}
              value={query}
              aria-label={t("knowledgeSearch")}
              placeholder={t("knowledgeSearchPlaceholder")}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              disabled={searching || query.trim().length === 0}
            >
              <Search size={14} />
              {searching ? t("knowledgeSearching") : t("knowledgeSearch")}
            </Button>
          </form>
          <div className="knowledge-meta">
            <span>
              {status?.documentCount ?? 0} {t("knowledgeDocuments")}
            </span>
            <span>
              {status?.chunkCount ?? 0} {t("knowledgeChunks")}
            </span>
          </div>
          <ol className="knowledge-results" aria-live="polite">
            {hits.map((hit) => (
              <li key={`${hit.relativePath}:${hit.startLine}:${hit.endLine}`}>
                <button
                  type="button"
                  onClick={() => onOpenSource(hit.relativePath)}
                >
                  <span className="knowledge-result-source">
                    {hit.relativePath.replace(/\.md$/iu, "")} · {hit.startLine}-
                    {hit.endLine}
                  </span>
                  {hit.titleContext.length > 0 ? (
                    <strong>{hit.titleContext.join(" / ")}</strong>
                  ) : null}
                  <span>{hit.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
