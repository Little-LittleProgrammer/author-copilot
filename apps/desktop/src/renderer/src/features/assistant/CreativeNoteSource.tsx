import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { CreativeNote } from "@author-copilot/contracts";
import { Button } from "@/components/ui/button.js";
import type { MessageKey } from "../../i18n/index.js";

/** Freshness is checked on selection, window focus and an explicit refresh. */
export function CreativeNoteSource({
  projectId,
  note,
  onOpenSource,
  t,
}: {
  readonly projectId: string;
  readonly note: CreativeNote;
  readonly onOpenSource: (relativePath: string) => void;
  readonly t: (key: MessageKey) => string;
}): JSX.Element | null {
  const [status, setStatus] = useState<
    "current" | "changed" | "missing" | "unavailable"
  >();
  const [checking, setChecking] = useState(true);
  const alive = useRef(true);
  const revision = useRef({ value: 0 });
  const check = useCallback(async (): Promise<void> => {
    const current = ++revision.current.value;
    const isActive = (): boolean =>
      alive.current && revision.current.value === current;
    setChecking(true);
    try {
      const response = await window.authorCopilot.creativeNotes.sourceStatus({
        projectId,
        noteId: note.id,
      });
      if (isActive()) setStatus(response.ok ? response.status : "unavailable");
    } catch {
      if (isActive()) setStatus("unavailable");
    } finally {
      if (isActive()) setChecking(false);
    }
  }, [projectId, note.id]);

  useEffect(() => {
    alive.current = true;
    const counter = revision.current;
    const refresh = (): void => {
      void check();
    };
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener("focus", refresh);
    return () => {
      alive.current = false;
      counter.value++;
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [check, note.updatedAt]);

  if (!note.source) return null;
  const labels = {
    current: "chapterSummaryCurrent",
    changed:
      note.kind === "fact" ? "factsSourceChanged" : "chapterSummaryChanged",
    missing:
      note.kind === "fact" ? "factsSourceMissing" : "chapterSummaryMissing",
    unavailable: "chapterSummaryUnavailable",
  } as const;
  return (
    <section
      className="chapter-summary-source"
      data-testid={
        note.kind === "fact" ? "fact-source" : "chapter-summary-source"
      }
    >
      <span>
        {t("chapterSummarySource")}: {note.source.relativePath}
      </span>
      <small>
        {t("chapterSummaryCaptured")}:{" "}
        {new Date(note.source.capturedAt).toLocaleString()}
      </small>
      <p role="status">
        {checking ? t("loading") : status ? t(labels[status]) : ""}
      </p>
      <div className="creative-generation-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => void check()}
        >
          {t("chapterSummaryCheck")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={
            status === "missing" || status === "unavailable" || checking
          }
          onClick={() => onOpenSource(note.source!.relativePath)}
        >
          {t("chapterSummaryOpen")}
        </Button>
      </div>
    </section>
  );
}
