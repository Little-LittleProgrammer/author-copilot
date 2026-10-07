import { useMemo, useState, type JSX } from "react";
import {
  BookOpen,
  Clapperboard,
  ChevronDown,
  Feather,
  Sparkles,
  FilePlus2,
  FolderInput,
  Grid2X2,
  KeyRound,
  Languages,
  LogOut,
  Palette,
  Plus,
  Search,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";

import type { Locale, MessageKey } from "../../i18n/index.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import type { ProjectSummary, ProjectType } from "../project/types.js";

type WorkFilter = "all" | ProjectType;

interface WriterCenterProps {
  readonly account: string;
  readonly error: string | undefined;
  readonly locale: Locale;
  readonly loading: boolean;
  readonly onCreate: (type: ProjectType) => void;
  readonly onImport: () => void;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly onLogout: () => void;
  readonly onOpenCredentials: () => void;
  readonly onOpenProject: (project: ProjectSummary) => void;
  readonly onOpenTheme: () => void;
  readonly projects: readonly ProjectSummary[];
  readonly t: (key: MessageKey) => string;
}

const filters: readonly { id: WorkFilter; label: MessageKey }[] = [
  { id: "all", label: "allWorks" },
  { id: "novel", label: "novelWorks" },
  { id: "screenplay", label: "screenplayWorks" },
];

export function WriterCenter({
  account,
  error,
  locale,
  loading,
  onCreate,
  onImport,
  onLocaleChange,
  onLogout,
  onOpenCredentials,
  onOpenProject,
  onOpenTheme,
  projects,
  t,
}: WriterCenterProps): JSX.Element {
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [query, setQuery] = useState("");
  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return projects.filter(
      (project) =>
        (filter === "all" || project.type === filter) &&
        (normalizedQuery.length === 0 ||
          project.name.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [filter, projects, query]);
  const accountName = account.split("@")[0] ?? account;

  return (
    <div className="writer-center">
      <aside className="center-sidebar">
        <div className="center-profile">
          <span className="center-profile-avatar" aria-hidden="true">
            {accountName.charAt(0).toLocaleUpperCase() || "A"}
          </span>
          <strong>{accountName}</strong>
          <span>{account}</span>
          <button
            className="center-profile-logout sidebar-tooltip"
            type="button"
            aria-label={t("logout")}
            data-tooltip={t("logout")}
            onClick={onLogout}
          >
            <LogOut size={14} />
          </button>
        </div>
        <nav className="center-menu" aria-label={t("writerCenter")}>
          <div className="center-menu-group">
            {filters.map(({ id, label }) => {
              const Icon =
                id === "novel"
                  ? BookOpen
                  : id === "screenplay"
                    ? Clapperboard
                    : Grid2X2;
              return (
                <button
                  key={id}
                  className={filter === id ? "active" : ""}
                  type="button"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>{t(label)}</span>
                </button>
              );
            })}
          </div>
          <div className="center-menu-group center-settings-menu">
            <button type="button" onClick={onOpenCredentials}>
              <Sparkles size={17} />
              <span>{t("aiSettings")}</span>
            </button>
            <button type="button" onClick={onOpenTheme}>
              <Palette size={17} />
              <span>{t("appearance")}</span>
            </button>
          </div>
        </nav>
        <div
          className="center-sidebar-tools"
          aria-label={`${t("appearance")}, ${t("aiSettings")}`}
        >
          <button
            className="sidebar-tool sidebar-tooltip"
            type="button"
            aria-label={t("anthropicCredentialSettings")}
            data-tooltip={t("anthropicCredentialSettings")}
            onClick={onOpenCredentials}
          >
            <KeyRound size={17} />
          </button>
          <button
            className="sidebar-tool sidebar-tooltip"
            type="button"
            aria-label={t("themeSettings")}
            data-tooltip={t("themeSettings")}
            onClick={onOpenTheme}
          >
            <Palette size={17} />
          </button>
          <button
            className="sidebar-tool sidebar-tooltip"
            type="button"
            aria-label={t("language")}
            data-tooltip={`${t("language")}: ${locale === "zh-CN" ? "中文" : "English"}`}
            onClick={() =>
              onLocaleChange(locale === "zh-CN" ? "en-US" : "zh-CN")
            }
          >
            <Languages size={17} />
          </button>
        </div>
      </aside>

      <main className="works-page">
        <div className="center-overview">
          <header className="works-header">
            <div>
              <span className="overview-kicker">AUTHOR COPILOT</span>
              <h1>{t("myWorks")}</h1>
              <p>{t("worksDescription")}</p>
            </div>
            <Feather
              className="overview-feather"
              size={88}
              strokeWidth={1}
              aria-hidden="true"
            />
          </header>
          <section
            className="center-work-summary"
            aria-label={t("workspaceOverview")}
          >
            <div className="overview-heading">
              <BookOpen size={18} />
              <strong>{t("workspaceOverview")}</strong>
              <span>{t("localProject")}</span>
            </div>
            <dl>
              {filters.map(({ id, label }) => (
                <div key={id}>
                  <dt>{t(label)}</dt>
                  <dd>
                    {loading
                      ? "—"
                      : id === "all"
                        ? projects.length
                        : projects.filter((project) => project.type === id)
                            .length}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <div className="works-actions" aria-label={t("quickActions")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="quick-action"
                type="button"
                aria-label={t("createWork")}
              >
                <span className="quick-action-icon create-icon">
                  <Plus size={20} />
                </span>
                <span>
                  <strong>{t("createWork")}</strong>
                  <small>{t("createWorkHint")}</small>
                </span>
                <ChevronDown size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => onCreate("novel")}>
                <BookOpen size={16} />
                {t("createNovel")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCreate("screenplay")}>
                <Clapperboard size={16} />
                {t("createScreenplay")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            className="quick-action"
            type="button"
            onClick={onImport}
            aria-label={t("importProject")}
          >
            <span className="quick-action-icon import-icon">
              <FolderInput size={20} />
            </span>
            <span>
              <strong>{t("importProject")}</strong>
              <small>{t("quickImportHint")}</small>
            </span>
          </button>
          <button
            className="quick-action"
            type="button"
            onClick={onOpenCredentials}
            aria-label={t("quickAi")}
          >
            <span className="quick-action-icon ai-icon">
              <Sparkles size={20} />
            </span>
            <span>
              <strong>{t("quickAi")}</strong>
              <small>{t("quickAiHint")}</small>
            </span>
          </button>
          <button
            className="quick-action"
            type="button"
            onClick={onOpenTheme}
            aria-label={t("quickAppearance")}
          >
            <span className="quick-action-icon appearance-icon">
              <Palette size={20} />
            </span>
            <span>
              <strong>{t("quickAppearance")}</strong>
              <small>{t("quickAppearanceHint")}</small>
            </span>
          </button>
        </div>

        <div className="works-toolbar">
          <div className="filter-tabs">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="active"
                  type="button"
                  aria-label={t("workType")}
                >
                  {t(
                    filters.find(({ id }) => id === filter)?.label ??
                      "allWorks",
                  )}
                  <ChevronDown size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {filters.map(({ id, label }) => (
                  <DropdownMenuItem key={id} onSelect={() => setFilter(id)}>
                    {t(label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <label className="works-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              aria-label={t("searchWorks")}
              placeholder={t("searchWorks")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        {error !== undefined ? (
          <div className="center-alert" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <section
            className="works-grid"
            aria-label={t("loading")}
            aria-busy="true"
          >
            {Array.from({ length: 6 }, (_, index) => (
              <div
                className="work-card work-skeleton"
                key={index}
                aria-hidden="true"
              >
                <Skeleton className="work-cover" />
                <div className="work-card-body">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </section>
        ) : visibleProjects.length === 0 ? (
          <section className="works-empty">
            <span className="works-empty-icon" aria-hidden="true">
              <FilePlus2 size={36} strokeWidth={1.3} />
            </span>
            <h2>{query.length > 0 ? t("noSearchResults") : t("noWorks")}</h2>
            <p>{query.length > 0 ? t("tryAnotherSearch") : t("noWorksHint")}</p>
            {query.length === 0 ? (
              <div className="empty-actions">
                <button
                  className="button primary"
                  type="button"
                  onClick={() => onCreate("novel")}
                >
                  <BookOpen size={16} aria-hidden="true" />
                  {t("createNovel")}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onCreate("screenplay")}
                >
                  <Clapperboard size={16} aria-hidden="true" />
                  {t("createScreenplay")}
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="works-grid" aria-label={t("works")}>
            {visibleProjects.map((project, index) => (
              <button
                key={project.id}
                className={`work-card work-card-${index % 4}`}
                type="button"
                aria-label={`${t("openWork")}: ${project.name}`}
                onClick={() => onOpenProject(project)}
              >
                <span className="work-cover" aria-hidden="true">
                  <span className="work-cover-label">{t("localProject")}</span>
                  <span className="cover-rule" />
                  {project.type === "novel" ? (
                    <BookOpen size={25} />
                  ) : (
                    <Clapperboard size={25} />
                  )}
                  <strong>{project.name}</strong>
                  <small>AUTHOR COPILOT</small>
                </span>
                <span className="work-card-body">
                  <strong>{project.name}</strong>
                  <span>
                    {project.type === "novel"
                      ? t("projectTypeNovel")
                      : t("projectTypeScreenplay")}
                    <i aria-hidden="true" />
                    {t("localProject")}
                  </span>
                  <small>{project.rootDisplayName}</small>
                </span>
              </button>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
