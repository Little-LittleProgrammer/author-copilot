import { useCallback, useEffect, useState, type JSX } from "react";
import { BookOpen, Grid2X2, TriangleAlert, X } from "lucide-react";

import type {
  ProjectSummary as ProjectSummaryContract,
  RuntimeInfo,
  TabContext,
  TabState,
} from "@author-copilot/contracts";

import { LoginPage } from "./features/auth/LoginPage.js";
import { WriterCenter } from "./features/center/WriterCenter.js";
import { ProjectEditorTab } from "./features/editor/ProjectEditorTab.js";
import { ProjectDialog } from "./features/project/ProjectDialog.js";
import { errorMessage, getProjectApi } from "./features/project/project-api.js";
import type { ProjectSummary, ProjectType } from "./features/project/types.js";
import { useI18n } from "./i18n/index.js";
import { ThemeDialog } from "./themes/ThemeDialog.js";
import { useTheme } from "./themes/index.js";

const sessionKey = "author-copilot.session";
const emptyTabState: TabState = { activeTabId: null, tabs: [] };

function initialAccount(): string | undefined {
  return localStorage.getItem(sessionKey) ?? undefined;
}

function mapProject(project: ProjectSummaryContract): ProjectSummary {
  return {
    id: project.projectId,
    name: project.title,
    rootDisplayName: project.rootDisplayName,
    type: project.template,
  };
}

function ShellApp(): JSX.Element {
  const { locale, t } = useI18n();
  useTheme();
  const [account, setAccount] = useState<string | undefined>(initialAccount);
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [tabState, setTabState] = useState<TabState>(emptyTabState);

  const logout = useCallback(async () => {
    const result = await window.authorCopilot.tabs.endSession();
    if (result.status !== "completed") return;
    localStorage.removeItem(sessionKey);
    setAccount(undefined);
    setTabState(emptyTabState);
  }, []);

  useEffect(() => {
    void window.authorCopilot.system
      .getRuntimeInfo()
      .then(setRuntime)
      .catch(() => undefined);
    return window.authorCopilot.tabs.onStateChanged(setTabState);
  }, []);

  useEffect(
    () => window.authorCopilot.tabs.onLogoutRequested(() => void logout()),
    [logout],
  );

  useEffect(() => {
    void window.authorCopilot.tabs.setLocale(locale).catch(() => undefined);
  }, [locale]);

  useEffect(() => {
    if (account === undefined) return;
    void window.authorCopilot.tabs
      .startSession()
      .then(setTabState)
      .catch(() => undefined);
  }, [account]);

  const login = useCallback((nextAccount: string, remember: boolean) => {
    if (remember) localStorage.setItem(sessionKey, nextAccount);
    else localStorage.removeItem(sessionKey);
    setAccount(nextAccount);
  }, []);

  const authenticated = account !== undefined;

  return (
    <div
      className={`app-shell ${authenticated ? "app-view-tabs" : "app-view-login"} platform-${runtime?.platform ?? "unknown"}`}
      data-testid="shell-app"
    >
      {!authenticated ? (
        <LoginPage onLogin={login} t={t} />
      ) : (
        <>
          <nav className="app-tabs" role="tablist" aria-label={t("openTabs")}>
            {tabState.tabs.map((tab) => {
              const active = tabState.activeTabId === tab.id;
              const center = tab.kind === "center";
              return center ? (
                <button
                  key={tab.id}
                  className={`app-tab-item center-app-tab${active ? " active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={tab.failed ? t("tabLoadFailed") : undefined}
                  onClick={() =>
                    void window.authorCopilot.tabs.activate(tab.id)
                  }
                >
                  <Grid2X2 size={14} aria-hidden="true" />
                  <span>{t("writerCenter")}</span>
                </button>
              ) : (
                <div
                  key={tab.id}
                  className={`app-tab-item${active ? " active" : ""}`}
                >
                  <button
                    className="app-tab-main"
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() =>
                      void window.authorCopilot.tabs.activate(tab.id)
                    }
                  >
                    <BookOpen size={14} aria-hidden="true" />
                    <span>{tab.title}</span>
                    {tab.failed ? (
                      <TriangleAlert
                        size={13}
                        aria-label={t("tabLoadFailed")}
                      />
                    ) : tab.dirty ? (
                      <i className="app-tab-dirty" aria-label={t("unsaved")} />
                    ) : null}
                  </button>
                  <button
                    className="app-tab-close"
                    type="button"
                    aria-label={`${t("closeTab")}: ${tab.title}`}
                    title={`${t("closeTab")}: ${tab.title}`}
                    onClick={() => void window.authorCopilot.tabs.close(tab.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </nav>
          <div className="native-tab-host" aria-hidden="true" />
        </>
      )}
    </div>
  );
}

function WriterCenterApp(): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const themeController = useTheme();
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [loading, setLoading] = useState(() => getProjectApi() !== undefined);
  const [error, setError] = useState<string>();
  const [projectDialog, setProjectDialog] = useState<
    ProjectType | "import" | null
  >(null);
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const account = initialAccount() ?? "";

  useEffect(() => {
    const api = getProjectApi();
    if (api === undefined) return;
    void api
      .list()
      .then(setProjects)
      .catch((reason: unknown) =>
        setError(errorMessage(reason, t("errorGeneric"))),
      )
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(
    () =>
      window.authorCopilot.tabs.onProjectChanged((project) => {
        const mapped = mapProject(project);
        setProjects((current) => [
          ...current.filter(({ id }) => id !== mapped.id),
          mapped,
        ]);
      }),
    [],
  );

  const openProject = useCallback((project: ProjectSummary) => {
    void window.authorCopilot.tabs.openProject(project.id);
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

  return (
    <div className="native-tab-surface" data-testid="writer-center-app">
      <WriterCenter
        account={account}
        error={error}
        locale={locale}
        loading={loading}
        onCreate={setProjectDialog}
        onImport={() => setProjectDialog("import")}
        onLocaleChange={setLocale}
        onLogout={() => void window.authorCopilot.tabs.requestLogout()}
        onOpenProject={openProject}
        onOpenTheme={() => setThemeDialogOpen(true)}
        projects={projects}
        t={t}
      />
      <ProjectDialog
        key={`project-${projectDialog ?? "closed"}`}
        kind={projectDialog}
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

function ProjectApp({
  context,
}: {
  readonly context: Extract<TabContext, { kind: "project" }>;
}): JSX.Element {
  const { t } = useI18n();
  useTheme();
  const [project, setProject] = useState(() => mapProject(context.project));
  const [runtime, setRuntime] = useState<RuntimeInfo>();

  useEffect(() => {
    void window.authorCopilot.system
      .getRuntimeInfo()
      .then(setRuntime)
      .catch(() => undefined);
    return window.authorCopilot.tabs.onProjectChanged((changed) => {
      if (changed.projectId === context.project.projectId) {
        setProject(mapProject(changed));
      }
    });
  }, [context.project.projectId]);

  return (
    <div className="native-tab-surface" data-testid="project-app">
      <ProjectEditorTab
        onDirtyChange={(_projectId, dirty) =>
          void window.authorCopilot.tabs.reportDirty(dirty)
        }
        onProjectUpdate={setProject}
        project={project}
        runtime={runtime}
        t={t}
      />
    </div>
  );
}

export function App({
  context,
}: {
  readonly context: TabContext;
}): JSX.Element {
  if (context.kind === "shell") return <ShellApp />;
  if (context.kind === "center") return <WriterCenterApp />;
  return <ProjectApp context={context} />;
}
