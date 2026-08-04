import { useMemo, useState, type JSX } from "react";
import {
  BookOpen,
  Clapperboard,
  Coins,
  FilePlus2,
  FolderInput,
  Grid2X2,
  KeyRound,
  Languages,
  LogOut,
  Palette,
  Plus,
  Search,
  WalletCards,
} from "lucide-react";

import type { Locale, MessageKey } from "../../i18n/index.js";
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
            <button className="center-menu-root active" type="button">
              <Grid2X2 size={17} aria-hidden="true" />
              <span>{t("works")}</span>
              <span className="menu-count">{projects.length}</span>
            </button>
            <div className="center-submenu">
              {filters.map(({ id, label }) => (
                <button
                  key={id}
                  className={filter === id ? "active" : ""}
                  type="button"
                  onClick={() => setFilter(id)}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
          <div className="center-menu-group future-menu">
            <span className="menu-section-label">{t("creatorServices")}</span>
            <button type="button" disabled>
              <Coins size={17} aria-hidden="true" />
              <span>{t("points")}</span>
              <small>{t("comingSoon")}</small>
            </button>
            <button type="button" disabled>
              <WalletCards size={17} aria-hidden="true" />
              <span>{t("recharge")}</span>
              <small>{t("comingSoon")}</small>
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
        <header className="works-header">
          <div>
            <span className="eyebrow">{t("writerCenter")}</span>
            <h1>{t("myWorks")}</h1>
            <p>{t("worksDescription")}</p>
          </div>
          <div className="works-actions">
            <button
              className="button secondary"
              type="button"
              onClick={onImport}
            >
              <FolderInput size={16} aria-hidden="true" />
              {t("importProject")}
            </button>
            <button
              className="button primary"
              type="button"
              onClick={() => onCreate("novel")}
            >
              <Plus size={16} aria-hidden="true" />
              {t("createWork")}
            </button>
          </div>
        </header>

        <div className="works-toolbar">
          <div
            className="filter-tabs"
            role="tablist"
            aria-label={t("workType")}
          >
            {filters.map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={filter === id}
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {t(label)}
              </button>
            ))}
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
          <div className="works-empty">{t("loading")}</div>
        ) : visibleProjects.length === 0 ? (
          <section className="works-empty">
            <FilePlus2 size={32} strokeWidth={1.5} aria-hidden="true" />
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
            <button
              className="new-work-card"
              type="button"
              onClick={() => onCreate("novel")}
            >
              <span>
                <Plus size={23} aria-hidden="true" />
              </span>
              <strong>{t("createWork")}</strong>
              <small>{t("createWorkHint")}</small>
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
