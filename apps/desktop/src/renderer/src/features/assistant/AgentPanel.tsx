import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  AgentToolNameSchema,
  type AgentState,
  type TaskRestoreResult,
} from "@author-copilot/contracts";
import type { MessageKey } from "../../i18n/index.js";

interface AgentPanelProps {
  projectId: string;
  projectName: string;
  refreshKey: number;
  blocked: boolean;
  onBusyChange: (busy: boolean) => void;
  onFilesChanged: () => Promise<void>;
  t: (key: MessageKey) => string;
}
export function AgentPanel({
  projectId,
  projectName,
  refreshKey,
  blocked,
  onBusyChange,
  onFilesChanged,
  t,
}: AgentPanelProps): JSX.Element {
  const [state, setState] = useState<AgentState>({ running: false });
  const [prompt, setPrompt] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(300_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [restore, setRestore] = useState<TaskRestoreResult>();
  const [loaded, setLoaded] = useState(false);
  const callbacks = useRef({ onBusyChange, onFilesChanged });
  useEffect(() => {
    callbacks.current = { onBusyChange, onFilesChanged };
  }, [onBusyChange, onFilesChanged]);
  const running = useRef(false);
  const operation = useRef(false);
  const api = window.authorCopilot.assistant.agent;
  const refreshing = useRef<Promise<void> | undefined>(undefined);
  const refresh = useCallback((): Promise<void> => {
    if (refreshing.current !== undefined) return refreshing.current;
    const pending = (async () => {
      const response = await api.getState({ projectId });
      if (!response.ok) throw new Error(response.error.message);
      if (running.current && !response.state.running)
        await callbacks.current.onFilesChanged();
      running.current = response.state.running;
      callbacks.current.onBusyChange(
        response.state.running || operation.current,
      );
      setState(response.state);
      setLoaded(true);
    })();
    refreshing.current = pending;
    void pending
      .finally(() => {
        refreshing.current = undefined;
      })
      .catch(() => undefined);
    return pending;
  }, [api, projectId]);
  useEffect(() => {
    let current = true;
    let refreshing = false;
    const load = (): void => {
      if (refreshing || !current || operation.current) return;
      refreshing = true;
      void refresh()
        .catch((reason: unknown) => {
          if (current)
            setError(
              reason instanceof Error ? reason.message : t("errorGeneric"),
            );
        })
        .finally(() => {
          refreshing = false;
        });
    };
    const unsubscribe = api.onEvent((event) => {
      if (event.projectId !== projectId) return;
      if (
        event.type === "agent.task.progress" ||
        event.type === "agent.task.started"
      ) {
        running.current = true;
        callbacks.current.onBusyChange(true);
        setState((previous) => ({
          ...previous,
          running: true,
          taskId: event.taskId,
          event,
        }));
      } else load();
    });
    load();
    // Also reconcile missed events and a task whose renderer was reloaded.
    const timer = setInterval(() => {
      if (running.current) load();
    }, 1500);
    return () => {
      current = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [api, projectId, refresh, refreshKey, t]);

  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    callbacks.current.onBusyChange(true);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorGeneric"));
    } finally {
      operation.current = false;
      try {
        await refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("errorGeneric"));
      }
      callbacks.current.onBusyChange(running.current);
      setBusy(false);
    }
  };
  const start = (): void => {
    if (
      !authorized ||
      blocked ||
      state.taskId !== undefined ||
      prompt.trim() === ""
    )
      return;
    setAuthorized(false);
    setRestore(undefined);
    void perform(async () => {
      const response = await api.start({
        projectId,
        prompt,
        timeoutMs,
        readableFileTypes: ["markdown"],
        writableFileTypes: ["markdown"],
        allowedTools: [...AgentToolNameSchema.options],
      });
      if (!response.ok) throw new Error(response.error.message);
      running.current = true;
      setState({ running: true, taskId: response.capability.taskId });
    });
  };
  const terminal = state.event;
  return (
    <section className="ai-context-section space-y-3" data-testid="agent-panel">
      <h3>{t("agentTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t("agentDescription")}</p>
      {state.taskId === undefined ? (
        <>
          <label className="block">
            {t("agentPrompt")}
            <textarea
              className="mt-2 min-h-24 w-full rounded border p-2"
              data-testid="agent-prompt"
              value={prompt}
              disabled={busy || !loaded}
              onChange={(event) => {
                setPrompt(event.target.value);
                setAuthorized(false);
              }}
            />
          </label>
          <p className="text-sm">
            {projectName} · {t("agentScope")}
          </p>
          <label>
            {t("agentTimeout")}{" "}
            <select
              aria-label={t("agentTimeout")}
              value={timeoutMs}
              disabled={busy}
              onChange={(event) => {
                setTimeoutMs(Number(event.target.value));
                setAuthorized(false);
              }}
            >
              <option value={60_000}>1 {t("agentMinutes")}</option>
              <option value={300_000}>5 {t("agentMinutes")}</option>
              <option value={900_000}>15 {t("agentMinutes")}</option>
            </select>
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="agent-authorize"
              checked={authorized}
              disabled={busy}
              onChange={(event) => setAuthorized(event.target.checked)}
            />
            {t("agentAuthorize")}
          </label>
          <button
            className="button primary"
            data-testid="agent-start"
            disabled={
              !loaded || busy || blocked || !authorized || prompt.trim() === ""
            }
            onClick={start}
          >
            {t("agentStart")}
          </button>
          {blocked ? <p>{t("agentSaveFirst")}</p> : null}
        </>
      ) : null}
      {state.running ? (
        <div role="status">
          <p>
            {t("agentRunning")}{" "}
            {terminal?.type === "agent.task.progress"
              ? t(
                  (
                    {
                      initializing: "agentInitializing",
                      running: "agentWorking",
                      responding: "agentResponding",
                      tool: "agentTool",
                      finalizing: "agentFinalizing",
                    } as const
                  )[terminal.phase],
                )
              : ""}
          </p>
          <button
            className="button secondary"
            data-testid="agent-cancel"
            disabled={busy || state.taskId === undefined}
            onClick={() => {
              void perform(async () => {
                if (state.taskId !== undefined)
                  await api.cancel({ projectId, taskId: state.taskId });
              });
            }}
          >
            {t("agentCancel")}
          </button>
        </div>
      ) : null}
      {!state.running && state.taskId !== undefined ? (
        <>
          <p role="status" data-testid="agent-outcome">
            {terminal?.type === "agent.task.completed"
              ? t("agentCompleted")
              : terminal?.type === "agent.task.cancelled"
                ? terminal.reason === "timeout"
                  ? t("agentTimedOut")
                  : t("agentCancelled")
                : terminal?.type === "agent.task.failed"
                  ? t("agentFailed")
                  : t("agentInterrupted")}
          </p>
          {terminal?.type === "agent.task.completed" ? (
            <>
              <p className="whitespace-pre-wrap">{terminal.summary}</p>
              {terminal.permissionDenialCount > 0 ? (
                <p>
                  {t("agentDenied")} {terminal.permissionDenialCount}
                </p>
              ) : null}
            </>
          ) : null}
          {terminal?.type === "agent.task.failed" ? (
            <p role="alert">{terminal.error.message}</p>
          ) : null}
          {state.review?.files.map((file) => (
            <details key={file.path} className="rounded border p-2" open>
              <summary>{file.path}</summary>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <strong>{t("agentBefore")}</strong>
                  <pre
                    className="max-h-72 overflow-auto whitespace-pre-wrap"
                    data-testid="agent-before"
                  >
                    {file.before ?? t("agentMissingFile")}
                  </pre>
                </div>
                <div>
                  <strong>{t("agentAfter")}</strong>
                  <pre
                    className="max-h-72 overflow-auto whitespace-pre-wrap"
                    data-testid="agent-after"
                  >
                    {file.after ?? t("agentMissingFile")}
                  </pre>
                </div>
              </div>
              {file.truncated ? <p>{t("agentPreviewTruncated")}</p> : null}
            </details>
          ))}
          {state.review?.files.length === 0 ? (
            <p>{t("agentNoChanges")}</p>
          ) : null}
          <p className="text-sm">{t("agentKeepDescription")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              className="button primary"
              data-testid="agent-retain"
              disabled={busy || blocked || state.review === undefined}
              onClick={() => {
                void perform(async () => {
                  if (state.taskId === undefined || state.review === undefined)
                    return;
                  const result = await api.retain({
                    projectId,
                    taskId: state.taskId,
                    reviewDigest: state.review.reviewDigest,
                  });
                  if (!result.ok) throw new Error(result.error.message);
                  await callbacks.current.onFilesChanged();
                  setNotice(t("agentRetained"));
                });
              }}
            >
              {state.versionError === undefined
                ? t("agentRetain")
                : t("agentRetryVersion")}
            </button>
            <button
              className="button secondary"
              data-testid="agent-restore"
              disabled={busy || blocked}
              onClick={() => {
                void perform(async () => {
                  if (state.taskId === undefined) return;
                  const result =
                    await window.authorCopilot.taskRecovery.restore({
                      projectId,
                      taskId: state.taskId,
                    });
                  if (!result.ok) throw new Error(result.error.message);
                  setRestore(result.result);
                  await callbacks.current.onFilesChanged();
                  if (result.result.status === "complete")
                    setNotice(t("agentRestored"));
                });
              }}
            >
              {t("agentRestore")}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                void perform(refresh);
              }}
            >
              {t("agentRefresh")}
            </button>
          </div>
          {blocked ? <p>{t("agentSaveFirst")}</p> : null}
          {state.versionError !== undefined ? (
            <p role="alert">
              {t("agentVersionFailed")} {state.versionError.message}
            </p>
          ) : null}
        </>
      ) : null}
      {restore !== undefined && restore.status !== "complete" ? (
        <div role="alert">
          <p>{t("agentRestoreConflict")}</p>
          {restore.conflicts.map((conflict, index) => (
            <p key={index}>
              {conflict.path ?? projectName}:{" "}
              {t(
                (
                  {
                    head_changed: "agentHeadChanged",
                    index_entry_changed: "agentIndexChanged",
                    overlapping_user_edit: "agentOverlappingEdit",
                    binary_concurrent_change: "agentBinaryChanged",
                    create_delete_concurrent_change: "agentFileChanged",
                  } as const
                )[conflict.reason],
              )}
            </p>
          ))}
          {restore.failures.map((failure) => (
            <p key={failure.path}>
              {failure.path}: {failure.message}
            </p>
          ))}
        </div>
      ) : null}
      {error !== undefined ? <p role="alert">{error}</p> : null}
      {notice !== undefined ? <p role="status">{notice}</p> : null}
    </section>
  );
}
