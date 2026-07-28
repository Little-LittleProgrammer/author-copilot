import { useCallback, useEffect, useState, type JSX } from "react";
import { BookOpen, Grid2X2, X } from "lucide-react";

import type { RuntimeInfo } from "@author-copilot/contracts";

import { LoginPage } from "./features/auth/LoginPage.js";
import { WriterCenter } from "./features/center/WriterCenter.js";
import { ProjectEditorTab } from "./features/editor/ProjectEditorTab.js";
import { ProjectDialog } from "./features/project/ProjectDialog.js";
import { errorMessage, getProjectApi } from "./features/project/project-api.js";
import type { ProjectSummary, ProjectType } from "./features/project/types.js";
import { useI18n } from "./i18n/index.js";
import { ThemeDialog } from "./themes/ThemeDialog.js";
import { useTheme } from "./themes/index.js";

const centerTabId = "writer-center";
const sessionKey = "author-copilot.session";

function initialAccount(): string | undefined {
  return localStorage.getItem(sessionKey) ?? undefined;
}

export function App(): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const themeController = useTheme();
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const [account, setAccount] = useState<string | undefined>(initialAccount);
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(
    () => getProjectApi() !== undefined,
  );
  const [projectsError, setProjectsError] = useState<string>();
  const [projectDialog, setProjectDialog] = useState<
    ProjectType | "import" | null
  >(null);
  const [openProjects, setOpenProjects] = useState<readonly ProjectSummary[]>(
    [],
  );
  const [activeTabId, setActiveTabId] = useState(centerTabId);
  const [dirtyProjectIds, setDirtyProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(),
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
      .then(setProjects)
      .catch((reason: unknown) =>
        setProjectsError(errorMessage(reason, t("errorGeneric"))),
      )
      .finally(() => setProjectsLoading(false));
  }, [t]);

  const openProject = useCallback((project: ProjectSummary) => {
    setOpenProjects((current) =>
      current.some(({ id }) => id === project.id)
        ? current
        : [...current, project],
    );
    setActiveTabId(project.id);
  }, []);

  const completeProject = useCallback(
    (project: ProjectSummary) => {
      setProjects((current) => [
        ...current.filter(({ id }) => id !== project.id),
        project,
      ]);
      openProject(project);
    },
    [openProject],
  );

  const updateProject = useCallback((project: ProjectSummary) => {
    setProjects((current) =>
      current.map((candidate) =>
        candidate.id === project.id ? project : candidate,
      ),
    );
    setOpenProjects((current) =>
      current.map((candidate) =>
        candidate.id === project.id ? project : candidate,
      ),
    );
  }, []);

  const updateDirtyState = useCallback((projectId: string, dirty: boolean) => {
    setDirtyProjectIds((current) => {
      const next = new Set(current);
      if (dirty) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  }, []);

  const closeProject = useCallback(
    (projectId: string) => {
      if (
        dirtyProjectIds.has(projectId) &&
        !window.confirm(t("closeDirtyTabPrompt"))
      )
        return;

      const closingIndex = openProjects.findIndex(({ id }) => id === projectId);
      const remaining = openProjects.filter(({ id }) => id !== projectId);
      setOpenProjects(remaining);
      setDirtyProjectIds((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
      if (activeTabId === projectId) {
        setActiveTabId(
          remaining[Math.max(0, closingIndex - 1)]?.id ?? centerTabId,
        );
      }
    },
    [activeTabId, dirtyProjectIds, openProjects, t],
  );

  const logout = useCallback(() => {
    if (dirtyProjectIds.size > 0 && !window.confirm(t("logoutDirtyTabsPrompt")))
      return;
    localStorage.removeItem(sessionKey);
    setAccount(undefined);
    setOpenProjects([]);
    setDirtyProjectIds(new Set());
    setActiveTabId(centerTabId);
  }, [dirtyProjectIds.size, t]);

  const login = useCallback((nextAccount: string, remember: boolean) => {
    if (remember) localStorage.setItem(sessionKey, nextAccount);
    else localStorage.removeItem(sessionKey);
    setAccount(nextAccount);
    setActiveTabId(centerTabId);
  }, []);

  const authenticated = account !== undefined;

  return (
    <div
      className={`app-shell ${authenticated ? "app-view-tabs" : "app-view-login"} platform-${runtime?.platform ?? "unknown"}`}
    >
      {!authenticated ? (
        <LoginPage onLogin={login} t={t} />
      ) : (
        <>
          <nav className="app-tabs" role="tablist" aria-label={t("openTabs")}>
            <button
              className={`app-tab-item center-app-tab${
                activeTabId === centerTabId ? " active" : ""
              }`}
              type="button"
              role="tab"
              aria-controls="panel-writer-center"
              aria-selected={activeTabId === centerTabId}
              onClick={() => setActiveTabId(centerTabId)}
            >
              <Grid2X2 size={14} aria-hidden="true" />
              <span>{t("writerCenter")}</span>
            </button>
            {openProjects.map((project) => (
              <div
                key={project.id}
                className={`app-tab-item${
                  activeTabId === project.id ? " active" : ""
                }`}
              >
                <button
                  className="app-tab-main"
                  type="button"
                  role="tab"
                  aria-controls={`panel-${project.id}`}
                  aria-selected={activeTabId === project.id}
                  onClick={() => setActiveTabId(project.id)}
                >
                  <BookOpen size={14} aria-hidden="true" />
                  <span>{project.name}</span>
                  {dirtyProjectIds.has(project.id) ? (
                    <i className="app-tab-dirty" aria-label={t("unsaved")} />
                  ) : null}
                </button>
                <button
                  className="app-tab-close"
                  type="button"
                  aria-label={`${t("closeTab")}: ${project.name}`}
                  title={`${t("closeTab")}: ${project.name}`}
                  onClick={() => closeProject(project.id)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </nav>

          <div className="app-tab-content">
            <section
              id="panel-writer-center"
              className="app-tab-panel"
              role="tabpanel"
              hidden={activeTabId !== centerTabId}
            >
              <WriterCenter
                account={account}
                error={projectsError}
                locale={locale}
                loading={projectsLoading}
                onCreate={setProjectDialog}
                onImport={() => setProjectDialog("import")}
                onLocaleChange={setLocale}
                onLogout={logout}
                onOpenProject={openProject}
                onOpenTheme={() => setThemeDialogOpen(true)}
                projects={projects}
                t={t}
              />
            </section>
            {openProjects.map((project) => (
              <section
                key={project.id}
                id={`panel-${project.id}`}
                className="app-tab-panel"
                role="tabpanel"
                hidden={activeTabId !== project.id}
              >
                <ProjectEditorTab
                  onDirtyChange={updateDirtyState}
                  onProjectUpdate={updateProject}
                  project={project}
                  runtime={runtime}
                  t={t}
                />
              </section>
            ))}
          </div>
        </>
      )}

      <ProjectDialog
        key={`project-${projectDialog ?? "closed"}`}
        kind={authenticated ? projectDialog : null}
        onClose={() => setProjectDialog(null)}
        onComplete={completeProject}
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
