import { useState, type JSX } from "react";

import type { MessageKey } from "../../i18n/index.js";
import type { ProjectSummary, StructureNode } from "./types.js";

interface ProjectSidebarProps {
  readonly activeDocumentPath: string | undefined;
  readonly activeProject: ProjectSummary | undefined;
  readonly loading: boolean;
  readonly onCreate: (type: "novel" | "screenplay") => void;
  readonly onImport: () => void;
  readonly onSelectDocument: (node: StructureNode) => void;
  readonly onSelectProject: (project: ProjectSummary) => void;
  readonly projects: readonly ProjectSummary[];
  readonly structure: readonly StructureNode[];
  readonly t: (key: MessageKey) => string;
}

function TreeNode({
  activePath,
  node,
  onSelect,
}: {
  readonly activePath: string | undefined;
  readonly node: StructureNode;
  readonly onSelect: (node: StructureNode) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const isDocument = node.kind === "document" && node.path !== undefined;
  return (
    <li>
      <button
        className={`tree-row${activePath === node.path ? " active" : ""}`}
        type="button"
        aria-expanded={isDocument ? undefined : expanded}
        onClick={() =>
          isDocument ? onSelect(node) : setExpanded((value) => !value)
        }
      >
        <span className="tree-disclosure" aria-hidden="true">
          {isDocument ? "·" : expanded ? "⌄" : "›"}
        </span>
        <span className="tree-name">{node.name}</span>
      </button>
      {!isDocument && expanded && node.children !== undefined ? (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              activePath={activePath}
              node={child}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ProjectSidebar(props: ProjectSidebarProps): JSX.Element {
  const {
    activeDocumentPath,
    activeProject,
    loading,
    onCreate,
    onImport,
    onSelectDocument,
    onSelectProject,
    projects,
    structure,
    t,
  } = props;
  return (
    <aside className="sidebar" aria-label={t("projects")}>
      <div className="sidebar-section project-section">
        <div className="section-heading">
          <span>{t("projects")}</span>
          <button
            className="icon-button small"
            type="button"
            title={t("createProject")}
            aria-label={t("createProject")}
            onClick={() => onCreate("novel")}
          >
            +
          </button>
        </div>
        <div className="project-actions">
          <button type="button" onClick={() => onCreate("novel")}>
            {t("createNovel")}
          </button>
          <button type="button" onClick={() => onCreate("screenplay")}>
            {t("createScreenplay")}
          </button>
          <button type="button" onClick={onImport}>
            {t("importProject")}
          </button>
        </div>
        {loading ? <p className="sidebar-note">{t("loading")}</p> : null}
        {!loading && projects.length === 0 ? (
          <div className="sidebar-empty">
            <strong>{t("noProjects")}</strong>
            <p>{t("noProjectsHint")}</p>
          </div>
        ) : (
          <select
            className="project-select"
            value={activeProject?.id ?? ""}
            aria-label={t("project")}
            onChange={(event) => {
              const project = projects.find(
                ({ id }) => id === event.target.value,
              );
              if (project !== undefined) onSelectProject(project);
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="sidebar-section structure-section">
        <div className="section-heading">
          <span>{t("structure")}</span>
        </div>
        {activeProject !== undefined && structure.length === 0 && !loading ? (
          <p className="sidebar-note">{t("documentEmpty")}</p>
        ) : null}
        <ul className="structure-tree">
          {structure.map((node) => (
            <TreeNode
              key={node.id}
              activePath={activeDocumentPath}
              node={node}
              onSelect={onSelectDocument}
            />
          ))}
        </ul>
      </div>
    </aside>
  );
}
