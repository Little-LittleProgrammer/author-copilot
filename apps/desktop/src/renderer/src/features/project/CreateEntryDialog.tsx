import { useRef, useState, type FormEvent, type JSX } from "react";
import type { ProjectCreateEntryRequest } from "@author-copilot/contracts";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { createEntryLabel } from "./structure-presentation.js";
import type { MessageKey } from "../../i18n/index.js";

export function CreateEntryDialog({
  role,
  onCreate,
  onClose,
  t,
}: {
  readonly role: ProjectCreateEntryRequest["role"];
  readonly onCreate: (name: string) => Promise<void>;
  readonly onClose: () => void;
  readonly t: (key: MessageKey) => string;
}): JSX.Element {
  const created = useRef(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await onCreate(name.trim());
      created.current = true;
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorGeneric"));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        closeLabel={t("close")}
        onCloseAutoFocus={(event) => {
          if (!created.current) return;
          event.preventDefault();
          window.document
            .querySelector<HTMLTextAreaElement>("[data-testid=document-editor]")
            ?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(createEntryLabel(role))}</DialogTitle>
          <DialogDescription>{t("createEntryHint")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="entry-name">{t("entryName")}</Label>
            <Input
              id="entry-name"
              autoFocus
              required
              maxLength={240}
              disabled={busy}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
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
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? t("saving") : t("createEntrySubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
