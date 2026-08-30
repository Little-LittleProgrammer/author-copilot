import type { JSX } from "react";
import type { AiPatchReview } from "@author-copilot/contracts";
import { Check, FilePenLine, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button.js";
import type { MessageKey } from "../../i18n/index.js";

interface ChangeReviewPanelProps {
  readonly acceptedChangeIds: ReadonlySet<string>;
  readonly applying: boolean;
  readonly applyError: string | undefined;
  readonly onAcceptAll: () => void;
  readonly onApply: () => void;
  readonly onRejectProposal: () => void;
  readonly onToggleChange: (changeId: string) => void;
  readonly onToggleFile: (relativePath: string) => void;
  readonly review: AiPatchReview;
  readonly t: (key: MessageKey) => string;
}

function diffLineClass(line: string): string {
  if (line.startsWith("+")) return "diff-addition";
  if (line.startsWith("-")) return "diff-deletion";
  return "diff-meta";
}

export function ChangeReviewPanel({
  acceptedChangeIds,
  applying,
  applyError,
  onAcceptAll,
  onApply,
  onRejectProposal,
  onToggleChange,
  onToggleFile,
  review,
  t,
}: ChangeReviewPanelProps): JSX.Element {
  const total = review.files.reduce(
    (count, file) => count + file.changes.length,
    0,
  );
  return (
    <section className="proposal-review" data-testid="proposal-review">
      <header className="proposal-review-header">
        <div>
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <h3>{review.summary}</h3>
            <p>{t("changeReviewPendingNotice")}</p>
          </div>
        </div>
        <div className="proposal-review-actions">
          <span data-testid="proposal-accepted-count">
            {acceptedChangeIds.size}/{total} {t("changeReviewAccepted")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAcceptAll}
            disabled={applying}
          >
            <Check size={13} />
            {t("changeReviewAll")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={applying || acceptedChangeIds.size === 0}
            data-testid="proposal-apply"
            onClick={onApply}
          >
            <Check size={13} />
            {t(applying ? "aiProposalApplying" : "aiProposalApply")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={applying}
            onClick={onRejectProposal}
          >
            <X size={13} />
            {t("changeReviewClear")}
          </Button>
        </div>
      </header>

      {applyError !== undefined ? (
        <p className="proposal-apply-error" role="alert">
          {applyError}
        </p>
      ) : null}

      <div className="proposal-files">
        {review.files.map((file) => {
          const acceptedCount = file.changes.filter((change) =>
            acceptedChangeIds.has(change.changeId),
          ).length;
          const allAccepted = acceptedCount === file.changes.length;
          return (
            <article className="proposal-file" key={file.relativePath}>
              <header>
                <div>
                  <FilePenLine size={16} aria-hidden="true" />
                  <code>{file.relativePath}</code>
                  <span>
                    {acceptedCount}/{file.changes.length}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={applying}
                  onClick={() => onToggleFile(file.relativePath)}
                >
                  {allAccepted
                    ? t("changeReviewFileReject")
                    : t("changeReviewFileAccept")}
                </Button>
              </header>
              <div className="proposal-changes">
                {file.changes.map((change) => {
                  const accepted = acceptedChangeIds.has(change.changeId);
                  return (
                    <section
                      className={`proposal-change${accepted ? " accepted" : " rejected"}`}
                      data-testid={`proposal-change-${change.changeId}`}
                      key={change.changeId}
                    >
                      <header>
                        <code>{change.changeId}</code>
                        <button
                          type="button"
                          aria-pressed={accepted}
                          disabled={applying}
                          onClick={() => onToggleChange(change.changeId)}
                        >
                          {accepted ? <Check size={13} /> : <X size={13} />}
                          {accepted
                            ? t("changeReviewAccepted")
                            : t("changeReviewRejected")}
                        </button>
                      </header>
                      <pre className="proposal-patch">
                        {change.patch.split("\n").map((line, index) => (
                          <span
                            className={diffLineClass(line)}
                            key={`${change.changeId}:${index}`}
                          >
                            {line || " "}
                          </span>
                        ))}
                      </pre>
                    </section>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
