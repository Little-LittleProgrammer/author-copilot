import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import {
  AlignLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Redo2,
  Search,
  Type,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import type { AiContextSelection } from "@author-copilot/contracts";
import type { MessageKey } from "../../i18n/index.js";
import { FindReplaceWindow } from "./FindReplaceWindow.js";
import { findTextMatches, formatManuscript } from "./editor-text.js";
import { useWritingStatistics } from "./use-writing-statistics.js";
import { countWritingCharacters } from "./writing-statistics.js";

interface WritingEditorProps {
  readonly content: string;
  readonly documentPath: string | undefined;
  readonly projectId: string | undefined;
  readonly readOnly: boolean;
  readonly loading: boolean;
  readonly assistantOpen: boolean;
  readonly onChange: (content: string) => void;
  readonly onSelectionChange: (
    selection: AiContextSelection | undefined,
  ) => void;
  readonly onHistory: () => void;
  readonly onToggleAssistant: () => void;
  readonly onSave: () => void;
  readonly children: ReactNode;
  readonly t: (key: MessageKey) => string;
}

const families = {
  sans: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Songti SC", "Noto Serif SC", serif',
  mono: 'Menlo, "Noto Sans Mono", monospace',
};
interface FontSettings {
  family: keyof typeof families;
  size: number;
  lineHeight: number;
}
function loadFont(): FontSettings {
  const fallback: FontSettings = { family: "sans", size: 18, lineHeight: 1.9 };
  try {
    const value = JSON.parse(
      localStorage.getItem("author-copilot.editor-font") ?? "null",
    ) as Partial<FontSettings> | null;
    if (
      value &&
      (value.family === "sans" ||
        value.family === "serif" ||
        value.family === "mono") &&
      typeof value.size === "number" &&
      value.size >= 14 &&
      value.size <= 28 &&
      typeof value.lineHeight === "number" &&
      value.lineHeight >= 1.4 &&
      value.lineHeight <= 2.6
    )
      return value as FontSettings;
  } catch {
    /* Use defaults when local preferences are unavailable. */
  }
  return fallback;
}

export function WritingEditor({
  content,
  documentPath,
  projectId,
  readOnly,
  loading,
  assistantOpen,
  onChange,
  onSelectionChange,
  onHistory,
  onToggleAssistant,
  onSave,
  children,
  t,
}: WritingEditorProps): JSX.Element {
  const editor = useRef<HTMLTextAreaElement>(null);
  const compositionStart = useRef<string | undefined>(undefined);
  const findInput = useRef<HTMLInputElement>(null);
  const [font, setFont] = useState(loadFont);
  const [fontOpen, setFontOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [history, setHistory] = useState({
    path: documentPath,
    value: content,
    past: [] as string[],
    future: [] as string[],
  });
  const writingStats = useWritingStatistics(projectId);
  const lastCountedContent = useRef(content);
  // A document switch or external reload/discard starts a new undo history.
  if (history.path !== documentPath || history.value !== content) {
    setHistory({ path: documentPath, value: content, past: [], future: [] });
    lastCountedContent.current = content;
    compositionStart.current = undefined;
  }
  useEffect(() => {
    writingStats.tracker.rate.reset();
  }, [documentPath, readOnly, writingStats.tracker]);
  useEffect(() => {
    try {
      localStorage.setItem("author-copilot.editor-font", JSON.stringify(font));
    } catch {
      /* Preferences remain usable in memory. */
    }
  }, [font]);
  const disabled = readOnly || documentPath === undefined;
  const wordCount = useMemo(() => countWritingCharacters(content), [content]);
  const matches = useMemo(
    () => findTextMatches(content, query),
    [content, query],
  );
  const match = Math.min(activeMatch, Math.max(0, matches.length - 1));
  function select(start: number, end = start): void {
    requestAnimationFrame(() => {
      const target = editor.current;
      if (target === null) return;
      target.focus();
      target.setSelectionRange(start, end);
      // Measure wrapped lines with the same typography so distant matches become visible.
      const style = getComputedStyle(target);
      const mirror = window.document.createElement("div");
      Object.assign(mirror.style, {
        position: "fixed",
        visibility: "hidden",
        pointerEvents: "none",
        top: "0",
        left: "0",
        width: `${target.clientWidth}px`,
        boxSizing: "border-box",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        font: style.font,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        padding: style.padding,
        tabSize: style.tabSize,
      });
      mirror.textContent = target.value.slice(0, start);
      const marker = window.document.createElement("span");
      marker.textContent = target.value.slice(start, start + 1) || "\u200b";
      mirror.append(marker);
      window.document.body.append(mirror);
      const top = marker.offsetTop;
      if (
        top < target.scrollTop ||
        top >
          target.scrollTop + target.clientHeight - parseFloat(style.lineHeight)
      ) {
        target.scrollTop = Math.max(0, top - target.clientHeight / 2);
      }
      mirror.remove();
    });
  }
  function edit(value: string, cursor?: number, typing = false): void {
    if (
      disabled ||
      value === content ||
      (compositionStart.current === undefined &&
        value === lastCountedContent.current)
    )
      return;
    setHistory({
      path: documentPath,
      value,
      past:
        compositionStart.current === undefined
          ? [...history.past.slice(-99), content]
          : history.past,
      future: [],
    });
    onChange(value);
    if (compositionStart.current === undefined) recordEdit(value, typing);
    onSelectionChange(undefined);
    if (cursor !== undefined) select(cursor);
  }
  function recordEdit(value: string, typing = false): void {
    writingStats.tracker.record(lastCountedContent.current, value, typing);
    lastCountedContent.current = value;
  }
  function undo(redo = false): void {
    if (disabled) return;
    const source = redo ? history.future : history.past;
    const value = source.at(-1);
    if (value === undefined) return;
    setHistory({
      path: documentPath,
      value,
      past: redo ? [...history.past, content] : history.past.slice(0, -1),
      future: redo ? history.future.slice(0, -1) : [...history.future, content],
    });
    onChange(value);
    recordEdit(value);
    onSelectionChange(undefined);
    select(
      Math.min(editor.current?.selectionStart ?? value.length, value.length),
    );
  }
  function revealMatch(index: number): void {
    if (matches.length === 0) return;
    const next = (index + matches.length) % matches.length;
    setActiveMatch(next);
    const start = matches[next];
    if (start !== undefined) select(start, start + query.length);
  }
  function openSearch(): void {
    setSearchOpen(true);
    setFontOpen(false);
    const target = editor.current;
    if (target && target.selectionStart !== target.selectionEnd)
      setQuery(content.slice(target.selectionStart, target.selectionEnd));
    requestAnimationFrame(() => findInput.current?.focus());
  }
  return (
    <div className="writing-workspace">
      <div
        className="writing-toolbar"
        role="toolbar"
        aria-label={t("editorToolbar")}
      >
        <button
          type="button"
          aria-expanded={fontOpen}
          onClick={() => {
            setFontOpen(!fontOpen);
            setSearchOpen(false);
          }}
        >
          <Type size={16} />
          {t("editorFont")}
          <ChevronDown size={12} />
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          aria-label={t("editorUndo")}
          title={`${t("editorUndo")} (⌘/Ctrl+Z)`}
          disabled={disabled || history.past.length === 0}
          onClick={() => undo()}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          aria-label={t("editorRedo")}
          title={`${t("editorRedo")} (⌘/Ctrl+Shift+Z)`}
          disabled={disabled || history.future.length === 0}
          onClick={() => undo(true)}
        >
          <Redo2 size={16} />
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          disabled={disabled}
          title={t("editorFormatHint")}
          onClick={() => edit(formatManuscript(content))}
        >
          <AlignLeft size={16} />
          {t("editorFormat")}
        </button>
        <button
          type="button"
          aria-expanded={searchOpen}
          disabled={documentPath === undefined}
          onClick={() => (searchOpen ? setSearchOpen(false) : openSearch())}
        >
          <Search size={16} />
          {t("editorFindReplace")}
        </button>
        <button type="button" onClick={onHistory}>
          <History size={16} />
          {t("versionHistory")}
        </button>
        <button
          type="button"
          className="assistant-toggle"
          aria-expanded={assistantOpen}
          aria-controls="assistant-dock"
          onClick={onToggleAssistant}
        >
          <WandSparkles size={16} />
          {t("aiChat")}
        </button>
      </div>
      {fontOpen ? (
        <div className="editor-options" aria-label={t("editorFont")}>
          <label>
            {t("editorFont")}
            <select
              aria-label={t("editorFont")}
              value={font.family}
              onChange={(event) =>
                setFont({
                  ...font,
                  family: event.target.value as FontSettings["family"],
                })
              }
            >
              <option value="sans">{t("editorFontSans")}</option>
              <option value="serif">{t("editorFontSerif")}</option>
              <option value="mono">{t("editorFontMono")}</option>
            </select>
          </label>
          <label>
            {t("editorFontSize")}
            <select
              aria-label={t("editorFontSize")}
              value={font.size}
              onChange={(event) =>
                setFont({ ...font, size: Number(event.target.value) })
              }
            >
              {[14, 16, 18, 20, 22, 24, 28].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("editorLineHeight")}
            <select
              aria-label={t("editorLineHeight")}
              value={font.lineHeight}
              onChange={(event) =>
                setFont({ ...font, lineHeight: Number(event.target.value) })
              }
            >
              {[1.4, 1.6, 1.9, 2.2, 2.6].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label={t("close")}
            onClick={() => setFontOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      <FindReplaceWindow
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
          editor.current?.focus();
        }}
        t={t}
      >
        <div
          className="editor-find"
          role="search"
          aria-label={t("editorFindReplace")}
        >
          <div>
            <input
              ref={findInput}
              aria-label={t("editorFind")}
              placeholder={t("editorFind")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveMatch(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  revealMatch(match + (event.shiftKey ? -1 : 1));
                }
              }}
            />
            <span aria-live="polite">
              {matches.length
                ? `${match + 1} / ${matches.length}`
                : t("editorNoMatches")}
            </span>
            <button
              type="button"
              aria-label={t("editorPreviousMatch")}
              disabled={!matches.length}
              onClick={() => revealMatch(match - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label={t("editorNextMatch")}
              disabled={!matches.length}
              onClick={() => revealMatch(match + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div>
            <input
              aria-label={t("editorReplace")}
              placeholder={t("editorReplace")}
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
            />
            <button
              type="button"
              disabled={disabled || !matches.length}
              onClick={() => {
                const start = matches[match];
                if (start !== undefined)
                  edit(
                    content.slice(0, start) +
                      replacement +
                      content.slice(start + query.length),
                    start + replacement.length,
                  );
              }}
            >
              {t("editorReplace")}
            </button>
            <button
              type="button"
              disabled={disabled || !matches.length}
              onClick={() => edit(content.split(query).join(replacement))}
            >
              {t("editorReplaceAll")}
            </button>
          </div>
        </div>
      </FindReplaceWindow>
      <div className={`editor-split ${assistantOpen ? "with-assistant" : ""}`}>
        <section className="manuscript-pane" aria-label={t("content")}>
          {documentPath === undefined ? (
            <div className="empty-editor">
              <span className="empty-glyph" aria-hidden="true">
                ¶
              </span>
              <p>{loading ? t("loading") : t("documentEmpty")}</p>
            </div>
          ) : (
            <>
              <textarea
                ref={editor}
                className="manuscript-input"
                aria-label={t("content")}
                data-testid="document-editor"
                readOnly={readOnly}
                spellCheck
                value={content}
                placeholder={t("documentPlaceholder")}
                style={{
                  fontFamily: families[font.family],
                  fontSize: font.size,
                  lineHeight: font.lineHeight,
                }}
                onCompositionStart={() => {
                  compositionStart.current = content;
                }}
                onCompositionEnd={(event) => {
                  const before = compositionStart.current;
                  compositionStart.current = undefined;
                  if (
                    before === undefined ||
                    before === event.currentTarget.value ||
                    disabled
                  )
                    return;
                  const value = event.currentTarget.value;
                  setHistory((current) => ({
                    ...current,
                    value,
                    past: [...current.past.slice(-99), before],
                    future: [],
                  }));
                  onChange(value);
                  recordEdit(value, true);
                }}
                onChange={(event) => {
                  const inputType = (event.nativeEvent as InputEvent).inputType;
                  edit(
                    event.target.value,
                    undefined,
                    inputType === "insertText" ||
                      inputType === "insertCompositionText",
                  );
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Escape" &&
                    searchOpen &&
                    !event.nativeEvent.isComposing
                  ) {
                    setSearchOpen(false);
                    return;
                  }
                  if (
                    event.nativeEvent.isComposing ||
                    !(event.metaKey || event.ctrlKey)
                  )
                    return;
                  const key = event.key.toLowerCase();
                  if (key === "z" || key === "y") {
                    event.preventDefault();
                    undo(key === "y" || event.shiftKey);
                  }
                  if (key === "f" || key === "h") {
                    event.preventDefault();
                    openSearch();
                  }
                  if (key === "s") {
                    event.preventDefault();
                    onSave();
                  }
                }}
                onSelect={(event) => {
                  const target = event.currentTarget;
                  if (target.selectionStart === target.selectionEnd) {
                    onSelectionChange(undefined);
                    return;
                  }
                  onSelectionChange({
                    startLine: target.value
                      .slice(0, target.selectionStart)
                      .split("\n").length,
                    endLine: target.value
                      .slice(
                        0,
                        Math.max(
                          target.selectionStart,
                          target.selectionEnd - 1,
                        ),
                      )
                      .split("\n").length,
                  });
                }}
              />
              <footer className="manuscript-status">
                <span>
                  {t("editorWordCount")} {wordCount}
                </span>
                {projectId !== undefined ? (
                  <div
                    className="writing-statistics"
                    data-testid="writing-statistics"
                    data-state={
                      writingStats.failed
                        ? "failed"
                        : writingStats.pending
                          ? "pending"
                          : "saved"
                    }
                  >
                    <span title={t("todayWritingHint")}>
                      {t("todayWriting")}{" "}
                      <strong data-testid="writing-today">
                        {writingStats.today ?? "—"}
                      </strong>
                    </span>
                    <span title={t("writingRateHint")}>
                      {t("writingRate")}{" "}
                      <strong data-testid="writing-rate">
                        {writingStats.rate}
                      </strong>{" "}
                      {t("writingRateUnit")}
                    </span>
                    {writingStats.failed ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void writingStats.tracker.refresh()}
                        title={t("writingStatisticsFailed")}
                      >
                        {t("writingStatisticsRetry")}
                      </button>
                    ) : writingStats.pending ? (
                      <span
                        className="writing-statistics-pending"
                        title={t("writingStatisticsPending")}
                      >
                        ·
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <span>⌘ / Ctrl + S · {t("save")}</span>
              </footer>
            </>
          )}
        </section>
        {children}
      </div>
    </div>
  );
}
