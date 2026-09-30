import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";

import type { MessageKey } from "../../i18n/index.js";
import { errorMessage, getProjectApi } from "./project-api.js";
import {
  ProjectApiError,
  type ImportPreview,
  type ImportPreviewNode,
  type ProjectSummary,
  type ProjectType,
} from "./types.js";

function PreviewTree({
  nodes,
}: {
  readonly nodes: readonly ImportPreviewNode[];
}): JSX.Element {
  return (
    <ul className="preview-tree">
      {nodes.map((node, index) => (
        <li key={`${node.name}-${String(index)}`}>
          <span>{node.name}</span>
          {node.children.length > 0 ? (
            <PreviewTree nodes={node.children} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface ProjectDialogProps {
  readonly kind: ProjectType | "import" | null;
  readonly onClose: () => void;
  readonly onComplete: (project: ProjectSummary) => void;
  readonly t: (key: MessageKey) => string;
}

export function ProjectDialog({
  kind,
  onClose,
  onComplete,
  t,
}: ProjectDialogProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>("novel");
  const [importMode, setImportMode] = useState<"copy" | "in_place">("in_place");
  const [preview, setPreview] = useState<ImportPreview | null>();
  const [splitChapters, setSplitChapters] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reassignDuplicate, setReassignDuplicate] = useState(false);

  useEffect(() => {
    if (kind === null) return;
    dialogRef.current?.showModal();
  }, [kind]);

  if (kind === null) return null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const api = getProjectApi();
    if (api === undefined) {
      setError(t("projectApiUnavailable"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const project =
        kind === "import"
          ? await api.confirmImport({
              mode: preview?.sourceKind === "file" ? "copy" : importMode,
              previewToken: preview?.previewToken ?? "",
              ...(importMode === "in_place" && reassignDuplicate
                ? { reassignProjectId: true }
                : {}),
            })
          : await api.create({ name: name.trim(), type: kind });
      onComplete(project);
      dialogRef.current?.close();
      onClose();
    } catch (reason) {
      if (
        kind === "import" &&
        importMode === "in_place" &&
        reason instanceof ProjectApiError &&
        reason.code === "duplicate_project_id"
      ) {
        setReassignDuplicate(true);
        setError(t("duplicateProject"));
      } else {
        setError(importError(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  const importError = (reason: unknown): string => {
    if (reason instanceof ProjectApiError && reason.code === "invalid_import") {
      const keys: Readonly<Record<string, MessageKey>> = {
        unsupported: "importUnsupported",
        too_large: "importTooLarge",
        unreadable: "importUnreadable",
        empty: "importEmpty",
        changed: "importChanged",
        too_many_chapters: "importTooManyChapters",
      };
      return t(keys[reason.importReason ?? ""] ?? "importUnreadable");
    }
    return errorMessage(reason, t("errorGeneric"));
  };
  const inspectSource = async (
    sourceKind: "folder" | "file",
  ): Promise<void> => {
    const api = getProjectApi();
    if (api === undefined) {
      setError(t("projectApiUnavailable"));
      return;
    }
    setBusy(true);
    setError(undefined);
    setReassignDuplicate(false);
    setPreview(undefined);
    try {
      const next = await api.previewImport(
        projectType,
        sourceKind,
        splitChapters,
      );
      setPreview(next);
      if (next?.sourceKind === "file") setImportMode("copy");
    } catch (reason) {
      setError(importError(reason));
    } finally {
      setBusy(false);
    }
  };

  const title = kind === "import" ? t("importTitle") : t("createProject");
  return (
    <dialog
      ref={dialogRef}
      className={`project-dialog${kind === "import" ? " import-dialog" : ""}`}
      onCancel={onClose}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <header>
          <div>
            <span className="eyebrow">
              {kind === "import" ? t("import") : t("create")}
            </span>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={t("close")}
            title={t("close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {kind === "import" ? (
          <div className="dialog-body">
            <p className="dialog-description">{t("importHint")}</p>
            <label>
              <span>{t("project")}</span>
              <select
                value={projectType}
                disabled={busy}
                onChange={(event) => {
                  setProjectType(event.target.value as ProjectType);
                  setPreview(undefined);
                  setError(undefined);
                }}
              >
                <option value="novel">{t("projectTypeNovel")}</option>
                <option value="screenplay">{t("projectTypeScreenplay")}</option>
              </select>
            </label>
            <label className="import-split-option">
              <input
                type="checkbox"
                checked={splitChapters}
                disabled={busy}
                onChange={(event) => {
                  setSplitChapters(event.target.checked);
                  if (preview?.sourceKind === "file") setPreview(undefined);
                  setError(undefined);
                }}
              />
              <span>{t("importAutoSplit")}</span>
            </label>
            <p className="field-note">{t("importSplitHint")}</p>
            <div className="import-source-actions">
              <button
                className="button secondary inspect-button"
                type="button"
                disabled={busy}
                onClick={() => void inspectSource("folder")}
              >
                {t("selectFolder")}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => void inspectSource("file")}
              >
                {t("importSelectFile")}
              </button>
            </div>
            {busy ? <p className="dialog-state">{t("importing")}</p> : null}
            {!busy && preview === null ? (
              <p className="dialog-state">{t("importNoPreview")}</p>
            ) : null}
            {preview !== undefined && preview !== null ? (
              <dl className="import-preview">
                <div>
                  <dt>{t("name")}</dt>
                  <dd>{preview.name}</dd>
                </div>
                <div>
                  <dt>{t("project")}</dt>
                  <dd>
                    {preview.type === "novel"
                      ? t("projectTypeNovel")
                      : t("projectTypeScreenplay")}
                  </dd>
                </div>
                <div>
                  <dt>{t("previewFiles")}</dt>
                  <dd>{preview.fileCount}</dd>
                </div>
              </dl>
            ) : null}
            {preview !== undefined && preview !== null ? (
              <div className="import-structure-preview">
                <strong>{t("recognizedStructure")}</strong>
                <PreviewTree nodes={preview.structure} />
                {preview.unclassified.length > 0 ? (
                  <div>
                    <strong>{t("unclassified")}</strong>
                    <ul className="preview-tree">
                      {preview.unclassified.map((file) => (
                        <li key={file}>{file}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {preview?.document ? (
              <section className="import-document-preview">
                <strong>
                  {t("importTextPreview")} ·{" "}
                  {preview.document.format.toUpperCase()} ·{" "}
                  {preview.document.characterCount} {t("editorWordCount")}
                </strong>
                <p className="field-note" data-testid="import-split-summary">
                  {t(
                    !preview.document.splitChapters
                      ? "importSplitOff"
                      : preview.document.matchedChapterCount === 0
                        ? "importSplitNoMatches"
                        : "importSplitMatched",
                  )}
                  {preview.document.splitChapters &&
                  preview.document.matchedChapterCount > 0
                    ? ` ${preview.document.matchedChapterCount}`
                    : ""}
                </p>
                <pre>{preview.document.textPreview}</pre>
                <p className="field-note">{t("importDocumentHint")}</p>
              </section>
            ) : null}
            {preview !== undefined &&
            preview !== null &&
            preview.sourceKind === "folder" ? (
              <label>
                <span>{t("importMode")}</span>
                <select
                  value={importMode}
                  onChange={(event) =>
                    setImportMode(event.target.value as "copy" | "in_place")
                  }
                >
                  <option value="in_place">{t("importInPlace")}</option>
                  <option value="copy">{t("importCopy")}</option>
                </select>
              </label>
            ) : null}
          </div>
        ) : (
          <div className="dialog-body">
            <p className="dialog-description">{t("createHint")}</p>
            <label>
              <span>{t("name")}</span>
              <input
                autoFocus
                data-testid="project-name"
                required
                value={name}
                placeholder={t("namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <span>{t("location")}</span>
              <span className="field-note">{t("locationPickerHint")}</span>
            </label>
          </div>
        )}

        {error !== undefined ? (
          <p className="inline-alert" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {t("close")}
          </button>
          <button
            type="submit"
            className="button primary"
            data-testid="project-dialog-submit"
            disabled={busy || (kind === "import" && !preview)}
          >
            {kind === "import"
              ? reassignDuplicate
                ? t("registerCopy")
                : t("importConfirm")
              : t("create")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
