import type { JSX } from "react";

import type { MessageKey } from "../../i18n/index.js";
import type { DocumentSnapshot, ProjectSummary } from "../project/types.js";

export type WorkspaceTab = "assistant" | "content" | "review";

interface EditorWorkspaceProps {
  readonly activeProject: ProjectSummary | undefined;
  readonly content: string;
  readonly document: DocumentSnapshot | undefined;
  readonly dirty: boolean;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly onChange: (content: string) => void;
  readonly onDiscard: () => void;
  readonly onReload: () => void;
  readonly onSave: () => void;
  readonly onTabChange: (tab: WorkspaceTab) => void;
  readonly saving: boolean;
  readonly tab: WorkspaceTab;
  readonly t: (key: MessageKey) => string;
}

export function EditorWorkspace(props: EditorWorkspaceProps): JSX.Element {
  const {
    activeProject,
    content,
    document,
    dirty,
    error,
    loading,
    onChange,
    onDiscard,
    onReload,
    onSave,
    onTabChange,
    saving,
    tab,
    t,
  } = props;
  const tabs: readonly { id: WorkspaceTab; label: MessageKey }[] = [
    { id: "content", label: "content" },
    { id: "assistant", label: "aiChat" },
    { id: "review", label: "changeReview" },
  ];
  return (
    <main className="editor-pane">
      <header className="editor-header">
        <div className="document-title">
          <span className="eyebrow">{activeProject?.name ?? t("editor")}</span>
          <h2>{document?.path.split(/[\\/]/).at(-1) ?? t("documentEmpty")}</h2>
        </div>
        <div className="editor-status" aria-live="polite">
          {dirty ? (
            <span className="dirty-indicator">{t("unsaved")}</span>
          ) : document !== undefined ? (
            <span>{t("saved")}</span>
          ) : null}
          {dirty ? (
            <button type="button" className="text-button" onClick={onDiscard}>
              {t("discard")}
            </button>
          ) : null}
          <button
            type="button"
            className="button primary save-button"
            data-testid="save-document"
            disabled={!dirty || saving || document === undefined}
            onClick={onSave}
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </header>

      <nav className="workspace-tabs" aria-label={t("editor")}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => onTabChange(id)}
          >
            {t(label)}
          </button>
        ))}
      </nav>

      {error !== undefined ? (
        <div className="editor-alert" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" onClick={onReload}>
            {t("reload")}
          </button>
        </div>
      ) : null}

      <section className="editor-body">
        {tab === "content" ? (
          document === undefined ? (
            <div className="empty-editor">
              <span className="empty-glyph" aria-hidden="true">
                ¶
              </span>
              <p>{loading ? t("loading") : t("documentEmpty")}</p>
            </div>
          ) : (
            <textarea
              aria-label={t("content")}
              data-testid="document-editor"
              spellCheck
              value={content}
              placeholder={t("documentPlaceholder")}
              onChange={(event) => onChange(event.target.value)}
            />
          )
        ) : (
          <div className="disabled-feature">
            <span className="eyebrow">MVP</span>
            <h3>{tab === "assistant" ? t("aiChat") : t("changeReview")}</h3>
            <p>
              {tab === "assistant"
                ? t("aiUnavailable")
                : t("changesUnavailable")}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
