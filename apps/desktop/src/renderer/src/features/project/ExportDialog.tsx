import { useState, type FormEvent, type JSX } from "react";
import type {
  ProjectExportFormat,
  ProjectExportRequest,
} from "@author-copilot/contracts";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Label } from "@/components/ui/label.js";
import type { MessageKey } from "../../i18n/index.js";

export type ExportSelection =
  | Omit<
      Extract<ProjectExportRequest, { scope: "project" }>,
      "projectId" | "locale"
    >
  | Omit<
      Extract<ProjectExportRequest, { scope: "chapter" }>,
      "projectId" | "locale"
    >;

export function ExportDialog({
  currentPath,
  currentTitle,
  dirty,
  saveError,
  saving,
  canExport,
  onSave,
  onExport,
  onClose,
  t,
}: {
  readonly currentPath: string | undefined;
  readonly currentTitle: string | undefined;
  readonly dirty: boolean;
  readonly saveError: string | undefined;
  readonly saving: boolean;
  readonly canExport: boolean;
  readonly onSave: () => void;
  readonly onExport: (selection: ExportSelection) => Promise<boolean>;
  readonly onClose: () => void;
  readonly t: (key: MessageKey) => string;
}): JSX.Element {
  const [scope, setScope] = useState<"project" | "chapter">("project");
  const [format, setFormat] = useState<ProjectExportFormat>("docx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || !canExport || (scope === "chapter" && !currentPath)) return;
    setBusy(true);
    setError(undefined);
    try {
      const completed = await onExport(
        scope === "chapter" && currentPath
          ? { scope, relativePath: currentPath, format }
          : { scope: "project", format },
      );
      if (completed) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{t("exportManuscript")}</DialogTitle>
          <DialogDescription>{t("exportHint")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="export-scope">{t("exportScope")}</Label>
            <select
              id="export-scope"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              disabled={busy}
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as "project" | "chapter")
              }
            >
              <option value="project">{t("exportWholeWork")}</option>
              <option value="chapter" disabled={!currentPath}>
                {t("exportCurrentChapter")}
                {currentTitle ? ` · ${currentTitle}` : ""}
              </option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="export-format">{t("exportFormat")}</Label>
            <select
              id="export-format"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              disabled={busy}
              value={format}
              onChange={(event) =>
                setFormat(event.target.value as ProjectExportFormat)
              }
            >
              <option value="docx">Word (.docx)</option>
              <option value="txt">TXT (.txt)</option>
              <option value="md">Markdown (.md)</option>
            </select>
          </div>
          <p className="text-sm text-muted-foreground">
            {format === "docx" ? t("exportWordHint") : t("exportTextHint")}
          </p>
          {dirty ? (
            <div className="grid gap-2 text-sm" role="status">
              <p>{t("exportSaveFirst")}</p>
              <Button
                type="button"
                variant="outline"
                disabled={saving || busy}
                onClick={onSave}
              >
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          ) : null}
          {error || (dirty && saveError) ? (
            <p role="alert" className="text-sm text-destructive">
              {error ?? saveError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              data-testid="export-submit"
              disabled={
                busy || !canExport || (scope === "chapter" && !currentPath)
              }
            >
              {busy ? t("exporting") : t("exportChooseDestination")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
