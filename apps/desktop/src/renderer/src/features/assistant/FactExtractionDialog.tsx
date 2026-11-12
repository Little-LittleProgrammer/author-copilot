import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  FactCandidateSchema,
  type CreativeNote,
  type FactCandidate,
  type ProjectStructureNode,
} from "@author-copilot/contracts";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import type { MessageKey } from "../../i18n/index.js";
import { AiConnectionSelector } from "./AiSettingsDialog.js";

interface ReviewedCandidate {
  readonly fact: FactCandidate;
  readonly accepted: boolean;
}

/** Candidates stay in memory until the author explicitly confirms each fact. */
export function FactExtractionDialog({
  projectId,
  initialPath,
  onSaved,
  onClose,
  onDirtyChange,
  t,
}: {
  readonly projectId: string;
  readonly initialPath: string | undefined;
  readonly onSaved: (notes: readonly CreativeNote[]) => void;
  readonly onClose: () => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly t: (key: MessageKey) => string;
}): JSX.Element {
  const [documents, setDocuments] = useState<{ path: string; title: string }[]>(
    [],
  );
  const [path, setPath] = useState(initialPath ?? "");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<ReviewedCandidate[]>([]);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const requestId = useRef<string | undefined>(undefined);
  const hasWork = candidates.length > 0 || busy || saving;
  const accepted = candidates.filter((candidate) => candidate.accepted);
  const valid =
    accepted.length > 0 &&
    accepted.every(({ fact }) => FactCandidateSchema.safeParse(fact).success);

  useEffect(() => {
    onDirtyChange(hasWork);
  }, [hasWork, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (requestId.current)
        void window.authorCopilot.creativeNotes
          .cancelGeneration({ projectId, requestId: requestId.current })
          .catch(() => undefined);
      onDirtyChange(false);
    };
  }, [projectId, onDirtyChange]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await window.authorCopilot.project.getStructure({
        projectId,
      });
      if (!result.ok) throw new Error("structure");
      const entries: { path: string; title: string }[] = [];
      const collect = (
        nodes: readonly ProjectStructureNode[],
        parents: readonly string[] = [],
      ): void => {
        for (const node of nodes) {
          const titles = [...parents, node.displayName.replace(/^\d{4}-/u, "")];
          if (node.kind === "document")
            entries.push({
              path: node.relativePath,
              title: titles.join(" / "),
            });
          else collect(node.children, titles);
        }
      };
      collect(result.nodes);
      if (!mounted.current) return;
      setDocuments(entries);
      setPath((current) =>
        entries.some((entry) => entry.path === current) ? current : "",
      );
    } catch {
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const close = (): void => {
    if (saving || (hasWork && !window.confirm(t("creativeGenerateDiscard"))))
      return;
    onClose();
  };
  const generate = async (): Promise<void> => {
    if (busy || saving || loading || loadError || !path) return;
    if (candidates.length && !window.confirm(t("creativeGenerateRetryConfirm")))
      return;
    const id = crypto.randomUUID();
    requestId.current = id;
    setBusy(true);
    setError(undefined);
    setEmpty(false);
    try {
      const response = await window.authorCopilot.creativeNotes.generate({
        projectId,
        requestId: id,
        kind: "fact",
        instruction: t("factsDefaultInstruction"),
        locale: document.documentElement.lang === "en-US" ? "en-US" : "zh-CN",
        noteIds: [],
        documentPaths: [path],
      });
      if (!mounted.current) return;
      if (response.ok && "candidates" in response) {
        setCandidates(
          response.candidates.map((fact) => ({ fact, accepted: false })),
        );
        setEmpty(response.candidates.length === 0);
      } else if (response.ok) setError(t("factsInvalid"));
      else
        setError(
          t(
            response.error.code === "CANCELLED"
              ? "creativeGenerateStopped"
              : response.error.code === "TIMEOUT"
                ? "creativeGenerateTimeout"
                : response.error.code === "VALIDATION_FAILED"
                  ? "factsInvalid"
                  : response.error.code === "NOT_FOUND"
                    ? "creativeGenerateMissing"
                    : response.error.code === "CONFLICT"
                      ? "creativeNotesConflict"
                      : "creativeGenerateFailed",
          ),
        );
    } catch {
      if (mounted.current) setError(t("creativeGenerateFailed"));
    } finally {
      requestId.current = undefined;
      if (mounted.current) setBusy(false);
    }
  };
  const save = async (): Promise<void> => {
    if (!valid || busy || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await window.authorCopilot.creativeNotes.confirmFacts({
        projectId,
        facts: accepted.map(({ fact }) => fact),
      });
      if (!mounted.current) return;
      if (!result.ok) {
        setError(
          t(
            result.error === "conflict"
              ? "creativeNotesConflict"
              : "creativeNotesUnavailable",
          ),
        );
        return;
      }
      onSaved(result.notes);
      const savedIds = new Set(result.notes.map((note) => note.id));
      const remaining = candidates.filter(({ fact }) => !savedIds.has(fact.id));
      setCandidates(remaining);
      if (remaining.length === 0) onClose();
    } catch {
      if (mounted.current) setError(t("creativeNotesUnavailable"));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  const edit = (
    id: string,
    field: "title" | "content",
    value: string,
  ): void => {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.fact.id === id
          ? {
              ...candidate,
              accepted: false,
              fact: { ...candidate.fact, [field]: value },
            }
          : candidate,
      ),
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="creative-generation-dialog"
        closeLabel={t("close")}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("factsExtract")}</DialogTitle>
          <DialogDescription>{t("factsHint")}</DialogDescription>
        </DialogHeader>
        <div
          className="creative-generation-scroll"
          data-testid="fact-extraction-dialog"
        >
          {!busy && <AiConnectionSelector t={t} compact />}
          <label className="creative-generation-field">
            {t("chapterSummarySource")}
            <select
              data-testid="fact-source-select"
              disabled={busy || saving || loading || loadError}
              value={path}
              onChange={(event) => setPath(event.target.value)}
            >
              <option value="">{t("chapterSummarySelect")}</option>
              {documents.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
          {loadError ? (
            <p role="alert">{t("creativeNotesUnavailable")}</p>
          ) : null}
          <div className="creative-generation-actions">
            <Button
              disabled={busy || saving || loading || loadError || !path}
              onClick={() => void generate()}
            >
              {candidates.length
                ? t("creativeGenerateRetry")
                : t("factsExtract")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || saving || loading}
              onClick={() => void load()}
            >
              {t("creativeNotesReferenceRefresh")}
            </Button>
            {busy ? (
              <>
                <span role="status">{t("creativeGenerating")}</span>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (requestId.current)
                      void window.authorCopilot.creativeNotes
                        .cancelGeneration({
                          projectId,
                          requestId: requestId.current,
                        })
                        .catch(() => setError(t("creativeGenerateFailed")));
                  }}
                >
                  {t("creativeGenerateStop")}
                </Button>
              </>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="creative-notes-error">
              {error}
            </p>
          ) : null}
          {empty ? <p role="status">{t("factsEmpty")}</p> : null}
          {candidates.length ? <p>{t("factsReviewHint")}</p> : null}
          {candidates.map(({ fact, accepted: checked }) => (
            <fieldset
              key={fact.id}
              className="fact-candidate"
              data-testid="fact-candidate"
              disabled={busy || saving}
            >
              <legend>{t("factsCandidate")}</legend>
              <label>
                {t("creativeNotesTitleField")}
                <Input
                  value={fact.title}
                  maxLength={200}
                  onChange={(event) =>
                    edit(fact.id, "title", event.target.value)
                  }
                />
              </label>
              <label>
                {t("creativeNotesContent")}
                <Textarea
                  value={fact.content}
                  maxLength={4000}
                  onChange={(event) =>
                    edit(fact.id, "content", event.target.value)
                  }
                />
              </label>
              <small>
                {t("chapterSummarySource")}: {fact.source.relativePath}
              </small>
              <small>
                {t("chapterSummaryCaptured")}:{" "}
                {new Date(fact.source.capturedAt).toLocaleString()}
              </small>
              <div className="creative-generation-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setCandidates((current) =>
                        current.map((candidate) =>
                          candidate.fact.id === fact.id
                            ? { ...candidate, accepted: event.target.checked }
                            : candidate,
                        ),
                      );
                    }}
                  />{" "}
                  {t("factsAccept")}
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCandidates((current) =>
                      current.filter(
                        (candidate) => candidate.fact.id !== fact.id,
                      ),
                    )
                  }
                >
                  {t("factsReject")}
                </Button>
              </div>
            </fieldset>
          ))}
        </div>
        <div className="creative-generation-actions">
          <Button variant="outline" disabled={saving} onClick={close}>
            {t("creativeGenerateDiscardButton")}
          </Button>
          <Button
            disabled={!valid || busy || saving}
            onClick={() => void save()}
          >
            {saving ? t("saving") : `${t("factsSave")} (${accepted.length})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
