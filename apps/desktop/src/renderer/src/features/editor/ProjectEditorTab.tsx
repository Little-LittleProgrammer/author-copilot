import { useCallback, useEffect, useState, type JSX } from "react";

import type { RuntimeInfo } from "@author-copilot/contracts";

import type { MessageKey } from "../../i18n/index.js";
import { ProjectSidebar } from "../project/ProjectSidebar.js";
import { errorMessage, getProjectApi } from "../project/project-api.js";
import {
  ProjectApiError,
  type DocumentSnapshot,
  type ProjectSummary,
  type StructureNode,
} from "../project/types.js";
import { VersionDialog } from "../version/VersionDialog.js";
import type { VersionResult } from "../version/version-api.js";
import { EditorWorkspace, type WorkspaceTab } from "./EditorWorkspace.js";

interface ProjectEditorTabProps {
  readonly onDirtyChange: (projectId: string, dirty: boolean) => void;
  readonly project: ProjectSummary;
  readonly runtime: RuntimeInfo | undefined;
  readonly t: (key: MessageKey) => string;
}

export function ProjectEditorTab({
  onDirtyChange,
  project,
  runtime,
  t,
}: ProjectEditorTabProps): JSX.Element {
  const [structure, setStructure] = useState<readonly StructureNode[]>([]);
  const [document, setDocument] = useState<DocumentSnapshot>();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(() => getProjectApi() !== undefined);
  const [saving, setSaving] = useState(false);
  const [versionNotice, setVersionNotice] = useState<string>();
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<WorkspaceTab>("content");
  const dirty = document !== undefined && content !== document.content;

  useEffect(() => {
    onDirtyChange(project.id, dirty);
  }, [dirty, onDirtyChange, project.id]);

  useEffect(() => {
    const api = getProjectApi();
    if (api === undefined) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(undefined);
    void api
      .getStructure({ projectId: project.id })
      .then((nodes) => {
        if (current) setStructure(nodes);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason, t("errorGeneric")));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [project.id, t]);

  const selectDocument = useCallback(
    (node: StructureNode) => {
      const api = getProjectApi();
      if (api === undefined || node.path === undefined) return;
      if (dirty && !window.confirm(t("discardPrompt"))) return;
      setLoading(true);
      setError(undefined);
      void api
        .readDocument({ projectId: project.id, path: node.path })
        .then((snapshot) => {
          setDocument(snapshot);
          setContent(snapshot.content);
          setTab("content");
        })
        .catch((reason: unknown) =>
          setError(errorMessage(reason, t("errorGeneric"))),
        )
        .finally(() => setLoading(false));
    },
    [dirty, project.id, t],
  );

  const save = useCallback(() => {
    const api = getProjectApi();
    if (api === undefined || document === undefined) return;
    setSaving(true);
    setError(undefined);
    setVersionNotice(undefined);
    void api
      .saveDocument({
        content,
        expectedVersion: document.version,
        path: document.path,
        projectId: project.id,
      })
      .then((snapshot) => {
        setDocument(snapshot);
        setContent(snapshot.content);
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof ProjectApiError && reason.code === "conflict"
            ? t("documentChanged")
            : errorMessage(reason, t("errorGeneric")),
        );
      })
      .finally(() => setSaving(false));
  }, [content, document, project.id, t]);

  const reload = useCallback(() => {
    if (document === undefined) return;
    selectDocument({
      id: document.path,
      kind: "document",
      name: document.path,
      path: document.path,
    });
  }, [document, selectDocument]);

  const completeVersion = useCallback(
    (result: VersionResult) => {
      setError(undefined);
      setVersionNotice(
        result.created
          ? `${t("versionSaved")} ${result.shortCommitId ?? ""}`.trim()
          : t("versionNoChanges"),
      );
    },
    [t],
  );

  return (
    <div className="project-editor-tab">
      <div className="workspace">
        <ProjectSidebar
          activeDocumentPath={document?.path}
          activeProject={project}
          loading={loading}
          onSelectDocument={selectDocument}
          structure={structure}
          t={t}
        />
        <EditorWorkspace
          activeProject={project}
          content={content}
          document={document}
          dirty={dirty}
          error={error}
          loading={loading}
          onChange={setContent}
          onDiscard={() => {
            if (document !== undefined) setContent(document.content);
          }}
          onCreateVersion={() => setVersionDialogOpen(true)}
          onReload={reload}
          onSave={save}
          onTabChange={setTab}
          saving={saving}
          tab={tab}
          t={t}
          versionNotice={versionNotice}
        />
      </div>
      <footer className="statusbar">
        <span>{project.rootDisplayName}</span>
        <span>
          {runtime === undefined
            ? ""
            : `v${runtime.appVersion} · ${runtime.platform} ${runtime.arch}`}
        </span>
      </footer>
      <VersionDialog
        key={`version-${versionDialogOpen ? project.id : "closed"}`}
        open={versionDialogOpen}
        projectId={project.id}
        projectName={project.name}
        onClose={() => setVersionDialogOpen(false)}
        onComplete={completeVersion}
        t={t}
      />
    </div>
  );
}
