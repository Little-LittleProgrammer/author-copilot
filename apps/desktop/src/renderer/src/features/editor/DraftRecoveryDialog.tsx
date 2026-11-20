import { useEffect, useState } from "react";
import type { DocumentDraft } from "@author-copilot/contracts";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import type { MessageKey } from "../../i18n/index.js";
import { errorMessage, getProjectApi } from "../project/project-api.js";

export function DraftRecoveryDialog({
  drafts,
  projectId,
  onClose,
  onRestore,
  onDiscard,
  t,
}: {
  readonly drafts: readonly DocumentDraft[];
  readonly projectId: string;
  readonly onClose: () => void;
  readonly onRestore: (
    draft: DocumentDraft,
    expectedVersion: string,
  ) => Promise<void>;
  readonly onDiscard: (draft: DocumentDraft) => Promise<void>;
  readonly t: (key: MessageKey) => string;
}) {
  const [selected, setSelected] = useState(drafts[0]?.revision);
  const draft = drafts.find((item) => item.revision === selected) ?? drafts[0];
  const [loadedSource, setLoadedSource] = useState<{
    revision: string;
    content?: string;
    version?: string;
    error?: string;
  }>();
  const source =
    loadedSource?.revision === draft?.revision && loadedSource?.version
      ? loadedSource
      : undefined;
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    if (draft)
      void getProjectApi()
        ?.readDocument({ projectId, path: draft.relativePath })
        .then((value) => {
          if (alive) setLoadedSource({ revision: draft.revision, ...value });
        })
        .catch((reason: unknown) => {
          if (alive)
            setLoadedSource({
              revision: draft.revision,
              error: errorMessage(reason, t("draftSourceMissing")),
            });
        });
    return () => {
      alive = false;
    };
  }, [draft, projectId, refresh, t]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
    } catch (reason) {
      setError(errorMessage(reason, t("errorGeneric")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        closeLabel={t("close")}
        className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"
      >
        <DialogTitle>{t("draftRecovery")}</DialogTitle>
        <p>{t("draftReviewBeforeSave")}</p>
        {draft ? (
          <>
            <label>
              {t("draftChoose")}
              <select
                disabled={busy}
                value={draft.revision}
                className="ml-2 max-w-full rounded-md border border-border bg-background p-2"
                onChange={(event) => {
                  setSelected(event.target.value);
                  setError(undefined);
                }}
              >
                {drafts.map((item) => (
                  <option key={item.revision} value={item.revision}>
                    {item.relativePath} ·{" "}
                    {new Date(item.updatedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            {source && source.version !== draft.baseHash ? (
              <p role="alert">{t("draftSourceChanged")}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                {t("draftSavedText")}
                <Textarea
                  className="mt-2 h-52 resize-none"
                  readOnly
                  value={source?.content ?? ""}
                />
              </label>
              <label>
                {t("draftRecoveredText")}
                <Textarea
                  className="mt-2 h-52 resize-none"
                  readOnly
                  value={draft.content}
                />
              </label>
            </div>
            {error ||
            (loadedSource?.revision === draft.revision &&
              loadedSource.error) ? (
              <p role="alert">{error ?? loadedSource?.error}</p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setRefresh((value) => value + 1);
                  setError(undefined);
                }}
              >
                {t("draftRefresh")}
              </Button>
              <Button
                type="button"
                disabled={busy || !source?.version}
                onClick={() => {
                  if (source?.version)
                    void run(() => onRestore(draft, source.version!));
                }}
              >
                {t("draftRestore")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("draftDiscardConfirm")))
                    void run(() => onDiscard(draft));
                }}
              >
                {t("draftDiscard")}
              </Button>
            </div>
          </>
        ) : (
          <p>{t("draftEmpty")}</p>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          {t("draftLater")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
