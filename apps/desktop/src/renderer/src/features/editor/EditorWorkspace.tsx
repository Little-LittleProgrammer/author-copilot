import { AiConnectionSelector } from "../assistant/AiSettingsDialog.js";
import { AgentPanel } from "../assistant/AgentPanel.js";
import { useState, type JSX } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import { WritingEditor } from "./WritingEditor.js";
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

interface EditorWorkspaceProps {
  readonly onAgentBusyChange: (busy: boolean) => void;
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
  readonly onRecoveryRestored: () => Promise<void>;
  readonly onRepositoryBusyChange: (busy: boolean) => void;
  readonly repositoryBusy: boolean;
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
  readonly onProposalOpenChange: (open: boolean) => void;
  readonly saving: boolean;
  readonly selection: AiContextSelection | undefined;
  readonly proposalOpen: boolean;
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
    onRepositoryBusyChange,
    repositoryBusy,
    onSave,
    onSelectionChange,
    onToggleProposalChange,
    onToggleProposalFile,
    onProposalOpenChange,
    saving,
    selection,
    proposalAcceptedChangeIds,
    proposalApplying,
    proposalApplyError,
    proposalReview,
    proposalOpen,
    t,
    versionNotice,
    versionWarning,
    versionRefreshKey,
  } = props;
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<
    "chat" | "agent" | "knowledge"
  >("chat");
  const [historyOpen, setHistoryOpen] = useState(false);
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
            disabled={
              activeProject === undefined ||
              dirty ||
              saving ||
              loading ||
              proposalApplying
            }
            title={dirty ? t("versionSaveDocumentFirst") : t("saveVersion")}
            onClick={onCreateVersion}
          >
            {t("saveVersion")}
          </Button>
          <button
            type="button"
            className="button primary save-button"
            data-testid="save-document"
            disabled={
              !dirty ||
              saving ||
              loading ||
              proposalApplying ||
              document === undefined
            }
            onClick={onSave}
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </header>

      {error !== undefined ? (
        <div className="editor-alert" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" onClick={onReload}>
            {t("reload")}
          </button>
        </div>
      ) : null}

      <WritingEditor
        content={content}
        projectId={activeProject?.id}
        documentPath={document?.path}
        readOnly={loading || proposalApplying}
        loading={loading}
        assistantOpen={assistantOpen}
        onChange={onChange}
        onSelectionChange={onSelectionChange}
        onSave={onSave}
        onHistory={() => {
          onProposalOpenChange(false);
          setHistoryOpen(true);
        }}
        onToggleAssistant={() => setAssistantOpen((open) => !open)}
        t={t}
      >
        <aside
          id="assistant-dock"
          className="assistant-dock"
          data-testid="assistant-dock"
          hidden={!assistantOpen}
          aria-label={t("aiChat")}
        >
          <header className="assistant-dock-header">
            <strong>{t("aiChat")}</strong>
            <button
              type="button"
              aria-label={t("close")}
              onClick={() => setAssistantOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          <AiConnectionSelector t={t} />
          <nav className="assistant-mode-tabs" aria-label={t("aiChat")}>
            {(
              [
                ["chat", "assistantChatMode"],
                ["agent", "assistantAgentMode"],
                ["knowledge", "assistantKnowledgeMode"],
              ] as const
            ).map(([mode, label]) => (
              <button
                type="button"
                key={mode}
                aria-pressed={assistantMode === mode}
                onClick={() => setAssistantMode(mode)}
              >
                {t(label)}
              </button>
            ))}
          </nav>
          {proposalReview !== undefined ? (
            <button
              type="button"
              className="pending-proposal"
              onClick={() => {
                setHistoryOpen(false);
                onProposalOpenChange(true);
              }}
            >
              {t("editorPendingProposal")}
            </button>
          ) : null}
          {activeProject === undefined ? null : (
            <>
              <div
                className="assistant-view chat-view"
                hidden={assistantMode !== "chat"}
              >
                <ChatPanel
                  canPropose={
                    !dirty && !saving && !loading && !proposalApplying
                  }
                  contextPaths={aiContext.map((node) => node.path)}
                  content={content}
                  documentPath={document?.path}
                  onOpenSource={onOpenKnowledgeSource}
                  onProposalReady={onProposalReady}
                  projectId={activeProject.id}
                  selection={selection}
                  t={t}
                />
              </div>
              <div
                className="assistant-view"
                hidden={assistantMode !== "agent"}
              >
                <AgentPanel
                  projectId={activeProject.id}
                  projectName={activeProject.name}
                  refreshKey={versionRefreshKey}
                  blocked={
                    dirty || saving || repositoryBusy || proposalApplying
                  }
                  onBusyChange={props.onAgentBusyChange}
                  onFilesChanged={onRecoveryRestored}
                  t={t}
                />
              </div>
              <div
                className="assistant-view"
                hidden={assistantMode !== "knowledge"}
              >
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
              </div>
            </>
          )}
        </aside>
      </WritingEditor>
      <Dialog
        open={historyOpen || proposalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryOpen(false);
            onProposalOpenChange(false);
          }
        }}
      >
        <DialogContent
          className="editor-history-dialog"
          closeLabel={`${t("close")} ${t(proposalOpen ? "editorPendingProposal" : "versionHistory")}`}
          aria-describedby={undefined}
        >
          <DialogTitle>
            {t(proposalOpen ? "editorPendingProposal" : "versionHistory")}
          </DialogTitle>
          <div className="editor-history-body">
            {activeProject === undefined ? null : proposalOpen &&
              proposalReview !== undefined ? (
              <ChangeReviewPanel
                acceptedChangeIds={proposalAcceptedChangeIds}
                applying={proposalApplying}
                applyBlocked={dirty || saving || loading}
                applyError={proposalApplyError}
                onAcceptAll={onAcceptAllProposalChanges}
                onApply={onApplyProposal}
                onRejectProposal={() => {
                  onRejectProposal();
                  onProposalOpenChange(false);
                }}
                onToggleChange={onToggleProposalChange}
                onToggleFile={onToggleProposalFile}
                review={proposalReview}
                t={t}
              />
            ) : (
              <VersionHistoryPanel
                dirty={dirty}
                busy={repositoryBusy || loading}
                onBusyChange={onRepositoryBusyChange}
                onRepositoryChanged={onRecoveryRestored}
                projectId={activeProject.id}
                refreshKey={versionRefreshKey}
                t={t}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
