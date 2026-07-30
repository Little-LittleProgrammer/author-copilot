import { useEffect, useMemo, useState, type JSX } from "react";
import {
  AlertCircle,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  History,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";

import type { MessageKey } from "../../i18n/index.js";
import { errorMessage } from "../project/project-api.js";
import {
  getVersionApi,
  VersionApiError,
  type VersionBranchState,
  type VersionDiff,
  type VersionSummary,
} from "./version-api.js";
import {
  getTaskRecoveryApi,
  type TaskRecoverySummary,
  type TaskRestoreResult,
} from "./task-recovery-api.js";

interface VersionHistoryPanelProps {
  readonly projectId: string;
  readonly refreshKey: number;
  readonly dirty: boolean;
  readonly onRepositoryChanged: () => void;
  readonly t: (key: MessageKey) => string;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(document.documentElement.lang, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-meta";
  if (line.startsWith("+")) return "diff-addition";
  if (line.startsWith("-")) return "diff-deletion";
  if (line.startsWith("@@") || line.startsWith("diff ")) return "diff-meta";
  return "";
}

export function VersionHistoryPanel({
  projectId,
  refreshKey,
  dirty,
  onRepositoryChanged,
  t,
}: VersionHistoryPanelProps): JSX.Element {
  const [versions, setVersions] = useState<readonly VersionSummary[]>([]);
  const [selectedCommitId, setSelectedCommitId] = useState<string>();
  const [diff, setDiff] = useState<VersionDiff>();
  const [historyLoading, setHistoryLoading] = useState(
    () => window.authorCopilot.version !== undefined,
  );
  const [diffLoading, setDiffLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [diffError, setDiffError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [diffRequestKey, setDiffRequestKey] = useState(0);
  const [recoveries, setRecoveries] = useState<readonly TaskRecoverySummary[]>(
    [],
  );
  const [recoveryError, setRecoveryError] = useState<string>();
  const [restoreResult, setRestoreResult] = useState<TaskRestoreResult>();
  const [recoveryReloadKey, setRecoveryReloadKey] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const apiAvailable = window.authorCopilot.version !== undefined;
  const [branchState, setBranchState] = useState<VersionBranchState>({
    branches: [],
    currentBranch: null,
  });
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(apiAvailable);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [branchError, setBranchError] = useState<string>();
  const [branchNotice, setBranchNotice] = useState<string>();
  const [branchReloadKey, setBranchReloadKey] = useState(0);

  useEffect(() => {
    const api = getTaskRecoveryApi();
    let current = true;
    if (api === undefined) return () => undefined;
    void api
      .list(projectId)
      .then((nextRecoveries) => {
        if (!current) return;
        setRecoveries(nextRecoveries);
        setRecoveryError(undefined);
      })
      .catch((reason: unknown) => {
        if (current) {
          setRecoveryError(errorMessage(reason, t("taskRecoveryLoadFailed")));
        }
      });
    return () => {
      current = false;
    };
  }, [projectId, recoveryReloadKey, t]);

  const activeRecovery = recoveries[0];

  useEffect(() => {
    const api = getVersionApi();
    let current = true;
    if (api === undefined) return () => undefined;
    void api
      .listBranches(projectId)
      .then((state) => {
        if (!current) return;
        setBranchState(state);
        setSelectedBranch(state.currentBranch ?? state.branches[0]?.name ?? "");
        setBranchError(undefined);
      })
      .catch((reason: unknown) => {
        if (current) {
          setBranchError(errorMessage(reason, t("branchLoadFailed")));
        }
      })
      .finally(() => {
        if (current) setBranchesLoading(false);
      });
    return () => {
      current = false;
    };
  }, [branchReloadKey, projectId, refreshKey, t]);

  const switchBranch = (): void => {
    const api = getVersionApi();
    if (
      api === undefined ||
      selectedBranch.length === 0 ||
      selectedBranch === branchState.currentBranch ||
      activeRecovery !== undefined ||
      dirty ||
      branchSwitching
    ) {
      return;
    }
    setBranchSwitching(true);
    setBranchError(undefined);
    setBranchNotice(undefined);
    void api
      .switchBranch(projectId, selectedBranch)
      .then((result) => {
        setBranchNotice(
          result.switched ? t("branchSwitched") : t("branchAlreadyCurrent"),
        );
        setBranchState((state) => ({
          currentBranch: result.branchName,
          branches: state.branches.map((branch) => ({
            ...branch,
            current: branch.name === result.branchName,
          })),
        }));
        onRepositoryChanged();
        setHistoryLoading(true);
        setReloadKey((value) => value + 1);
        setRecoveryReloadKey((value) => value + 1);
      })
      .catch((reason: unknown) => {
        setBranchError(
          reason instanceof VersionApiError &&
            (reason.code === "dirty_repository" ||
              reason.code === "task_active")
            ? reason.code === "task_active"
              ? t("branchRecoveryFirst")
              : t("branchDirtyRepository")
            : errorMessage(reason, t("branchSwitchFailed")),
        );
      })
      .finally(() => setBranchSwitching(false));
  };

  const restoreTask = (): void => {
    const api = getTaskRecoveryApi();
    if (
      api === undefined ||
      activeRecovery === undefined ||
      dirty ||
      restoring ||
      !window.confirm(t("taskRecoveryConfirm"))
    ) {
      return;
    }
    setRestoring(true);
    setRecoveryError(undefined);
    setRestoreResult(undefined);
    void api
      .restore(projectId, activeRecovery.taskId)
      .then((result) => {
        setRestoreResult(result);
        onRepositoryChanged();
        setRecoveryReloadKey((value) => value + 1);
      })
      .catch((reason: unknown) => {
        setRecoveryError(errorMessage(reason, t("taskRecoveryFailed")));
      })
      .finally(() => setRestoring(false));
  };

  useEffect(() => {
    const api = getVersionApi();
    let current = true;
    if (api === undefined) {
      return () => {
        current = false;
      };
    }
    void api
      .list({ projectId })
      .then((nextVersions) => {
        if (!current) return;
        const nextCommitId = nextVersions[0]?.commitId;
        setHistoryError(undefined);
        setVersions(nextVersions);
        setSelectedCommitId(nextCommitId);
        setDiff(undefined);
        setDiffError(undefined);
        setDiffLoading(nextCommitId !== undefined);
        if (nextCommitId !== undefined) {
          setDiffRequestKey((value) => value + 1);
        }
      })
      .catch((reason: unknown) => {
        if (current) {
          setHistoryError(errorMessage(reason, t("versionHistoryFailed")));
        }
      })
      .finally(() => {
        if (current) setHistoryLoading(false);
      });
    return () => {
      current = false;
    };
  }, [projectId, refreshKey, reloadKey, t]);

  useEffect(() => {
    const api = getVersionApi();
    let current = true;
    if (selectedCommitId === undefined || api === undefined) {
      return () => {
        current = false;
      };
    }
    void api
      .diff({ projectId, commitId: selectedCommitId })
      .then((nextDiff) => {
        if (current) {
          setDiffError(undefined);
          setDiff(nextDiff);
        }
      })
      .catch((reason: unknown) => {
        if (current) {
          setDiffError(errorMessage(reason, t("versionDiffFailed")));
        }
      })
      .finally(() => {
        if (current) setDiffLoading(false);
      });
    return () => {
      current = false;
    };
  }, [diffRequestKey, projectId, selectedCommitId, t]);

  const selectedVersion = versions.find(
    (version) => version.commitId === selectedCommitId,
  );
  const totals = useMemo(
    () =>
      diff?.files.reduce(
        (value, file) => ({
          additions: value.additions + (file.additions ?? 0),
          deletions: value.deletions + (file.deletions ?? 0),
        }),
        { additions: 0, deletions: 0 },
      ) ?? { additions: 0, deletions: 0 },
    [diff],
  );

  return (
    <section
      className="version-review"
      aria-label={t("changeReview")}
      data-testid="version-history"
    >
      <div className="version-review-statuses">
        <div className="version-branch-bar" data-testid="branch-switcher">
          <div className="version-branch-label">
            <GitBranch size={16} aria-hidden="true" />
            <label htmlFor={`branch-${projectId}`}>{t("branch")}</label>
          </div>
          <select
            id={`branch-${projectId}`}
            value={selectedBranch}
            disabled={
              branchesLoading ||
              branchSwitching ||
              dirty ||
              activeRecovery !== undefined ||
              branchState.branches.length === 0
            }
            onChange={(event) => {
              setSelectedBranch(event.target.value);
              setBranchError(undefined);
              setBranchNotice(undefined);
            }}
          >
            {branchState.branches.length === 0 ? (
              <option value="">{t("branchUnavailable")}</option>
            ) : (
              branchState.branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="button version-branch-action"
            disabled={
              selectedBranch.length === 0 ||
              selectedBranch === branchState.currentBranch ||
              branchSwitching ||
              dirty ||
              activeRecovery !== undefined
            }
            title={
              dirty
                ? t("branchSaveFirst")
                : activeRecovery !== undefined
                  ? t("branchRecoveryFirst")
                  : t("branchSwitch")
            }
            onClick={switchBranch}
          >
            {branchSwitching ? (
              <LoaderCircle className="spin" size={14} aria-hidden="true" />
            ) : (
              <GitBranch size={14} aria-hidden="true" />
            )}
            {branchSwitching ? t("branchSwitching") : t("branchSwitch")}
          </button>
          <span
            className={
              branchError === undefined
                ? "branch-notice"
                : "branch-notice error"
            }
            role={branchError === undefined ? "status" : "alert"}
          >
            {branchError ?? branchNotice}
          </span>
        </div>
        {activeRecovery !== undefined ||
        recoveryError !== undefined ||
        restoreResult !== undefined ? (
          <div
            className={
              restoreResult?.status === "complete"
                ? "task-recovery-banner complete"
                : "task-recovery-banner"
            }
            role={recoveryError === undefined ? "status" : "alert"}
            data-testid="task-recovery"
          >
            <ShieldAlert size={18} aria-hidden="true" />
            <div className="task-recovery-copy">
              <strong>
                {restoreResult?.status === "complete"
                  ? t("taskRecoveryComplete")
                  : restoreResult?.status === "blocked"
                    ? t("taskRecoveryBlocked")
                    : restoreResult?.status === "partial"
                      ? t("taskRecoveryPartial")
                      : t("taskRecoveryTitle")}
              </strong>
              <span>
                {recoveryError ??
                  (restoreResult === undefined
                    ? `${activeRecovery?.affectedPaths.length ?? 0} ${t("taskRecoveryFiles")}`
                    : `${restoreResult.restoredPaths.length} ${t("taskRecoveryRestoredFiles")}`)}
              </span>
              {restoreResult !== undefined &&
              restoreResult.conflicts.length > 0 ? (
                <small>
                  {restoreResult.conflicts
                    .map(
                      (conflict) =>
                        conflict.path ?? t("taskRecoveryRepository"),
                    )
                    .slice(0, 3)
                    .join(" · ")}
                </small>
              ) : null}
            </div>
            {restoreResult?.status === "complete" ? (
              <button
                type="button"
                className="task-recovery-dismiss"
                aria-label={t("close")}
                title={t("close")}
                onClick={() => setRestoreResult(undefined)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            ) : activeRecovery !== undefined ? (
              <button
                type="button"
                className="button task-recovery-action"
                disabled={dirty || restoring}
                title={
                  dirty ? t("taskRecoverySaveFirst") : t("taskRecoveryRestore")
                }
                onClick={restoreTask}
              >
                {restoring ? (
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                ) : (
                  <RotateCcw size={14} aria-hidden="true" />
                )}
                {restoring
                  ? t("taskRecoveryRestoring")
                  : t("taskRecoveryRestore")}
              </button>
            ) : (
              <button
                type="button"
                className="button task-recovery-action"
                onClick={() => setRecoveryReloadKey((value) => value + 1)}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {t("reload")}
              </button>
            )}
          </div>
        ) : null}
      </div>
      <aside className="version-history-pane">
        <header className="version-pane-header">
          <div>
            <History size={16} aria-hidden="true" />
            <h3>{t("versionHistory")}</h3>
            <span>{versions.length}</span>
          </div>
          <button
            type="button"
            className="version-refresh"
            aria-label={t("versionRefresh")}
            title={t("versionRefresh")}
            onClick={() => {
              setHistoryLoading(true);
              setBranchesLoading(true);
              setHistoryError(undefined);
              setReloadKey((value) => value + 1);
              setBranchReloadKey((value) => value + 1);
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="version-history-list">
          {historyLoading ? (
            <div className="version-state">
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
              <span>{t("loading")}</span>
            </div>
          ) : !apiAvailable || historyError !== undefined ? (
            <div className="version-state error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>
                {apiAvailable ? historyError : t("versionApiUnavailable")}
              </span>
            </div>
          ) : versions.length === 0 ? (
            <div className="version-state">
              <GitCommitHorizontal size={20} aria-hidden="true" />
              <span>{t("versionHistoryEmpty")}</span>
            </div>
          ) : (
            versions.map((version) => (
              <button
                key={version.commitId}
                type="button"
                className={
                  version.commitId === selectedCommitId
                    ? "version-history-item active"
                    : "version-history-item"
                }
                aria-pressed={version.commitId === selectedCommitId}
                data-testid="version-history-item"
                onClick={() => {
                  if (version.commitId === selectedCommitId) return;
                  setDiff(undefined);
                  setDiffError(undefined);
                  setDiffLoading(true);
                  setSelectedCommitId(version.commitId);
                }}
              >
                <span className="version-message">
                  {version.message || t("versionUntitled")}
                </span>
                <span className="version-meta">
                  <code>{version.shortCommitId}</code>
                  <time dateTime={version.createdAt}>
                    {formatDate(version.createdAt)}
                  </time>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="version-diff-pane">
        {diffLoading ? (
          <div className="version-state">
            <LoaderCircle className="spin" size={20} aria-hidden="true" />
            <span>{t("loading")}</span>
          </div>
        ) : diffError !== undefined ? (
          <div className="version-state error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <span>{diffError}</span>
          </div>
        ) : diff === undefined || selectedVersion === undefined ? (
          <div className="version-state">
            <FileCode2 size={22} aria-hidden="true" />
            <span>{t("versionDiffEmpty")}</span>
          </div>
        ) : (
          <>
            <header className="version-diff-header">
              <div>
                <h3>{selectedVersion.message || t("versionUntitled")}</h3>
                <code>{selectedVersion.shortCommitId}</code>
              </div>
              <div
                className="version-diff-totals"
                aria-label={t("versionFiles")}
              >
                <span>
                  {diff.files.length} {t("versionFiles")}
                </span>
                <strong className="addition">+{totals.additions}</strong>
                <strong className="deletion">-{totals.deletions}</strong>
              </div>
            </header>
            <ul className="version-file-list">
              {diff.files.map((file) => (
                <li key={file.path}>
                  <FileCode2 size={13} aria-hidden="true" />
                  <span title={file.path}>{file.path}</span>
                  {file.binary ? (
                    <small>{t("versionBinary")}</small>
                  ) : (
                    <small>
                      <strong className="addition">+{file.additions}</strong>
                      <strong className="deletion">-{file.deletions}</strong>
                    </small>
                  )}
                </li>
              ))}
            </ul>
            <pre className="version-patch" data-testid="version-diff">
              {diff.patch.length === 0
                ? t("versionDiffEmpty")
                : diff.patch.split("\n").map((line, index) => (
                    <span
                      key={`${index}-${line}`}
                      className={diffLineClass(line)}
                    >
                      {line}
                      {"\n"}
                    </span>
                  ))}
            </pre>
          </>
        )}
      </div>
    </section>
  );
}
