import { useMemo, useState, type JSX } from "react";
import {
  AI_CREATIVE_NOTES_MAX_COUNT,
  AI_CREATIVE_NOTE_MAX_CHARACTERS,
  type CreativeNote,
} from "@author-copilot/contracts";
import { NotebookPen, RefreshCw, X } from "lucide-react";
import type { MessageKey } from "../../i18n/index.js";
import { getCreativeNotesApi } from "./creative-notes-api.js";

interface CreativeNotePickerProps {
  readonly projectId: string;
  readonly selected: readonly CreativeNote[];
  readonly onChange: (notes: readonly CreativeNote[]) => void;
  readonly disabled: boolean;
  readonly t: (key: MessageKey) => string;
}

export function CreativeNotePicker({
  projectId,
  selected,
  onChange,
  disabled,
  t,
}: CreativeNotePickerProps): JSX.Element {
  const api = useMemo(() => getCreativeNotesApi(), []);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<readonly CreativeNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      setNotes(await api.list(projectId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="creative-note-picker" data-testid="creative-note-picker">
      <div className="creative-note-reference-chips">
        <button
          type="button"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => {
            if (!open) void load();
            setOpen(!open);
          }}
        >
          <NotebookPen size={14} />
          {t("creativeNotesReference")}
        </button>
        {selected.map((note) => (
          <span key={note.id} title={note.title}>
            <span>{note.title}</span>
            <button
              type="button"
              aria-label={`${t("creativeNotesRemoveReference")}: ${note.title}`}
              title={t("creativeNotesRemoveReference")}
              disabled={disabled}
              onClick={() =>
                onChange(selected.filter((item) => item.id !== note.id))
              }
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      {open ? (
        <div className="creative-note-reference-options" aria-busy={loading}>
          <header>
            <span>
              {selected.length} / {AI_CREATIVE_NOTES_MAX_COUNT}
            </span>
            <button
              type="button"
              aria-label={t("creativeNotesReferenceRefresh")}
              title={t("creativeNotesReferenceRefresh")}
              disabled={loading || disabled}
              onClick={() => void load()}
            >
              <RefreshCw size={14} />
            </button>
          </header>
          {error ? <p role="alert">{t("creativeNotesUnavailable")}</p> : null}
          {!loading && !error && notes.length === 0 ? (
            <p>{t("creativeNotesEmpty")}</p>
          ) : null}
          {notes.map((note) => {
            const checked = selected.some((item) => item.id === note.id);
            return (
              <label key={note.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={
                    disabled ||
                    loading ||
                    (!checked && selected.length >= AI_CREATIVE_NOTES_MAX_COUNT)
                  }
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((item) => item.id !== note.id)
                        : [...selected, note],
                    )
                  }
                />
                <span>{note.title}</span>
                {note.content.length > AI_CREATIVE_NOTE_MAX_CHARACTERS ? (
                  <small>{t("creativeNotesReferenceTruncated")}</small>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : null}
      {selected.some(
        (note) => note.content.length > AI_CREATIVE_NOTE_MAX_CHARACTERS,
      ) ? (
        <p className="creative-note-reference-warning">
          {t("creativeNotesReferenceLimit")}
        </p>
      ) : null}
    </div>
  );
}
