import { useState, type JSX, type ReactNode } from "react";
import { BookOpen, NotebookPen, Palette, Sparkles, X } from "lucide-react";
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
import { CreativeNotesPanel } from "../assistant/CreativeNotesPanel.js";
import { ChangeReviewPanel } from "../change-review/ChangeReviewPanel.js";
import type {
  DocumentSnapshot,
  ProjectSummary,
  StructureNode,
} from "../project/types.js";
import { VersionHistoryPanel } from "../version/VersionHistoryPanel.js";

import { ThemeDialog } from "../../themes/ThemeDialog.js";
import { useTheme } from "../../themes/index.js";

interface EditorWorkspaceProps {
  readonly sidebar: ReactNode;
  readonly onAgentBusyChange: (busy: boolean) => void;
  readonly onCreativeNotesDirtyChange: (dirty: boolean) => void;
  readonly activeProject: ProjectSummary | undefined;
  readonly aiContext: readonly StructureNode[];
  readonly content: string;
  readonly document: DocumentSnapshot | undefined;
  readonly documentTitle: string | undefined;
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
  const themeController = useTheme();
  const [themeOpen, setThemeOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<
    "chat" | "knowledge" | "notes"
  >("chat");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null);
  const roleLabels: Readonly<Record<StructureNode["role"], MessageKey>> = {
    act: "structureRoleAct",
    chapter: "structureRoleChapter",
    scene: "structureRoleDocument",
    unclassified: "structureRoleDocument",
    volume: "structureRoleVolume",
  };
  const documentName =
    props.documentTitle ??
    document?.path.split(/[\\/]/).at(-1)?.replace(/\.md$/iu, "");
  return (
    <main className="editor-pane">
      {error !== undefined ? (
        <div className="editor-alert" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" onClick={onReload}>
            {t("reload")}
          </button>
        </div>
      ) : null}

      <WritingEditor
        onPreviewHost={setPreviewHost}
        sidebar={props.sidebar}
        documentTitle={documentName}
        onOpenTheme={() => setThemeOpen(true)}
        toolbarActions={
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
        }
        content={content}
        projectId={activeProject?.id}
        documentPath={document?.path}
        readOnly={loading || proposalApplying || previewOpen}
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
                  previewHost={previewHost}
                  onPreviewOpenChange={setPreviewOpen}
                  key={activeProject.id}
                  projectName={activeProject.name}
                  blocked={
                    dirty ||
                    saving ||
                    loading ||
                    repositoryBusy ||
                    proposalApplying
                  }
                  refreshKey={versionRefreshKey}
                  onBusyChange={props.onAgentBusyChange}
                  onFilesChanged={onRecoveryRestored}
                  onClose={() => setAssistantOpen(false)}
                  onKnowledge={() => setAssistantMode("knowledge")}
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
                hidden={assistantMode !== "knowledge"}
              >
                <header className="assistant-dock-header">
                  <button
                    type="button"
                    onClick={() => setAssistantMode("chat")}
                  >
                    {t("chatBack")}
                  </button>
                  <strong>{t("assistantKnowledgeMode")}</strong>
                  <button
                    type="button"
                    aria-label={t("close")}
                    onClick={() => setAssistantOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </header>
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
              <div
                className="assistant-view"
                hidden={assistantMode !== "notes"}
              >
                <CreativeNotesPanel
                  key={activeProject.id}
                  projectId={activeProject.id}
                  onDirtyChange={props.onCreativeNotesDirtyChange}
                  t={t}
                />
              </div>
            </>
          )}
        </aside>
        <nav className="editor-tool-rail" aria-label={t("writingTools")}>
          {(
            [
              ["chat", "assistantChatMode", Sparkles],
              ["knowledge", "assistantKnowledgeMode", BookOpen],
              ["notes", "creativeNotesMode", NotebookPen],
            ] as const
          ).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              aria-label={`${t("openPanel")}: ${t(label)}`}
              aria-pressed={assistantOpen && assistantMode === mode}
              onClick={() => {
                setAssistantOpen(!assistantOpen || assistantMode !== mode);
                setAssistantMode(mode);
              }}
            >
              <Icon size={18} />
              <span>{t(label)}</span>
            </button>
          ))}
          <span className="rail-divider" />
          <button
            type="button"
            onClick={() => setThemeOpen(true)}
            aria-label={t("themeSettings")}
          >
            <Palette size={18} />
            <span>{t("editorBackground")}</span>
          </button>
        </nav>
      </WritingEditor>
      <ThemeDialog
        controller={themeController}
        open={themeOpen}
        onClose={() => setThemeOpen(false)}
        t={t}
      />
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
