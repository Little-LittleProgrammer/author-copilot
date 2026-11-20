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
import { errorMessage } from "../project/project-api.js";
import { getVersionApi, type VersionResult } from "./version-api.js";

interface VersionDialogProps {
  readonly onClose: () => void;
  readonly onComplete: (result: VersionResult) => void;
  readonly open: boolean;
  readonly projectId: string | undefined;
  readonly projectName: string | undefined;
  readonly t: (key: MessageKey) => string;
}

export function VersionDialog({
  onClose,
  onComplete,
  open,
  projectId,
  projectName,
  t,
}: VersionDialogProps): JSX.Element | null {
  const [message, setMessage] = useState(() => t("versionDefaultMessage"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!open || projectId === undefined) return null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const api = getVersionApi();
    if (api === undefined) {
      setError(t("versionApiUnavailable"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.create({
        projectId,
        message: message.trim(),
      });
      onComplete(result);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, t("versionSaveFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
    >
      <DialogContent
        closeLabel={t("close")}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("saveVersion")}</DialogTitle>
          <DialogDescription>{projectName ?? t("project")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="version-message">{t("versionMessagePrompt")}</Label>
            <Input
              id="version-message"
              autoFocus
              data-testid="version-message"
              maxLength={200}
              required
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
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
              data-testid="version-dialog-submit"
              disabled={busy || message.trim().length === 0}
            >
              {busy ? t("versionSaving") : t("saveVersion")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
