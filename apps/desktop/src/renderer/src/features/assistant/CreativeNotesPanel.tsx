import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import {
  BookOpen,
  Lightbulb,
  NotebookPen,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import type { CreativeNote, CreativeNoteKind } from "@author-copilot/contracts";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import type { MessageKey } from "../../i18n/index.js";
import {
  CreativeNotesApiError,
  getCreativeNotesApi,
} from "./creative-notes-api.js";

type NoteFilter = CreativeNoteKind | "all";

interface CreativeNotesPanelProps {
  readonly projectId: string;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly t: (key: MessageKey) => string;
}

const kinds: readonly CreativeNoteKind[] = ["outline", "inspiration", "note"];
const kindLabels: Readonly<Record<CreativeNoteKind, MessageKey>> = {
  outline: "creativeNotesKindOutline",
  inspiration: "creativeNotesKindInspiration",
  note: "creativeNotesKindNote",
};

export function CreativeNotesPanel({
  projectId,
  onDirtyChange,
  t,
}: CreativeNotesPanelProps): JSX.Element {
  const api = useMemo(() => getCreativeNotesApi(), []);
  const [notes, setNotes] = useState<readonly CreativeNote[]>([]);
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [kind, setKind] = useState<CreativeNoteKind>("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [baseline, setBaseline] = useState({
    kind: "note" as CreativeNoteKind,
    title: "",
    content: "",
  });
  const dirty =
    kind !== baseline.kind ||
    title !== baseline.title ||
    content !== baseline.content;

  useEffect(() => {
    onDirtyChange(dirty || saving);
  }, [dirty, saving, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setNotes(await api.list(projectId));
      setError(undefined);
    } catch {
      setError(t("creativeNotesUnavailable"));
    } finally {
      setLoading(false);
    }
  }, [api, projectId, t]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialRefresh);
  }, [projectId, refresh]);

  const visibleNotes = notes.filter(
    (note) => filter === "all" || note.kind === filter,
  );
  const selected =
    selectedId === undefined
      ? undefined
      : notes.find((note) => note.id === selectedId);

  const select = (note: CreativeNote): void => {
    if (saving || (dirty && !window.confirm(t("creativeNotesDiscardConfirm"))))
      return;
    setSelectedId(note.id);
    setKind(note.kind);
    setTitle(note.title);
    setContent(note.content);
    setBaseline({ kind: note.kind, title: note.title, content: note.content });
    setError(undefined);
  };

  const create = (): void => {
    if (saving || (dirty && !window.confirm(t("creativeNotesDiscardConfirm"))))
      return;
    reset();
  };

  const reset = (): void => {
    setSelectedId(undefined);
    setKind(filter === "all" ? "note" : filter);
    setTitle("");
    setContent("");
    setBaseline({
      kind: filter === "all" ? "note" : filter,
      title: "",
      content: "",
    });
    setError(undefined);
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (title.trim().length === 0 || saving) return;
    setSaving(true);
    try {
      const note = selected
        ? await api.update({
            projectId,
            noteId: selected.id,
            expectedUpdatedAt: selected.updatedAt,
            kind,
            title,
            content,
          })
        : await api.create({ projectId, kind, title, content });
      setNotes((current) => [
        note,
        ...current.filter((entry) => entry.id !== note.id),
      ]);
      setSelectedId(note.id);
      setKind(note.kind);
      setTitle(note.title);
      setContent(note.content);
      setBaseline({
        kind: note.kind,
        title: note.title,
        content: note.content,
      });
      setError(undefined);
    } catch (reason) {
      setError(
        reason instanceof CreativeNotesApiError && reason.code === "conflict"
          ? t("creativeNotesConflict")
          : t("creativeNotesUnavailable"),
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (
      selected === undefined ||
      saving ||
      !window.confirm(t("creativeNotesDeleteConfirm"))
    )
      return;
    setSaving(true);
    try {
      await api.delete({ projectId, noteId: selected.id });
      setNotes((current) => current.filter((note) => note.id !== selected.id));
      reset();
    } catch {
      setError(t("creativeNotesUnavailable"));
    } finally {
      setSaving(false);
    }
  };

  const reload = async (): Promise<void> => {
    if (saving || (dirty && !window.confirm(t("creativeNotesDiscardConfirm"))))
      return;
    setSaving(true);
    try {
      const fresh = await api.list(projectId);
      setNotes(fresh);
      const note = fresh.find((item) => item.id === selectedId);
      if (note) {
        setKind(note.kind);
        setTitle(note.title);
        setContent(note.content);
        setBaseline({
          kind: note.kind,
          title: note.title,
          content: note.content,
        });
        setError(undefined);
      } else reset();
    } catch {
      setError(t("creativeNotesUnavailable"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="creative-notes-panel" data-testid="creative-notes-panel">
      <header className="creative-notes-header">
        <div>
          <NotebookPen size={18} aria-hidden="true" />
          <div>
            <h3>{t("creativeNotesTitle")}</h3>
            <span>{t("creativeNotesHint")}</span>
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title={t("creativeNotesReferenceRefresh")}
          aria-label={t("creativeNotesReferenceRefresh")}
          disabled={saving || loading}
          onClick={() => void reload()}
        >
          <RefreshCw size={16} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title={t("creativeNotesNew")}
          aria-label={t("creativeNotesNew")}
          onClick={create}
          disabled={saving || loading}
        >
          <Plus size={16} />
        </Button>
      </header>
      <div
        className="creative-notes-filters"
        role="tablist"
        aria-label={t("creativeNotesFilter")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          onClick={() => setFilter("all")}
        >
          {t("creativeNotesAll")}
        </button>
        {kinds.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={filter === entry}
            onClick={() => setFilter(entry)}
          >
            {t(kindLabels[entry])}
          </button>
        ))}
      </div>
      {error !== undefined ? (
        <p className="creative-notes-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="creative-notes-body">
        <div className="creative-notes-list" aria-busy={loading}>
          {visibleNotes.length === 0 && !loading ? (
            <p className="creative-notes-empty">{t("creativeNotesEmpty")}</p>
          ) : null}
          {visibleNotes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`creative-note-item${note.id === selectedId ? " active" : ""}`}
              onClick={() => select(note)}
              disabled={saving}
            >
              <span>{note.title}</span>
              <small>{t(kindLabels[note.kind])}</small>
            </button>
          ))}
        </div>
        <form
          className="creative-notes-editor"
          onSubmit={(event) => void save(event)}
        >
          <label>
            <span>{t("creativeNotesType")}</span>
            <select
              value={kind}
              disabled={saving || loading}
              onChange={(event) =>
                setKind(event.target.value as CreativeNoteKind)
              }
            >
              {kinds.map((entry) => (
                <option key={entry} value={entry}>
                  {t(kindLabels[entry])}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("creativeNotesTitleField")}</span>
            <Input
              value={title}
              disabled={saving || loading}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("creativeNotesTitlePlaceholder")}
            />
          </label>
          <label className="creative-notes-content-field">
            <span>{t("creativeNotesContent")}</span>
            <Textarea
              value={content}
              disabled={saving || loading}
              maxLength={100_000}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t("creativeNotesContentPlaceholder")}
            />
          </label>
          <div className="creative-notes-actions">
            {selected !== undefined ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void remove()}
                disabled={saving}
              >
                <Trash2 size={14} />
                {t("delete")}
              </Button>
            ) : null}
            <Button
              type="submit"
              size="sm"
              disabled={saving || title.trim().length === 0}
            >
              <Save size={14} />
              {saving ? t("saving") : t("creativeNotesSave")}
            </Button>
          </div>
        </form>
      </div>
      <div className="creative-notes-kind-icons" aria-hidden="true">
        <BookOpen size={12} />
        <Lightbulb size={12} />
        <NotebookPen size={12} />
      </div>
    </div>
  );
}
