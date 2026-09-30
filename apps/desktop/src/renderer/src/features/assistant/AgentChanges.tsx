import { useMemo, useState, type JSX } from "react";
import { Check, FileDiff, RotateCcw, X } from "lucide-react";
import type { AgentReview } from "@author-copilot/contracts";
import { createPortal } from "react-dom";
import type { MessageKey } from "../../i18n/index.js";
import { lineDiff, splitDiff } from "./line-diff.js";

export function AgentChanges({
  review,
  previewHost,
  previewPath: path,
  onPreviewPathChange: setPath,
  resolution,
  actionable,
  busy,
  onKeep,
  onUndo,
  t,
}: {
  review: AgentReview;
  previewHost: HTMLElement | null;
  previewPath: string | undefined;
  onPreviewPathChange: (path: string | undefined) => void;
  resolution: "kept" | "undone" | undefined;
  actionable: boolean;
  busy: boolean;
  onKeep: () => void;
  onUndo: () => void;
  t: (key: MessageKey) => string;
}): JSX.Element {
  const [split, setSplit] = useState(true);
  const file = review.files.find((entry) => entry.path === path);
  const lines = useMemo(
    () => (file ? lineDiff(file.before, file.after) : []),
    [file],
  );
  const splitRows = useMemo(() => splitDiff(lines), [lines]);
  const actions =
    actionable && !resolution ? (
      <div className="copilot-change-actions">
        <button
          type="button"
          disabled={busy}
          data-testid="agent-retain"
          onClick={onKeep}
        >
          <Check size={14} />
          {t("chatKeepAll")}
        </button>
        <button
          type="button"
          disabled={busy}
          data-testid="agent-restore"
          onClick={onUndo}
        >
          <RotateCcw size={14} />
          {t("chatUndoAll")}
        </button>
      </div>
    ) : null;
  return (
    <section className="copilot-changes" data-testid="agent-changes">
      <header>
        <strong>
          {review.files.length} {t("chatChangedFiles")}
        </strong>
        <span>
          {resolution
            ? t(resolution === "kept" ? "chatKept" : "chatUndone")
            : t(actionable ? "chatPendingReview" : "chatHistoricalPreview")}
        </span>
      </header>
      {review.files.map((entry) => (
        <button
          className="copilot-changed-file"
          type="button"
          key={entry.path}
          onClick={() => setPath(entry.path)}
          title={t("chatPreviewChanges")}
        >
          <FileDiff size={14} />
          <span>{entry.path}</span>
          <small>
            {entry.before === null ? "A" : entry.after === null ? "D" : "M"}
          </small>
        </button>
      ))}
      {review.files.length === 0 ? <p>{t("agentNoChanges")}</p> : null}
      {actions}
      {file && previewHost
        ? createPortal(
            <section
              className="copilot-diff-editor"
              data-testid="agent-diff-preview"
              aria-label={t("chatPreviewChanges")}
              onKeyDown={(event) => {
                if (event.key === "Escape") setPath(undefined);
              }}
            >
              <header className="copilot-diff-tab">
                <FileDiff size={15} />
                <strong>{file.path.split("/").at(-1)}</strong>
                <span>{t("chatPreviewChanges")}</span>
                <button
                  type="button"
                  aria-label={t("chatClosePreview")}
                  onClick={() => setPath(undefined)}
                >
                  <X size={16} />
                </button>
              </header>
              <div className="copilot-diff-toolbar">
                <select
                  aria-label={t("chatChangedFiles")}
                  value={path ?? ""}
                  onChange={(event) => setPath(event.target.value)}
                >
                  {review.files.map((entry) => (
                    <option key={entry.path} value={entry.path}>
                      {entry.path}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setSplit(!split)}>
                  {t(split ? "chatUnifiedDiff" : "chatSplitDiff")}
                </button>
              </div>
              {file?.truncated ? (
                <p role="status">{t("agentPreviewTruncated")}</p>
              ) : null}
              {file ? (
                split ? (
                  <div className="copilot-diff-scroll">
                    <div className="copilot-diff-split">
                      <header>{t("agentBefore")}</header>
                      <header>{t("agentAfter")}</header>
                      <div data-testid="agent-before">
                        {splitRows.map(({ left: line }, index) => (
                          <div
                            className={`copilot-diff-line ${!line ? "absent" : line.type === "remove" ? "removed" : ""}`}
                            key={index}
                          >
                            <small>{line?.before ?? ""}</small>
                            <code>{line?.text || " "}</code>
                          </div>
                        ))}
                      </div>
                      <div data-testid="agent-after">
                        {splitRows.map(({ right: line }, index) => (
                          <div
                            className={`copilot-diff-line ${!line ? "absent" : line.type === "add" ? "added" : ""}`}
                            key={index}
                          >
                            <small>{line?.after ?? ""}</small>
                            <code>{line?.text || " "}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="copilot-diff-scroll">
                    {lines.map((line, index) => (
                      <div
                        className={`copilot-diff-line ${line.type === "add" ? "added" : line.type === "remove" ? "removed" : ""}`}
                        key={index}
                      >
                        <small>{line.before ?? ""}</small>
                        <small>{line.after ?? ""}</small>
                        <code>
                          {line.type === "add"
                            ? "+"
                            : line.type === "remove"
                              ? "−"
                              : " "}{" "}
                          {line.text || " "}
                        </code>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
              <footer>
                <span>
                  {t(
                    resolution === "kept"
                      ? "chatKept"
                      : resolution === "undone"
                        ? "chatUndone"
                        : "chatWorkspacePreview",
                  )}
                </span>
                {actions}
              </footer>
            </section>,
            previewHost,
          )
        : null}
    </section>
  );
}
