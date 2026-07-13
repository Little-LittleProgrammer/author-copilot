import { useCallback, useEffect, useState, type JSX } from "react";

import type { RuntimeInfo } from "@author-copilot/contracts";

import {
  EditorWorkspace,
  type WorkspaceTab,
} from "./features/editor/EditorWorkspace.js";
import { ProjectDialog } from "./features/project/ProjectDialog.js";
import { ProjectSidebar } from "./features/project/ProjectSidebar.js";
import { errorMessage, getProjectApi } from "./features/project/project-api.js";
import {
  ProjectApiError,
  type DocumentSnapshot,
  type ProjectSummary,
  type ProjectType,
  type StructureNode,
} from "./features/project/types.js";
import { useI18n } from "./i18n/index.js";
import { useTheme } from "./themes/index.js";

export function App(): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectSummary>();
  const [structure, setStructure] = useState<readonly StructureNode[]>([]);
  const [document, setDocument] = useState<DocumentSnapshot>();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(() => getProjectApi() !== undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<ProjectType | "import" | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("content");
  const dirty = document !== undefined && content !== document.content;

  const loadProject = useCallback((project: ProjectSummary) => {
    const api = getProjectApi();
    setActiveProject(project);
    setDocument(undefined);
    setContent("");
    setStructure([]);
    setError(undefined);
    if (api === undefined) return;
    setLoading(true);
    void api
      .getStructure({ projectId: project.id })
      .then(setStructure)
      .catch((reason: unknown) =>
        setError(errorMessage(reason, "Project operation failed.")),
      )
      .finally(() => setLoading(false));
  }, []);

  const selectProject = useCallback(
    (project: ProjectSummary) => {
      if (dirty && !window.confirm(t("discardPrompt"))) return;
      loadProject(project);
    },
    [dirty, loadProject, t],
  );

  useEffect(() => {
    void window.authorCopilot.system
      .getRuntimeInfo()
      .then(setRuntime)
      .catch(() => undefined);
    const api = getProjectApi();
    if (api === undefined) return;
    void api
      .list()
      .then((items) => {
        setProjects(items);
        if (items[0] !== undefined) loadProject(items[0]);
      })
      .catch((reason: unknown) =>
        setError(errorMessage(reason, "Project operation failed.")),
      )
      .finally(() => setLoading(false));
  }, [loadProject]);

  const selectDocument = useCallback(
    (node: StructureNode) => {
      const api = getProjectApi();
      if (
        api === undefined ||
        activeProject === undefined ||
        node.path === undefined
      )
        return;
      if (dirty && !window.confirm(t("discardPrompt"))) return;
      setLoading(true);
      setError(undefined);
      void api
        .readDocument({ projectId: activeProject.id, path: node.path })
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
    [activeProject, dirty, t],
  );

  const save = useCallback(() => {
    const api = getProjectApi();
    if (
      api === undefined ||
      activeProject === undefined ||
      document === undefined
    )
      return;
    setSaving(true);
    setError(undefined);
    void api
      .saveDocument({
        content,
        expectedVersion: document.version,
        path: document.path,
        projectId: activeProject.id,
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
  }, [activeProject, content, document, t]);

  const reload = useCallback(() => {
    if (document === undefined) return;
    selectDocument({
      id: document.path,
      kind: "document",
      name: document.path,
      path: document.path,
    });
  }, [document, selectDocument]);

  const completeProject = useCallback(
    (project: ProjectSummary) => {
      setProjects((current) => [
        ...current.filter(({ id }) => id !== project.id),
        project,
      ]);
      loadProject(project);
    },
    [loadProject],
  );

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand-mark" aria-hidden="true">
          A
        </div>
        <h1>{t("appName")}</h1>
        <div className="titlebar-tools">
          <select
            aria-label={t("language")}
            title={t("language")}
            value={locale}
            onChange={(event) =>
              setLocale(event.target.value as "en-US" | "zh-CN")
            }
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">EN</option>
          </select>
          <button
            className="icon-button"
            type="button"
            aria-label={t("theme")}
            title={theme === "light" ? t("darkTheme") : t("lightTheme")}
            onClick={toggleTheme}
          >
            {theme === "light" ? "◐" : "○"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <ProjectSidebar
          activeDocumentPath={document?.path}
          activeProject={activeProject}
          loading={loading}
          onCreate={setDialog}
          onImport={() => setDialog("import")}
          onSelectDocument={selectDocument}
          onSelectProject={selectProject}
          projects={projects}
          structure={structure}
          t={t}
        />
        <EditorWorkspace
          activeProject={activeProject}
          content={content}
          document={document}
          dirty={dirty}
          error={error}
          loading={loading}
          onChange={setContent}
          onDiscard={() => {
            if (document !== undefined) setContent(document.content);
          }}
          onReload={reload}
          onSave={save}
          onTabChange={setTab}
          saving={saving}
          tab={tab}
          t={t}
        />
      </div>

      <footer className="statusbar">
        <span>
          {activeProject?.rootDisplayName ?? t("projectApiUnavailable")}
        </span>
        <span>
          {runtime === undefined
            ? ""
            : `v${runtime.appVersion} · ${runtime.platform} ${runtime.arch}`}
        </span>
      </footer>
      <ProjectDialog
        key={dialog ?? "closed"}
        kind={dialog}
        onClose={() => setDialog(null)}
        onComplete={completeProject}
        t={t}
      />
    </div>
  );
}
