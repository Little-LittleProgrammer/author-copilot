import type { JSX } from "react";
import type {
  AiContextSelection,
  AiPatchReview,
} from "@author-copilot/contracts";
import { Button } from "@/components/ui/button.js";
import type { MessageKey } from "../../i18n/index.js";
import { KnowledgePanel } from "../assistant/KnowledgePanel.js";
import { ChatPanel } from "../assistant/ChatPanel.js";
import { ChangeReviewPanel } from "../change-review/ChangeReviewPanel.js";
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
  readonly onAcceptAllProposalChanges: () => void;
  readonly onApplyProposal: () => void;
  readonly onDiscard: () => void;
  readonly onCreateVersion: () => void;
  readonly onReload: () => void;
  readonly onOpenKnowledgeSource: (relativePath: string) => void;
  readonly onProposalReady: (review: AiPatchReview) => void;
  readonly onRejectProposal: () => void;
  readonly onRecoveryRestored: () => void;
  readonly onSave: () => void;
  readonly onSelectionChange: (
    selection: AiContextSelection | undefined,
  ) => void;
  readonly onToggleProposalChange: (changeId: string) => void;
  readonly onToggleProposalFile: (relativePath: string) => void;
  readonly proposalAcceptedChangeIds: ReadonlySet<string>;
  readonly proposalApplying: boolean;
  readonly proposalApplyError: string | undefined;
  readonly proposalReview: AiPatchReview | undefined;
  readonly onTabChange: (tab: WorkspaceTab) => void;
  readonly saving: boolean;
  readonly selection: AiContextSelection | undefined;
  readonly tab: WorkspaceTab;
  readonly t: (key: MessageKey) => string;
  readonly versionNotice: string | undefined;
  readonly versionWarning: boolean;
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
    onAcceptAllProposalChanges,
    onApplyProposal,
    onDiscard,
    onCreateVersion,
    onReload,
    onOpenKnowledgeSource,
    onProposalReady,
    onRejectProposal,
    onRecoveryRestored,
    onSave,
    onSelectionChange,
    onToggleProposalChange,
    onToggleProposalFile,
    onTabChange,
    saving,
    selection,
    proposalAcceptedChangeIds,
    proposalApplying,
    proposalApplyError,
    proposalReview,
    tab,
    t,
    versionNotice,
    versionWarning,
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
            <span
              className={`max-w-52 overflow-hidden text-ellipsis whitespace-nowrap ${versionWarning ? "text-destructive" : "text-primary"}`}
              title={versionNotice}
            >
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
              onSelect={(event) => {
                const target = event.currentTarget;
                if (target.selectionStart === target.selectionEnd) {
                  onSelectionChange(undefined);
                  return;
                }
                const startLine = target.value
                  .slice(0, target.selectionStart)
                  .split("\n").length;
                const inclusiveEnd = Math.max(
                  target.selectionStart,
                  target.selectionEnd - 1,
                );
                const endLine = target.value
                  .slice(0, inclusiveEnd)
                  .split("\n").length;
                onSelectionChange({ startLine, endLine });
              }}
            />
          )
        ) : tab === "assistant" ? (
          <div className="assistant-workspace">
            {activeProject === undefined ? null : (
              <>
                <ChatPanel
                  canPropose={!dirty}
                  content={content}
                  documentPath={document?.path}
                  onOpenSource={onOpenKnowledgeSource}
                  onProposalReady={onProposalReady}
                  projectId={activeProject.id}
                  selection={selection}
                  t={t}
                />
                <aside className="assistant-sidebar">
                  <KnowledgePanel
                    onOpenSource={onOpenKnowledgeSource}
                    projectId={activeProject.id}
                    t={t}
                  />
                  <section
                    className="ai-context-section"
                    aria-label={t("aiContext")}
                  >
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
                </aside>
              </>
            )}
          </div>
        ) : activeProject === undefined ? null : proposalReview !==
          undefined ? (
          <ChangeReviewPanel
            acceptedChangeIds={proposalAcceptedChangeIds}
            applying={proposalApplying}
            applyError={proposalApplyError}
            onAcceptAll={onAcceptAllProposalChanges}
            onApply={onApplyProposal}
            onRejectProposal={onRejectProposal}
            onToggleChange={onToggleProposalChange}
            onToggleFile={onToggleProposalFile}
            review={proposalReview}
            t={t}
          />
        ) : (
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
