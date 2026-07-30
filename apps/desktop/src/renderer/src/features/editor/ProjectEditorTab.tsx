import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

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
  readonly onProjectUpdate: (project: ProjectSummary) => void;
  readonly project: ProjectSummary;
  readonly runtime: RuntimeInfo | undefined;
  readonly t: (key: MessageKey) => string;
}

function loadAiContext(projectId: string): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`author-copilot.ai-context.${projectId}`) ?? "[]",
    );
    return new Set(
      Array.isArray(value)
        ? value.filter((path): path is string => typeof path === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function flattenStructure(
  nodes: readonly StructureNode[],
): readonly StructureNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenStructure(node.children ?? []),
  ]);
}

export function ProjectEditorTab({
  onDirtyChange,
  onProjectUpdate,
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
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<WorkspaceTab>("content");
  const [aiContextPaths, setAiContextPaths] = useState<ReadonlySet<string>>(
    () => loadAiContext(project.id),
  );
  const dirty = document !== undefined && content !== document.content;
  const aiContextNodes = useMemo(() => {
    const nodeByPath = new Map(
      flattenStructure(structure).map((node) => [node.path, node]),
    );
    return [...aiContextPaths]
      .map((path) => nodeByPath.get(path))
      .filter((node): node is StructureNode => node !== undefined);
  }, [aiContextPaths, structure]);

  useEffect(() => {
    onDirtyChange(project.id, dirty);
  }, [dirty, onDirtyChange, project.id]);

  useEffect(() => {
    localStorage.setItem(
      `author-copilot.ai-context.${project.id}`,
      JSON.stringify([...aiContextPaths]),
    );
  }, [aiContextPaths, project.id]);

  const refreshStructure = useCallback(async (): Promise<void> => {
    const api = getProjectApi();
    if (api === undefined) return;
    setStructure(await api.getStructure({ projectId: project.id }));
  }, [project.id]);

  useEffect(() => {
    const api = getProjectApi();
    if (api === undefined) return;
    let current = true;
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
      if (api === undefined || node.kind !== "document") return;
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
      role: "scene",
    });
  }, [document, selectDocument]);

  const reloadAfterRepositoryChange = useCallback(() => {
    const api = getProjectApi();
    if (api === undefined) return;
    setLoading(true);
    setError(undefined);
    void api
      .getStructure({ projectId: project.id })
      .then(async (nodes) => {
        setStructure(nodes);
        if (document === undefined) return;
        const documentStillExists = flattenStructure(nodes).some(
          (node) => node.kind === "document" && node.path === document.path,
        );
        if (!documentStillExists) {
          setDocument(undefined);
          setContent("");
          return;
        }
        const snapshot = await api.readDocument({
          projectId: project.id,
          path: document.path,
        });
        setDocument(snapshot);
        setContent(snapshot.content);
      })
      .catch((reason: unknown) =>
        setError(errorMessage(reason, t("errorGeneric"))),
      )
      .finally(() => setLoading(false));
  }, [document, project.id, t]);

  const updateProject = useCallback(
    async (title: string): Promise<void> => {
      const api = getProjectApi();
      if (api === undefined) throw new Error(t("projectApiUnavailable"));
      onProjectUpdate(await api.update({ projectId: project.id, title }));
    },
    [onProjectUpdate, project.id, t],
  );

  const renameEntry = useCallback(
    async (node: StructureNode, name: string): Promise<void> => {
      const api = getProjectApi();
      if (api === undefined) {
        setError(t("projectApiUnavailable"));
        return;
      }
      if (dirty) {
        setError(t("renameSaveFirst"));
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        const renamed = await api.renameEntry({
          name,
          path: node.path,
          projectId: project.id,
        });
        setDocument((current) => {
          if (current === undefined) return current;
          if (current.path === renamed.previousPath) {
            return { ...current, path: renamed.path };
          }
          const prefix = `${renamed.previousPath}/`;
          if (!current.path.startsWith(prefix)) return current;
          return {
            ...current,
            path: `${renamed.path}/${current.path.slice(prefix.length)}`,
          };
        });
        setAiContextPaths(
          (current) =>
            new Set(
              [...current].map((path) => {
                if (path === renamed.previousPath) return renamed.path;
                const prefix = `${renamed.previousPath}/`;
                return path.startsWith(prefix)
                  ? `${renamed.path}/${path.slice(prefix.length)}`
                  : path;
              }),
            ),
        );
        await refreshStructure();
      } catch (reason) {
        setError(errorMessage(reason, t("errorGeneric")));
        throw reason;
      } finally {
        setLoading(false);
      }
    },
    [dirty, project.id, refreshStructure, t],
  );

  const deleteEntry = useCallback(
    async (node: StructureNode): Promise<void> => {
      const api = getProjectApi();
      if (api === undefined) {
        setError(t("projectApiUnavailable"));
        return;
      }
      if (dirty) {
        setError(t("renameSaveFirst"));
        return;
      }
      if (!window.confirm(`${t("deleteConfirm")} “${node.name}”?`)) return;
      setLoading(true);
      setError(undefined);
      try {
        await api.deleteEntry({ path: node.path, projectId: project.id });
        const deletedPrefix = `${node.path}/`;
        if (
          document !== undefined &&
          (document.path === node.path ||
            document.path.startsWith(deletedPrefix))
        ) {
          setDocument(undefined);
          setContent("");
        }
        setAiContextPaths(
          (current) =>
            new Set(
              [...current].filter(
                (path) => path !== node.path && !path.startsWith(deletedPrefix),
              ),
            ),
        );
        await refreshStructure();
      } catch (reason) {
        setError(errorMessage(reason, t("errorGeneric")));
      } finally {
        setLoading(false);
      }
    },
    [dirty, document, project.id, refreshStructure, t],
  );

  const toggleAiContext = useCallback((node: StructureNode): void => {
    setAiContextPaths((current) => {
      const next = new Set(current);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  }, []);

  const completeVersion = useCallback(
    (result: VersionResult) => {
      setError(undefined);
      setVersionNotice(
        result.created
          ? `${t("versionSaved")} ${result.shortCommitId ?? ""}`.trim()
          : t("versionNoChanges"),
      );
      if (result.created) setVersionRefreshKey((value) => value + 1);
    },
    [t],
  );

  return (
    <div className="project-editor-tab">
      <div className="workspace">
        <ProjectSidebar
          activeDocumentPath={document?.path}
          activeProject={project}
          aiContextPaths={aiContextPaths}
          canMutateStructure={!dirty && !loading}
          loading={loading}
          onDeleteEntry={deleteEntry}
          onRenameEntry={renameEntry}
          onSelectDocument={selectDocument}
          onToggleAiContext={toggleAiContext}
          onUpdateProject={updateProject}
          structure={structure}
          t={t}
        />
        <EditorWorkspace
          activeProject={project}
          aiContext={aiContextNodes}
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
          onRecoveryRestored={reloadAfterRepositoryChange}
          onSave={save}
          onTabChange={setTab}
          saving={saving}
          tab={tab}
          t={t}
          versionNotice={versionNotice}
          versionRefreshKey={versionRefreshKey}
        />
      </div>
      <footer className="statusbar">
        <span>{project.name}</span>
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
