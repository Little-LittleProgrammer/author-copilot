import { useEffect, useRef, useState, type JSX } from "react";
import { X } from "lucide-react";
import type {
  GlobalAssistantMessage,
  GlobalAssistantResponse,
} from "@author-copilot/contracts";
import type { MessageKey } from "../../i18n/index.js";

export function GlobalAssistant({
  onClose,
  t,
}: {
  onClose: () => void;
  t: (key: MessageKey) => string;
}): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  const [messages, setMessages] = useState<readonly GlobalAssistantMessage[]>(
    [],
  );
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accept = (response: GlobalAssistantResponse) => {
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setMessages(response.messages);
    setBusy(response.running);
  };
  useEffect(() => {
    let active = true;
    void window.authorCopilot
      .globalAssistant({ action: "get" })
      .then((response) => {
        if (active) accept(response);
      })
      .catch(() => {
        if (active) setError(t("errorGeneric"));
      });
    return () => {
      active = false;
      void window.authorCopilot
        .globalAssistant({ action: "cancel" })
        .catch(() => undefined);
    };
  }, [t]);
  const send = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    const question = prompt;
    setPrompt("");
    setMessages((previous) => [
      ...previous,
      { role: "user", content: question, createdAt: new Date().toISOString() },
    ]);
    try {
      accept(
        await window.authorCopilot.globalAssistant({
          action: "send",
          prompt: question,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="global-assistant"
      role="dialog"
      aria-modal="true"
      aria-label={t("globalAssistant")}
      data-testid="global-assistant"
    >
      <header>
        <div>
          <h2>{t("globalAssistant")}</h2>
          <p>{t("globalAssistantHint")}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={t("close")}
        >
          <X size={18} />
        </button>
      </header>
      <div className="global-assistant-messages" aria-live="polite">
        {messages.map((message, index) => (
          <article
            key={index}
            className={`global-message global-message-${message.role}`}
          >
            <strong>
              {message.role === "user"
                ? t("globalAssistantYou")
                : t("globalAssistant")}
            </strong>
            <p>{message.content}</p>
          </article>
        ))}
        {busy ? <p role="status">{t("globalAssistantWorking")}</p> : null}
      </div>
      {error ? (
        <p role="alert" className="inline-alert">
          {error}
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          autoFocus
          aria-label={t("globalAssistantQuestion")}
          data-testid="global-assistant-input"
          value={prompt}
          maxLength={20000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t("globalAssistantPlaceholder")}
          disabled={busy}
        />
        <div>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              void window.authorCopilot
                .globalAssistant({ action: "clear" })
                .then(accept);
            }}
          >
            {t("globalAssistantClear")}
          </button>
          {busy ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                void window.authorCopilot.globalAssistant({ action: "cancel" });
              }}
            >
              {t("globalAssistantCancel")}
            </button>
          ) : (
            <button
              className="button primary"
              type="submit"
              disabled={!prompt.trim()}
            >
              {t("globalAssistantSend")}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
