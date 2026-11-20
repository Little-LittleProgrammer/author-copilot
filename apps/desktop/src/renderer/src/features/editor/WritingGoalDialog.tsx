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

export function WritingGoalDialog({
  dailyTarget,
  onClose,
  onReturnFocus,
  onSave,
  open,
  t,
}: {
  readonly dailyTarget: number;
  readonly onClose: () => void;
  readonly onReturnFocus: () => void;
  readonly onSave: (dailyTarget: number) => Promise<void>;
  readonly open: boolean;
  readonly t: (key: MessageKey) => string;
}): JSX.Element | null {
  const [value, setValue] = useState(String(dailyTarget));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
      setError(t("writingGoalInvalid"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSave(parsed);
      onClose();
    } catch {
      setError(t("writingGoalUnavailable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        closeLabel={t("close")}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("writingGoalSet")}</DialogTitle>
          <DialogDescription>{t("writingGoalHint")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="writing-goal-target">
              {t("writingGoal")} ({t("writingGoalCharacters")})
            </Label>
            <Input
              id="writing-goal-target"
              data-testid="writing-goal-input"
              type="number"
              min={0}
              max={1_000_000}
              step={1}
              inputMode="numeric"
              autoFocus
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
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
              data-testid="writing-goal-save"
              disabled={busy}
            >
              {busy ? t("saving") : t("writingGoalSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
