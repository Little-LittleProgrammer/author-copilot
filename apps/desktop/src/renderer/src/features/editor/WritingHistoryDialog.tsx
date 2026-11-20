import { useEffect, useState, type JSX } from "react";
import type { WritingStatisticsHistory } from "@author-copilot/contracts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.js";
import type { MessageKey } from "../../i18n/index.js";
import {
  localWritingDay,
  type WritingStatisticsTracker,
} from "./writing-statistics.js";

type HistoryState =
  | { status: "loading" | "failed" }
  | { status: "ready"; history: WritingStatisticsHistory };

export function WritingHistoryDialog({
  projectId,
  tracker,
  onClose,
  onReturnFocus,
  t,
}: {
  readonly projectId: string;
  readonly tracker: WritingStatisticsTracker;
  readonly onClose: () => void;
  readonly onReturnFocus: () => void;
  readonly t: (key: MessageKey) => string;
}): JSX.Element {
  const endDay = localWritingDay(new Date());
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    endDay: string;
    revision: number;
    state: HistoryState;
  }>();
  const state: HistoryState =
    result?.endDay === endDay && result.revision === revision
      ? result.state
      : { status: "loading" };
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Include outstanding edits (also across midnight) before reading history.
        await tracker.refresh();
        const snapshot = tracker.snapshot();
        if (snapshot.failed || snapshot.pending)
          throw new Error("Statistics pending");
        const response = await window.authorCopilot.writingStatistics.history({
          projectId,
          endDay,
        });
        if (!response.ok) throw new Error("History unavailable");
        if (!cancelled)
          setResult({
            endDay,
            revision,
            state: { status: "ready", history: response.history },
          });
      } catch {
        if (!cancelled)
          setResult({ endDay, revision, state: { status: "failed" } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, endDay, tracker, revision]);

  const history = state.status === "ready" ? state.history : undefined;
  const scale = Math.max(
    1,
    ...(history?.days.map((day) => Math.abs(day.netCharacters)) ?? []),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="writing-history-dialog"
        closeLabel={`${t("close")} ${t("writingHistory")}`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogTitle>{t("writingHistory")}</DialogTitle>
        <DialogDescription>{t("writingHistoryHint")}</DialogDescription>
        <div
          className="writing-history-body"
          aria-busy={state.status === "loading"}
        >
          {history ? (
            <>
              <div className="writing-history-summary">
                <span>{t("writingHistoryTotal")}</span>
                <strong data-testid="writing-history-total">
                  {history.netCharacters}
                </strong>
              </div>
              <dl
                className="writing-history-chart"
                aria-label={t("writingHistoryDaily")}
              >
                {history.days.map(({ day, netCharacters }) => (
                  <div
                    className="writing-history-day"
                    key={day}
                    data-today={day === endDay}
                  >
                    <dt title={day}>
                      <time dateTime={day}>
                        {day.slice(5).replace("-", "/")}
                      </time>
                      <span className="writing-history-today">
                        {day === endDay ? t("writingHistoryToday") : "\u00a0"}
                      </span>
                    </dt>
                    <dd>
                      <strong data-testid={`writing-history-${day}`}>
                        {netCharacters}
                      </strong>
                      <div
                        className="writing-history-bar-track"
                        aria-hidden="true"
                      >
                        <span
                          className="writing-history-bar"
                          data-negative={netCharacters < 0}
                          style={{
                            height: `${(Math.abs(netCharacters) / scale) * 50}%`,
                          }}
                        />
                      </div>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="writing-history-note">
                {t(
                  history.days.every((day) => day.netCharacters === 0)
                    ? "writingHistoryEmpty"
                    : "writingHistoryNegative",
                )}
              </p>
            </>
          ) : state.status === "failed" ? (
            <p role="alert" className="writing-history-message">
              {t("writingHistoryFailed")}
            </p>
          ) : (
            <p role="status" className="writing-history-message">
              {t("writingHistoryLoading")}
            </p>
          )}
        </div>
        <div className="writing-history-actions">
          <button
            type="button"
            className="button secondary"
            disabled={state.status === "loading"}
            onClick={() => setRevision((value) => value + 1)}
          >
            {t(
              state.status === "failed"
                ? "writingStatisticsRetry"
                : "writingHistoryRefresh",
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
