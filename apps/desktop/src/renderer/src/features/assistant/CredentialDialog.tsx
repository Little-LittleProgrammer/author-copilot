import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { KeyRound, ShieldCheck, Trash2, X } from "lucide-react";

import type { AnthropicCredentialStatus } from "@author-copilot/contracts";

import type { Locale, MessageKey } from "../../i18n/index.js";

interface CredentialDialogProps {
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly t: (key: MessageKey) => string;
}

function operationError(code: string, fallback: MessageKey): MessageKey {
  return code === "AI_UNAVAILABLE"
    ? "anthropicSecureStorageUnavailable"
    : fallback;
}

export function CredentialDialog({
  locale,
  onClose,
  t,
}: CredentialDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<AnthropicCredentialStatus>();
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<"delete" | "save">();
  const [error, setError] = useState<MessageKey>();
  const [notice, setNotice] = useState<MessageKey>();

  useEffect(() => {
    dialogRef.current?.showModal();
    let current = true;
    void window.authorCopilot.credentials.anthropic
      .getStatus()
      .then((response) => {
        if (!current) return;
        if (response.ok) setStatus(response.status);
        else {
          setError(
            operationError(response.error.code, "anthropicStatusLoadFailed"),
          );
        }
      })
      .catch(() => {
        if (current) setError("anthropicStatusLoadFailed");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (apiKey.length === 0 || operation !== undefined) return;
    const key = apiKey;
    setApiKey("");
    setError(undefined);
    setNotice(undefined);
    setOperation("save");
    try {
      const response = await window.authorCopilot.credentials.anthropic.set({
        apiKey: key,
      });
      if (!response.ok) {
        setError(operationError(response.error.code, "anthropicSaveFailed"));
        return;
      }
      setStatus(response.status);
      setNotice("anthropicSaved");
    } catch {
      setError("anthropicSaveFailed");
    } finally {
      setOperation(undefined);
    }
  };

  const remove = async (): Promise<void> => {
    if (
      operation !== undefined ||
      !window.confirm(t("anthropicDeleteConfirm"))
    ) {
      return;
    }
    setError(undefined);
    setNotice(undefined);
    setOperation("delete");
    try {
      const response =
        await window.authorCopilot.credentials.anthropic.delete();
      if (!response.ok) {
        setError(operationError(response.error.code, "anthropicDeleteFailed"));
        return;
      }
      setStatus(response.status);
      setNotice("anthropicDeleted");
    } catch {
      setError("anthropicDeleteFailed");
    } finally {
      setOperation(undefined);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="theme-dialog credential-dialog"
      data-testid="anthropic-credential-dialog"
      onCancel={onClose}
      onClose={onClose}
    >
      <header className="theme-dialog-header">
        <div>
          <span className="eyebrow">{t("aiSettings")}</span>
          <h2>{t("anthropicCredentialSettings")}</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>

      <div className="theme-dialog-body credential-dialog-body">
        <section className="credential-security-note">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>{t("anthropicStoredSecurely")}</strong>
            <p>{t("anthropicCredentialDescription")}</p>
          </div>
        </section>

        <section className="credential-status" aria-live="polite">
          <span>{t("anthropicConnectionStatus")}</span>
          {loading ? (
            <strong data-testid="anthropic-credential-status">
              {t("loading")}
            </strong>
          ) : status === undefined ? (
            <strong data-testid="anthropic-credential-status">
              {t("anthropicStatusUnknown")}
            </strong>
          ) : status?.configured === true ? (
            <strong
              className="configured"
              data-testid="anthropic-credential-status"
            >
              {t("anthropicConfigured")}
            </strong>
          ) : (
            <strong data-testid="anthropic-credential-status">
              {t("anthropicNotConfigured")}
            </strong>
          )}
          {status?.updatedAt !== null && status?.updatedAt !== undefined ? (
            <small>
              {t("anthropicUpdatedAt")}{" "}
              {new Date(status.updatedAt).toLocaleString(locale)}
            </small>
          ) : null}
        </section>

        <form
          className="credential-form"
          onSubmit={(event) => void save(event)}
        >
          <label htmlFor="anthropic-api-key">
            <span>{t("anthropicApiKey")}</span>
            <span className="credential-key-input">
              <KeyRound size={15} aria-hidden="true" />
              <input
                id="anthropic-api-key"
                data-testid="anthropic-api-key"
                type="password"
                autoComplete="off"
                maxLength={16 * 1024}
                placeholder={t("anthropicApiKeyPlaceholder")}
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </span>
          </label>
          <p>{t("anthropicKeyNeverReturned")}</p>

          {error !== undefined ? (
            <p className="credential-message error" role="alert">
              {t(error)}
            </p>
          ) : null}
          {notice !== undefined ? (
            <p className="credential-message success" role="status">
              {t(notice)}
            </p>
          ) : null}

          <footer className="credential-actions">
            {status?.configured === true ? (
              <button
                className="button danger"
                type="button"
                disabled={operation !== undefined}
                data-testid="anthropic-credential-delete"
                onClick={() => void remove()}
              >
                <Trash2 size={14} aria-hidden="true" />
                {operation === "delete"
                  ? t("anthropicDeleting")
                  : t("anthropicDelete")}
              </button>
            ) : null}
            <button
              className="button primary"
              type="submit"
              disabled={
                loading || operation !== undefined || apiKey.length === 0
              }
              data-testid="anthropic-credential-save"
            >
              {operation === "save"
                ? t("anthropicSaving")
                : status?.configured === true
                  ? t("anthropicReplace")
                  : t("anthropicSave")}
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  );
}
