import { useCallback, useEffect, useState, type JSX } from "react";
import { ArrowLeft, LogOut, Palette } from "lucide-react";

import type { RuntimeInfo } from "@author-copilot/contracts";

import {
  EditorWorkspace,
  type WorkspaceTab,
} from "./features/editor/EditorWorkspace.js";
import { LoginPage } from "./features/auth/LoginPage.js";
import { WriterCenter } from "./features/center/WriterCenter.js";
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
import { VersionDialog } from "./features/version/VersionDialog.js";
import type { VersionResult } from "./features/version/version-api.js";
import { useI18n } from "./i18n/index.js";
import { ThemeDialog } from "./themes/ThemeDialog.js";
import { useTheme } from "./themes/index.js";

type AppView = "center" | "editor" | "login";

const sessionKey = "author-copilot.session";

function initialAccount(): string | undefined {
  return localStorage.getItem(sessionKey) ?? undefined;
}

export function App(): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const themeController = useTheme();
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const [account, setAccount] = useState<string | undefined>(initialAccount);
  const [view, setView] = useState<AppView>(() =>
    initialAccount() === undefined ? "login" : "center",
  );
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectSummary>();
  const [structure, setStructure] = useState<readonly StructureNode[]>([]);
  const [document, setDocument] = useState<DocumentSnapshot>();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(() => getProjectApi() !== undefined);
  const [saving, setSaving] = useState(false);
  const [versionNotice, setVersionNotice] = useState<string>();
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
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
    setVersionNotice(undefined);
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
    setVersionNotice(undefined);
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
      setView("editor");
    },
    [loadProject],
  );

  const openProject = useCallback(
    (project: ProjectSummary) => {
      loadProject(project);
      setView("editor");
    },
    [loadProject],
  );

  const returnToCenter = useCallback(() => {
    if (dirty && !window.confirm(t("discardPrompt"))) return;
    setView("center");
  }, [dirty, t]);

  const logout = useCallback(() => {
    if (dirty && !window.confirm(t("discardPrompt"))) return;
    localStorage.removeItem(sessionKey);
    setAccount(undefined);
    setView("login");
  }, [dirty, t]);

  const login = useCallback((nextAccount: string, remember: boolean) => {
    if (remember) localStorage.setItem(sessionKey, nextAccount);
    else localStorage.removeItem(sessionKey);
    setAccount(nextAccount);
    setView("center");
  }, []);

  const accountName = account?.split("@")[0] ?? "";

  return (
    <div className={`app-shell app-view-${view}`}>
      <header className="titlebar">
        {view === "editor" ? (
          <button
            className="icon-button titlebar-back"
            type="button"
            aria-label={t("backToWorks")}
            title={t("backToWorks")}
            onClick={returnToCenter}
          >
            <ArrowLeft size={17} />
          </button>
        ) : null}
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
            aria-label={t("themeSettings")}
            title={t("themeSettings")}
            onClick={() => setThemeDialogOpen(true)}
          >
            <Palette size={16} />
          </button>
          {account !== undefined ? (
            <>
              <span className="titlebar-divider" aria-hidden="true" />
              <span className="account-avatar" aria-hidden="true">
                {accountName.charAt(0).toLocaleUpperCase() || "A"}
              </span>
              <span className="account-name">{accountName}</span>
              <button
                className="icon-button"
                type="button"
                aria-label={t("logout")}
                title={t("logout")}
                onClick={logout}
              >
                <LogOut size={16} />
              </button>
            </>
          ) : null}
        </div>
      </header>

      {view === "login" ? <LoginPage onLogin={login} t={t} /> : null}
      {view === "center" ? (
        <WriterCenter
          error={error}
          loading={loading}
          onCreate={setDialog}
          onImport={() => setDialog("import")}
          onOpenProject={openProject}
          projects={projects}
          t={t}
        />
      ) : null}
      {view === "editor" ? (
        <>
          <div className="workspace">
            <ProjectSidebar
              activeDocumentPath={document?.path}
              activeProject={activeProject}
              loading={loading}
              onSelectDocument={selectDocument}
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
            <span>
              {activeProject?.rootDisplayName ?? t("projectApiUnavailable")}
            </span>
            <span>
              {runtime === undefined
                ? ""
                : `v${runtime.appVersion} · ${runtime.platform} ${runtime.arch}`}
            </span>
          </footer>
        </>
      ) : null}
      <ProjectDialog
        key={`project-${dialog ?? "closed"}`}
        kind={view === "center" ? dialog : null}
        onClose={() => setDialog(null)}
        onComplete={completeProject}
        t={t}
      />
      <VersionDialog
        key={`version-${versionDialogOpen ? activeProject?.id : "closed"}`}
        open={versionDialogOpen}
        projectId={activeProject?.id}
        projectName={activeProject?.name}
        onClose={() => setVersionDialogOpen(false)}
        onComplete={completeVersion}
        t={t}
      />
      <ThemeDialog
        controller={themeController}
        open={themeDialogOpen}
        onClose={() => setThemeDialogOpen(false)}
        t={t}
      />
    </div>
  );
}
