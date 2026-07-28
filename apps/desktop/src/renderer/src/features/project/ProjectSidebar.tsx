import { useState, type JSX } from "react";

import type { MessageKey } from "../../i18n/index.js";
import type { ProjectSummary, StructureNode } from "./types.js";

interface ProjectSidebarProps {
  readonly activeDocumentPath: string | undefined;
  readonly activeProject: ProjectSummary | undefined;
  readonly loading: boolean;
  readonly onSelectDocument: (node: StructureNode) => void;
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
    onSelectDocument,
    structure,
    t,
  } = props;
  return (
    <aside className="sidebar" aria-label={t("projects")}>
      <div className="sidebar-section project-section editor-project-summary">
        <span className="eyebrow">{t("currentWork")}</span>
        <strong>{activeProject?.name ?? t("project")}</strong>
        <span>
          {activeProject?.type === "screenplay"
            ? t("projectTypeScreenplay")
            : t("projectTypeNovel")}
        </span>
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
