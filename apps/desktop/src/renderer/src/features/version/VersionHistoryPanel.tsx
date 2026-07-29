import { useEffect, useMemo, useState, type JSX } from "react";
import {
  AlertCircle,
  FileCode2,
  GitCommitHorizontal,
  History,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

import type { MessageKey } from "../../i18n/index.js";
import { errorMessage } from "../project/project-api.js";
import {
  getVersionApi,
  type VersionDiff,
  type VersionSummary,
} from "./version-api.js";

interface VersionHistoryPanelProps {
  readonly projectId: string;
  readonly refreshKey: number;
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
  const apiAvailable = window.authorCopilot.version !== undefined;

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
              setHistoryError(undefined);
              setReloadKey((value) => value + 1);
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
