import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  CREATIVE_GENERATION_MAX_DOCUMENTS,
  type CreativeNote,
  type CreativeNoteDraft,
  type CreativeNoteKind,
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
import {
  getCreativeNotesApi,
  CreativeNotesApiError,
} from "./creative-notes-api.js";
import { lineDiff } from "./line-diff.js";

const noteKindLabels = {
  outline: "creativeNotesKindOutline",
  inspiration: "creativeNotesKindInspiration",
  note: "creativeNotesKindNote",
} as const;

const kindLabels = {
  outline: "creativeGenerateOutline",
  inspiration: "creativeGenerateInspiration",
  note: "creativeGenerateNote",
} as const;

export function CreativeNoteGenerationDialog({
  projectId,
  selected,
  onSaved,
  onClose,
  onDirtyChange,
  t,
}: {
  readonly projectId: string;
  readonly selected: CreativeNote | undefined;
  readonly onSaved: (note: CreativeNote) => void;
  readonly onClose: () => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly t: (key: MessageKey) => string;
}): JSX.Element {
  const api = useMemo(() => getCreativeNotesApi(), []);
  const [kind, setKind] = useState<CreativeNoteKind>(
    selected?.kind ?? "outline",
  );
  const [instruction, setInstruction] = useState("");
  const [replace, setReplace] = useState(Boolean(selected));
  const [references, setReferences] = useState<readonly CreativeNote[]>([]);
  const [documents, setDocuments] = useState<{ path: string; title: string }[]>(
    [],
  );
  const [noteIds, setNoteIds] = useState<string[]>([]);
  const [documentPaths, setDocumentPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<CreativeNoteDraft>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const requestId = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const hasWork = Boolean(draft || instruction.trim() || busy || saving);

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
      const [notes, structure] = await Promise.all([
        api.list(projectId),
        window.authorCopilot.project.getStructure({ projectId }),
      ]);
      if (!structure.ok) throw new Error("structure");
      if (!mounted.current) return;
      const chapters: { path: string; title: string }[] = [];
      const collect = (
        nodes: readonly ProjectStructureNode[],
        ancestors: readonly string[] = [],
      ): void => {
        for (const node of nodes) {
          const name = node.displayName.replace(/^\d{4}-/u, "");
          const titles = [...ancestors, name];
          if (node.kind === "document")
            chapters.push({
              path: node.relativePath,
              title: titles.join(" / "),
            });
          else collect(node.children, titles);
        }
      };
      collect(structure.nodes);
      setReferences(notes);
      setDocuments(chapters);
      setNoteIds((current) =>
        current.filter((id) => notes.some((note) => note.id === id)),
      );
      setDocumentPaths((current) =>
        current.filter((path) =>
          chapters.some((chapter) => chapter.path === path),
        ),
      );
    } catch {
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [api, projectId]);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  const close = (): void => {
    if (saving || (hasWork && !window.confirm(t("creativeGenerateDiscard"))))
      return;
    onClose();
  };
  const generate = async (): Promise<void> => {
    if (busy || saving || loading || loadError || !instruction.trim()) return;
    if (draft && !window.confirm(t("creativeGenerateRetryConfirm"))) return;
    const id = crypto.randomUUID();
    requestId.current = id;
    setBusy(true);
    setError(undefined);
    try {
      const response = await window.authorCopilot.creativeNotes.generate({
        projectId,
        requestId: id,
        kind,
        instruction,
        locale: document.documentElement.lang === "en-US" ? "en-US" : "zh-CN",
        noteIds:
          replace && selected
            ? noteIds.filter((noteId) => noteId !== selected.id)
            : noteIds,
        documentPaths,
        ...(replace && selected
          ? {
              target: {
                noteId: selected.id,
                expectedUpdatedAt: selected.updatedAt,
              },
            }
          : {}),
      });
      if (!mounted.current) return;
      if (response.ok) setDraft(response.draft);
      else
        setError(
          t(
            response.error.code === "CONFLICT"
              ? "creativeNotesConflict"
              : response.error.code === "CANCELLED"
                ? "creativeGenerateStopped"
                : response.error.code === "VALIDATION_FAILED"
                  ? "creativeGenerateInvalid"
                  : response.error.code === "NOT_FOUND"
                    ? "creativeGenerateMissing"
                    : response.error.code === "TIMEOUT"
                      ? "creativeGenerateTimeout"
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
    if (
      !draft ||
      busy ||
      saving ||
      !draft.title.trim() ||
      !draft.content.trim()
    )
      return;
    setSaving(true);
    setError(undefined);
    try {
      const note =
        replace && selected
          ? await api.update({
              projectId,
              noteId: selected.id,
              expectedUpdatedAt: selected.updatedAt,
              ...draft,
            })
          : await api.create({ projectId, ...draft });
      if (!mounted.current) return;
      onSaved(note);
      onClose();
    } catch (reason) {
      if (mounted.current)
        setError(
          t(
            reason instanceof CreativeNotesApiError &&
              (reason.code === "conflict" || reason.code === "not_found")
              ? "creativeNotesConflict"
              : "creativeNotesUnavailable",
          ),
        );
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  const diff = useMemo(
    () =>
      selected && draft && replace
        ? lineDiff(
            `${t(noteKindLabels[selected.kind])}\n${selected.title}\n\n${selected.content}`,
            `${t(noteKindLabels[draft.kind])}\n${draft.title}\n\n${draft.content}`,
          )
        : [],
    [selected, draft, replace, t],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="creative-generation-dialog"
        closeLabel={t("close")}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("creativeGenerateTitle")}</DialogTitle>
          <DialogDescription>{t("creativeGenerateHint")}</DialogDescription>
        </DialogHeader>
        <div
          className="creative-generation-scroll"
          data-testid="creative-generation-dialog"
        >
          <div className="creative-generation-fields">
            <label>
              {t("creativeNotesType")}
              <select
                data-testid="generation-kind"
                disabled={busy || saving}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as CreativeNoteKind);
                  if (draft)
                    setDraft({
                      ...draft,
                      kind: event.target.value as CreativeNoteKind,
                    });
                }}
              >
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            {selected ? (
              <label>
                {t("creativeGenerateDestination")}
                <select
                  disabled={busy || saving}
                  value={replace ? "replace" : "new"}
                  onChange={(event) =>
                    setReplace(event.target.value === "replace")
                  }
                >
                  <option value="replace">
                    {t("creativeGenerateReplace")}: {selected.title}
                  </option>
                  <option value="new">{t("creativeGenerateSaveNew")}</option>
                </select>
              </label>
            ) : null}
          </div>
          {!busy && <AiConnectionSelector t={t} compact />}
          <label className="creative-generation-field">
            {t("creativeGenerateInstruction")}
            <Textarea
              data-testid="generation-instruction"
              value={instruction}
              maxLength={4000}
              disabled={busy || saving}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={t("creativeGeneratePlaceholder")}
            />
          </label>
          <details>
            <summary>
              {t("creativeGenerateReferences")} ·{" "}
              {noteIds.length + documentPaths.length}
            </summary>
            <p className="text-sm text-muted-foreground">
              {t("creativeGenerateReferenceHint")}
            </p>
            {loading ? <p role="status">{t("loading")}</p> : null}
            {loadError ? (
              <p role="alert">{t("creativeNotesUnavailable")}</p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || saving || loading}
              onClick={() => void load()}
            >
              {t("creativeNotesReferenceRefresh")}
            </Button>
            <fieldset
              disabled={busy || saving || loading || loadError}
              className="creative-generation-references"
            >
              <legend>
                {t("creativeNotesTitle")} ({noteIds.length}/6)
              </legend>
              {references
                .filter((note) => !replace || note.id !== selected?.id)
                .map((note) => (
                  <label key={note.id}>
                    <input
                      type="checkbox"
                      checked={noteIds.includes(note.id)}
                      disabled={
                        !noteIds.includes(note.id) && noteIds.length >= 6
                      }
                      onChange={(event) =>
                        setNoteIds(
                          event.target.checked
                            ? [...noteIds, note.id]
                            : noteIds.filter((id) => id !== note.id),
                        )
                      }
                    />
                    {note.title}
                  </label>
                ))}
            </fieldset>
            <fieldset
              disabled={busy || saving || loading || loadError}
              className="creative-generation-references"
            >
              <legend>
                {t("creativeGenerateChapters")} ({documentPaths.length}/
                {CREATIVE_GENERATION_MAX_DOCUMENTS})
              </legend>
              {documents.map((entry) => (
                <label key={entry.path}>
                  <input
                    type="checkbox"
                    checked={documentPaths.includes(entry.path)}
                    disabled={
                      !documentPaths.includes(entry.path) &&
                      documentPaths.length >= CREATIVE_GENERATION_MAX_DOCUMENTS
                    }
                    onChange={(event) =>
                      setDocumentPaths(
                        event.target.checked
                          ? [...documentPaths, entry.path]
                          : documentPaths.filter((path) => path !== entry.path),
                      )
                    }
                  />
                  {entry.title}
                </label>
              ))}
            </fieldset>
          </details>
          <div className="creative-generation-actions">
            <Button
              type="button"
              disabled={
                busy || saving || loading || loadError || !instruction.trim()
              }
              onClick={() => void generate()}
            >
              {draft ? t("creativeGenerateRetry") : t("creativeGenerateStart")}
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
          {draft ? (
            <section
              className="creative-generation-preview"
              aria-label={t("creativeGeneratePreview")}
            >
              <h3>{t("creativeGeneratePreview")}</h3>
              <label className="creative-generation-field">
                {t("creativeNotesTitleField")}
                <Input
                  data-testid="generation-title"
                  value={draft.title}
                  maxLength={200}
                  disabled={busy || saving}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                />
              </label>
              <label className="creative-generation-field">
                {t("creativeNotesContent")}
                <Textarea
                  data-testid="generation-content"
                  value={draft.content}
                  maxLength={100_000}
                  disabled={busy || saving}
                  onChange={(event) =>
                    setDraft({ ...draft, content: event.target.value })
                  }
                />
              </label>
              {replace && selected ? (
                <details open>
                  <summary>{t("creativeGenerateDiff")}</summary>
                  <div
                    className="creative-generation-diff"
                    data-testid="generation-diff"
                  >
                    {diff.slice(0, 300).map((line, index) => (
                      <div
                        key={index}
                        className={`copilot-diff-line ${line.type === "add" ? "added" : line.type === "remove" ? "removed" : ""}`}
                      >
                        <small>
                          {line.type === "add"
                            ? "+"
                            : line.type === "remove"
                              ? "−"
                              : " "}
                        </small>
                        <code>{line.text || " "}</code>
                      </div>
                    ))}
                  </div>
                  {diff.length > 300 ? (
                    <p>{t("creativeGenerateDiffLimit")}</p>
                  ) : null}
                </details>
              ) : null}
              <div className="creative-generation-actions">
                <Button
                  disabled={
                    busy ||
                    saving ||
                    !draft.title.trim() ||
                    !draft.content.trim()
                  }
                  onClick={() => void save()}
                >
                  {saving
                    ? t("saving")
                    : replace
                      ? t("creativeGenerateConfirmReplace")
                      : t("creativeGenerateConfirmSave")}
                </Button>
              </div>
            </section>
          ) : null}
          <Button variant="ghost" disabled={saving} onClick={close}>
            {t("creativeGenerateDiscardButton")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
