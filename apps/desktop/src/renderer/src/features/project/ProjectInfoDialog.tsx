import { useState, type FormEvent, type JSX } from "react";

import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import type { MessageKey } from "../../i18n/index.js";
import type { ProjectSummary } from "./types.js";

interface ProjectInfoDialogProps {
  readonly onClose: () => void;
  readonly onSave: (title: string) => Promise<void>;
  readonly open: boolean;
  readonly project: ProjectSummary;
  readonly t: (key: MessageKey) => string;
}

export function ProjectInfoDialog({
  onClose,
  onSave,
  open,
  project,
  t,
}: ProjectInfoDialogProps): JSX.Element | null {
  const [title, setTitle] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onSave(title.trim());
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{t("workInfo")}</DialogTitle>
          <DialogDescription>{t("workInfoHint")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="project-title">{t("workTitle")}</Label>
            <Input
              id="project-title"
              autoFocus
              data-testid="project-title"
              maxLength={200}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("workType")}</Label>
            <p className="text-sm text-muted-foreground">
              {project.type === "novel"
                ? t("projectTypeNovel")
                : t("projectTypeScreenplay")}
            </p>
          </div>
          {error !== undefined ? (
            <p
              className="rounded-sm bg-[var(--alert-bg)] px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                {t("close")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              data-testid="project-info-submit"
              disabled={
                busy ||
                title.trim().length === 0 ||
                title.trim() === project.name
              }
            >
              {busy ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
