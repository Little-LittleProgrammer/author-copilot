import { Check, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { useState, type FormEvent, type JSX } from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";

import type { MessageKey } from "../../i18n/index.js";
import { ProjectInfoDialog } from "./ProjectInfoDialog.js";
import type { ProjectSummary, StructureNode } from "./types.js";

interface ProjectSidebarProps {
  readonly activeDocumentPath: string | undefined;
  readonly activeProject: ProjectSummary;
  readonly aiContextPaths: ReadonlySet<string>;
  readonly canMutateStructure: boolean;
  readonly loading: boolean;
  readonly onDeleteEntry: (node: StructureNode) => Promise<void>;
  readonly onRenameEntry: (node: StructureNode, name: string) => Promise<void>;
  readonly onSelectDocument: (node: StructureNode) => void;
  readonly onToggleAiContext: (node: StructureNode) => void;
  readonly onUpdateProject: (title: string) => Promise<void>;
  readonly structure: readonly StructureNode[];
  readonly t: (key: MessageKey) => string;
}

function TreeNode({
  activePath,
  aiContextPaths,
  canMutate,
  node,
  onDelete,
  onRename,
  onSelect,
  onToggleAiContext,
  t,
}: {
  readonly activePath: string | undefined;
  readonly aiContextPaths: ReadonlySet<string>;
  readonly canMutate: boolean;
  readonly node: StructureNode;
  readonly onDelete: (node: StructureNode) => Promise<void>;
  readonly onRename: (node: StructureNode, name: string) => Promise<void>;
  readonly onSelect: (node: StructureNode) => void;
  readonly onToggleAiContext: (node: StructureNode) => void;
  readonly t: (key: MessageKey) => string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  const [busy, setBusy] = useState(false);
  const isDocument = node.kind === "document";
  const isAiContext = aiContextPaths.has(node.path);
  const isProjectEntry = node.role !== "unclassified";
  const canEditNode = canMutate && isProjectEntry;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nextName = name.trim();
    if (nextName.length === 0 || nextName === node.name) {
      setName(node.name);
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onRename(node, nextName);
      setEditing(false);
    } catch {
      // The editor surface presents the structured project error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      {editing ? (
        <form
          className="tree-rename-form"
          onSubmit={(event) => void submit(event)}
        >
          <input
            autoFocus
            aria-label={t("rename")}
            maxLength={252}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setName(node.name);
                setEditing(false);
              }
            }}
          />
          <button type="submit" aria-label={t("confirmRename")} disabled={busy}>
            <Check size={13} />
          </button>
          <button
            type="button"
            aria-label={t("cancelRename")}
            disabled={busy}
            onClick={() => {
              setName(node.name);
              setEditing(false);
            }}
          >
            <X size={13} />
          </button>
        </form>
      ) : (
        <ContextMenuPrimitive.Root>
          <ContextMenuPrimitive.Trigger asChild>
            <div
              className={`tree-row${activePath === node.path ? " active" : ""}${isAiContext ? " ai-context" : ""}`}
            >
              <button
                className="tree-row-main"
                type="button"
                aria-expanded={isDocument ? undefined : expanded}
                onClick={() =>
                  isDocument ? onSelect(node) : setExpanded((value) => !value)
                }
              >
                <span className="tree-disclosure" aria-hidden="true">
                  {isDocument ? "·" : expanded ? "⌄" : "›"}
                </span>
                <span className="tree-name">
                  {node.role === "unclassified" ? t("unclassified") : node.name}
                </span>
                {isAiContext ? (
                  <Sparkles
                    className="tree-ai-indicator"
                    size={11}
                    aria-label={t("inAiContext")}
                  />
                ) : null}
              </button>
              {canEditNode ? (
                <button
                  className="tree-rename-button"
                  type="button"
                  aria-label={`${t("rename")}: ${node.name}`}
                  title={t("rename")}
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={12} />
                </button>
              ) : null}
            </div>
          </ContextMenuPrimitive.Trigger>
          <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Content className="z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
              <ContextMenuPrimitive.Item
                className="context-menu-item"
                disabled={!canEditNode}
                onSelect={() => setEditing(true)}
              >
                <Pencil size={14} />
                {t("editName")}
              </ContextMenuPrimitive.Item>
              <ContextMenuPrimitive.Item
                className="context-menu-item"
                disabled={!isProjectEntry}
                onSelect={() => onToggleAiContext(node)}
              >
                <Sparkles size={14} />
                {isAiContext ? t("removeFromAi") : t("addToAi")}
              </ContextMenuPrimitive.Item>
              <ContextMenuPrimitive.Separator className="context-menu-separator" />
              <ContextMenuPrimitive.Item
                className="context-menu-item destructive"
                disabled={!canEditNode}
                onSelect={() => void onDelete(node)}
              >
                <Trash2 size={14} />
                {t("delete")}
              </ContextMenuPrimitive.Item>
            </ContextMenuPrimitive.Content>
          </ContextMenuPrimitive.Portal>
        </ContextMenuPrimitive.Root>
      )}
      {!isDocument && expanded && node.children !== undefined ? (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              activePath={activePath}
              aiContextPaths={aiContextPaths}
              canMutate={canMutate}
              node={child}
              onDelete={onDelete}
              onRename={onRename}
              onSelect={onSelect}
              onToggleAiContext={onToggleAiContext}
              t={t}
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
    aiContextPaths,
    canMutateStructure,
    loading,
    onDeleteEntry,
    onRenameEntry,
    onSelectDocument,
    onToggleAiContext,
    onUpdateProject,
    structure,
    t,
  } = props;
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <aside className="sidebar" aria-label={t("projects")}>
      <div className="sidebar-section project-section editor-project-summary">
        <span className="eyebrow">{t("currentWork")}</span>
        <div className="project-summary-title">
          <strong>{activeProject.name}</strong>
          <button
            className="project-info-button"
            type="button"
            aria-label={t("editWorkInfo")}
            title={t("editWorkInfo")}
            onClick={() => setInfoOpen(true)}
          >
            <Pencil size={13} />
          </button>
        </div>
        <span>
          {activeProject.type === "screenplay"
            ? t("projectTypeScreenplay")
            : t("projectTypeNovel")}
        </span>
      </div>

      <div className="sidebar-section structure-section">
        <div className="section-heading">
          <span>{t("structure")}</span>
        </div>
        {structure.length === 0 && !loading ? (
          <p className="sidebar-note">{t("documentEmpty")}</p>
        ) : null}
        <ul className="structure-tree">
          {structure.map((node) => (
            <TreeNode
              key={node.id}
              activePath={activeDocumentPath}
              aiContextPaths={aiContextPaths}
              canMutate={canMutateStructure}
              node={node}
              onDelete={onDeleteEntry}
              onRename={onRenameEntry}
              onSelect={onSelectDocument}
              onToggleAiContext={onToggleAiContext}
              t={t}
            />
          ))}
        </ul>
      </div>

      <ProjectInfoDialog
        key={`project-info-${infoOpen ? activeProject.name : "closed"}`}
        onClose={() => setInfoOpen(false)}
        onSave={onUpdateProject}
        open={infoOpen}
        project={activeProject}
        t={t}
      />
    </aside>
  );
}
