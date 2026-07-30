import type { JSX } from "react";
import { Button } from "@/components/ui/button.js";
import type { MessageKey } from "../../i18n/index.js";
import { KnowledgePanel } from "../assistant/KnowledgePanel.js";
import type {
  DocumentSnapshot,
  ProjectSummary,
  StructureNode,
} from "../project/types.js";
import { VersionHistoryPanel } from "../version/VersionHistoryPanel.js";

export type WorkspaceTab = "assistant" | "content" | "review";

interface EditorWorkspaceProps {
  readonly activeProject: ProjectSummary | undefined;
  readonly aiContext: readonly StructureNode[];
  readonly content: string;
  readonly document: DocumentSnapshot | undefined;
  readonly dirty: boolean;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly onChange: (content: string) => void;
  readonly onDiscard: () => void;
  readonly onCreateVersion: () => void;
  readonly onReload: () => void;
  readonly onOpenKnowledgeSource: (relativePath: string) => void;
  readonly onRecoveryRestored: () => void;
  readonly onSave: () => void;
  readonly onTabChange: (tab: WorkspaceTab) => void;
  readonly saving: boolean;
  readonly tab: WorkspaceTab;
  readonly t: (key: MessageKey) => string;
  readonly versionNotice: string | undefined;
  readonly versionRefreshKey: number;
}

export function EditorWorkspace(props: EditorWorkspaceProps): JSX.Element {
  const {
    activeProject,
    aiContext,
    content,
    document,
    dirty,
    error,
    loading,
    onChange,
    onDiscard,
    onCreateVersion,
    onReload,
    onOpenKnowledgeSource,
    onRecoveryRestored,
    onSave,
    onTabChange,
    saving,
    tab,
    t,
    versionNotice,
    versionRefreshKey,
  } = props;
  const tabs: readonly { id: WorkspaceTab; label: MessageKey }[] = [
    { id: "content", label: "content" },
    { id: "assistant", label: "aiChat" },
    { id: "review", label: "changeReview" },
  ];
  const roleLabels: Readonly<Record<StructureNode["role"], MessageKey>> = {
    act: "structureRoleAct",
    chapter: "structureRoleChapter",
    scene: "structureRoleDocument",
    unclassified: "structureRoleDocument",
    volume: "structureRoleVolume",
  };
  const documentName = document?.path
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.md$/iu, "");
  return (
    <main className="editor-pane">
      <header className="editor-header">
        <div className="document-title">
          <span className="eyebrow">{activeProject?.name ?? t("editor")}</span>
          <h2>{documentName ?? t("documentEmpty")}</h2>
        </div>
        <div className="editor-status" aria-live="polite">
          {versionNotice !== undefined ? (
            <span className="max-w-40 overflow-hidden text-ellipsis whitespace-nowrap text-primary">
              {versionNotice}
            </span>
          ) : dirty ? (
            <span className="dirty-indicator">{t("unsaved")}</span>
          ) : document !== undefined ? (
            <span>{t("saved")}</span>
          ) : null}
          {dirty ? (
            <button type="button" className="text-button" onClick={onDiscard}>
              {t("discard")}
            </button>
          ) : null}
          <Button
            type="button"
            className="h-8 min-w-[78px] text-xs"
            variant="outline"
            size="sm"
            data-testid="save-version"
            disabled={activeProject === undefined || dirty || saving}
            title={dirty ? t("versionSaveDocumentFirst") : t("saveVersion")}
            onClick={onCreateVersion}
          >
            {t("saveVersion")}
          </Button>
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
        ) : tab === "assistant" ? (
          <div className="assistant-workspace">
            {activeProject === undefined ? null : (
              <KnowledgePanel
                onOpenSource={onOpenKnowledgeSource}
                projectId={activeProject.id}
                t={t}
              />
            )}
            <section className="ai-context-section" aria-label={t("aiContext")}>
              <div className="ai-context-heading">
                <strong>{t("aiContext")}</strong>
                <span>{aiContext.length}</span>
              </div>
              {aiContext.length === 0 ? (
                <p>{t("aiContextEmpty")}</p>
              ) : (
                <ul className="ai-context-list">
                  {aiContext.map((node) => (
                    <li key={node.path}>
                      <span>{node.name}</span>
                      <small>{t(roleLabels[node.role])}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : activeProject === undefined ? null : (
          <VersionHistoryPanel
            dirty={dirty}
            onRepositoryChanged={onRecoveryRestored}
            projectId={activeProject.id}
            refreshKey={versionRefreshKey}
            t={t}
          />
        )}
      </section>
    </main>
  );
}
