import {
  announceSettings,
  settingsRequest,
  useAiSettings,
} from "./ai-settings-state.js";
import { useState, type JSX } from "react";
import type { AccountSummary, AiModel } from "@author-copilot/contracts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import type { MessageKey } from "../../i18n/index.js";

const money = (micro: number): string => `¥${(micro / 1000000).toFixed(6)}`;

export function AiSettingsDialog({
  onClose,
  t,
  initialSection = "providers",
}: {
  readonly onClose: () => void;
  readonly t: (key: MessageKey) => string;
  readonly initialSection?: "providers" | "account";
}): JSX.Element {
  const { state, error: loadError, reload } = useAiSettings();
  const [section, setSection] = useState(initialSection);
  const [providerId, setProviderId] = useState("anthropic");
  const [name, setName] = useState("Anthropic");
  const [baseURL, setBaseURL] = useState("https://api.anthropic.com");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [models, setModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [authMode, setAuthMode] = useState<
    "login" | "register" | "forgotPassword" | "resetPassword"
  >("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [account, setAccount] = useState<AccountSummary>();
  const provider = state?.providers.find((entry) => entry.id === providerId);
  async function perform(operation: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      await reload();
      announceSettings();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string): void {
    const selected = state?.providers.find((entry) => entry.id === id);
    setProviderId(id);
    setName(selected?.name ?? "");
    setBaseURL(selected?.baseURL ?? "");
    setApiKey("");
    setModels([]);
    setNotice("");
    setError("");
    if (state?.selection.mode === "custom" && state.selection.providerId === id)
      setModel(state.selection.model);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="ai-settings-dialog"
        closeLabel={t("close")}
        aria-describedby={undefined}
        data-testid="anthropic-credential-dialog"
      >
        <DialogTitle>{t("aiSettings")}</DialogTitle>
        <nav className="assistant-mode-tabs">
          <button
            type="button"
            aria-pressed={section === "providers"}
            onClick={() => setSection("providers")}
          >
            {t("customProviders")}
          </button>
          <button
            type="button"
            aria-pressed={section === "account"}
            onClick={() => {
              setSection("account");
              if (state?.user)
                void perform(async () => {
                  setAccount(
                    (await settingsRequest({ action: "account" })).account,
                  );
                });
            }}
          >
            {t("platformAccount")}
          </button>
        </nav>
        <div className="ai-settings-content">
          {section === "providers" ? (
            <>
              <div className="ai-settings-row">
                <label>
                  {t("customProviders")}
                  <select
                    data-testid="provider-list"
                    disabled={busy}
                    value={providerId}
                    onChange={(event) => choose(event.target.value)}
                  >
                    {state?.providers.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                    <option value="new">{t("providerAdd")}</option>
                  </select>
                </label>
              </div>
              <form
                className="ai-settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const secret = apiKey;
                  setApiKey("");
                  void perform(async () => {
                    const result = await settingsRequest({
                      action: "saveProvider",
                      ...(providerId === "new" ? {} : { id: providerId }),
                      name,
                      baseURL,
                      ...(secret ? { apiKey: secret } : {}),
                    });
                    const saved = result.state?.providers.find(
                      (entry) =>
                        entry.name === name &&
                        entry.baseURL ===
                          baseURL.replace(/\/+$/u, "").replace(/\/v1$/u, ""),
                    );
                    if (saved) setProviderId(saved.id);
                    setNotice(t("anthropicSaved"));
                  });
                }}
              >
                <label>
                  {t("providerName")}
                  <input
                    value={name}
                    required
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label>
                  API Base URL
                  <input
                    data-testid="provider-base-url"
                    value={baseURL}
                    required
                    disabled={providerId === "anthropic"}
                    placeholder="https://api.example.com"
                    onChange={(event) => setBaseURL(event.target.value)}
                  />
                </label>
                <label>
                  API Key
                  <input
                    data-testid="anthropic-api-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={
                      provider?.configured ? t("providerKeepKey") : "API Key"
                    }
                  />
                </label>
                <small>{t("anthropicKeyNeverReturned")}</small>
                <span data-testid="anthropic-credential-status">
                  {t(
                    provider?.configured
                      ? "anthropicConfigured"
                      : "anthropicNotConfigured",
                  )}
                </span>
                <div className="ai-settings-actions">
                  <button
                    className="button primary"
                    data-testid="anthropic-credential-save"
                    disabled={
                      busy ||
                      !name ||
                      !baseURL ||
                      (providerId === "new" && !apiKey)
                    }
                    type="submit"
                  >
                    {t("save")}
                  </button>
                  {provider?.configured ||
                  (provider && providerId !== "anthropic") ? (
                    <button
                      data-testid="anthropic-credential-delete"
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t("anthropicDeleteConfirm")))
                          void perform(async () => {
                            await settingsRequest({
                              action: "deleteProvider",
                              id: providerId,
                            });
                            choose("anthropic");
                          });
                      }}
                    >
                      {t("anthropicDelete")}
                    </button>
                  ) : null}
                </div>
              </form>
              <div className="ai-settings-form">
                <label>
                  {t("aiModel")}
                  <input
                    data-testid="provider-model"
                    list="provider-model-options"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  />
                  <datalist id="provider-model-options">
                    {models.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </datalist>
                </label>
                <small>{t("providerManualModel")}</small>
                <div className="ai-settings-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || !provider?.configured}
                    onClick={() =>
                      void perform(async () => {
                        setModels([]);
                        const result = await settingsRequest({
                          action: "models",
                          providerId,
                        });
                        setModels(result.models ?? []);
                        setNotice(result.notice ?? t("providerModelsLoaded"));
                      })
                    }
                  >
                    {t("providerRefreshModels")}
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || providerId === "new" || !model}
                    onClick={() =>
                      void perform(async () => {
                        await settingsRequest({
                          action: "select",
                          selection: { mode: "custom", providerId, model },
                        });
                        setNotice(t("providerSelected"));
                      })
                    }
                  >
                    {t("providerUse")}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {!state?.platformConfigured ? (
                <p>{t("platformNotConfigured")}</p>
              ) : null}
              {state?.user ? (
                <>
                  <p>{state.user.email}</p>
                  <div className="ai-settings-actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          setAccount(
                            (await settingsRequest({ action: "account" }))
                              .account,
                          );
                        })
                      }
                    >
                      {t("accountRefresh")}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await settingsRequest({ action: "logout" });
                          setAccount(undefined);
                        })
                      }
                    >
                      {t("logout")}
                    </button>
                  </div>
                  <p>
                    {t("accountBalance")}:{" "}
                    {account ? money(account.availableMicro) : "—"} ·{" "}
                    {t("accountHeld")}:{" "}
                    {account ? money(account.heldMicro) : "—"}
                  </p>
                  <p className="payment-unavailable">
                    {t("paymentUnavailable")}
                  </p>
                  <button type="button" className="button secondary" disabled>
                    {t("accountRecharge")}
                  </button>
                  <h3>{t("accountUsage")}</h3>
                  <div className="account-ledger">
                    {account?.records.map((row) => (
                      <div key={row.id}>
                        <span>
                          {new Date(row.createdAt).toLocaleString()} ·{" "}
                          {row.model || t("accountTestCredit")}
                        </span>
                        <span>
                          {t(
                            row.status === "settled"
                              ? "usageSettled"
                              : row.status === "released"
                                ? "usageReleased"
                                : row.status === "pending_review"
                                  ? "usagePending"
                                  : row.status === "credit"
                                    ? "accountTestCredit"
                                    : "usageReserved",
                          )}{" "}
                          · {money(row.chargedMicro)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <form
                  className="ai-settings-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const secret = password;
                    setPassword("");
                    void perform(async () => {
                      const result = await settingsRequest(
                        authMode === "forgotPassword"
                          ? { action: authMode, email }
                          : authMode === "resetPassword"
                            ? { action: authMode, token, password: secret }
                            : { action: authMode, email, password: secret },
                      );
                      if (result.notice) setNotice(result.notice);
                      if (authMode === "login" || authMode === "register")
                        setAccount(
                          (await settingsRequest({ action: "account" }))
                            .account,
                        );
                    });
                  }}
                >
                  <label>
                    {t("accountAction")}
                    <select
                      value={authMode}
                      onChange={(event) =>
                        setAuthMode(event.target.value as typeof authMode)
                      }
                    >
                      <option value="login">{t("accountLogin")}</option>
                      <option value="register">{t("accountRegister")}</option>
                      <option value="forgotPassword">
                        {t("accountForgot")}
                      </option>
                      <option value="resetPassword">{t("accountReset")}</option>
                    </select>
                  </label>
                  {authMode !== "resetPassword" ? (
                    <label>
                      Email
                      <input
                        data-testid="account-email"
                        type="email"
                        autoComplete="username"
                        value={email}
                        required
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </label>
                  ) : (
                    <label>
                      {t("accountResetCode")}
                      <input
                        value={token}
                        required
                        onChange={(event) => setToken(event.target.value)}
                      />
                    </label>
                  )}
                  {authMode !== "forgotPassword" ? (
                    <label>
                      {t("accountPassword")}
                      <input
                        data-testid="account-password"
                        type="password"
                        minLength={10}
                        maxLength={256}
                        required
                        autoComplete={
                          authMode === "login"
                            ? "current-password"
                            : "new-password"
                        }
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <button
                    data-testid="account-submit"
                    type="submit"
                    className="button primary"
                    disabled={busy || !state?.platformConfigured}
                  >
                    {t(
                      authMode === "login"
                        ? "accountLogin"
                        : authMode === "register"
                          ? "accountRegister"
                          : "accountReset",
                    )}
                  </button>
                </form>
              )}
            </>
          )}
          {error || loadError ? (
            <p role="alert" className="chat-error">
              {error || loadError}
            </p>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AiConnectionSelector({
  t,
}: {
  readonly t: (key: MessageKey) => string;
}): JSX.Element {
  const { state, error: loadError, reload } = useAiSettings();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<AiModel[]>([]);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const selection = state?.selection;
  const [previousModel, setPreviousModel] = useState(selection?.model);
  if (previousModel !== selection?.model) {
    setPreviousModel(selection?.model);
    setModel(selection?.model ?? "");
  }
  async function select(mode: string, requestedModel?: string): Promise<void> {
    if (!state) return;
    setBusy(true);
    setError("");
    try {
      const platform = mode === "platform";
      const options = await settingsRequest({
        action: "models",
        ...(platform ? {} : { providerId: mode }),
      }).catch((reason: unknown) => {
        if (platform) throw reason;
        setError(
          reason instanceof Error ? reason.message : "Models unavailable.",
        );
        return { ok: true as const, models: [] as AiModel[] };
      });
      setModels(options.models ?? []);
      const nextModel =
        requestedModel ?? (platform ? options.models?.[0]?.id : model) ?? "";
      if (!nextModel) throw new Error(t("providerManualModel"));
      await settingsRequest({
        action: "select",
        selection: platform
          ? { mode: "platform", model: nextModel }
          : { mode: "custom", providerId: mode, model: nextModel },
      });
      await reload();
      announceSettings();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ai-connection-selector">
      <div>
        <select
          aria-label={t("aiConnection")}
          disabled={busy}
          value={
            selection?.mode === "platform"
              ? "platform"
              : (selection?.providerId ?? "anthropic")
          }
          onChange={(event) => void select(event.target.value)}
        >
          <option value="platform">{t("platformService")}</option>
          {state?.providers.map((provider) => (
            <option value={provider.id} key={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setOpen(true)}>
          {t("aiSettings")}
        </button>
      </div>
      {selection?.mode === "platform" ? (
        <select
          aria-label={t("aiModel")}
          value={selection.model}
          disabled={busy}
          onFocus={() => {
            void settingsRequest({ action: "models" })
              .then((result) => setModels(result.models ?? []))
              .catch(() => undefined);
          }}
          onChange={(event) => void select("platform", event.target.value)}
        >
          {!models.some((entry) => entry.id === selection.model) ? (
            <option value={selection.model}>{selection.model}</option>
          ) : null}
          {models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (selection?.mode === "custom")
              void select(selection.providerId, model);
          }}
        >
          <input
            aria-label={t("aiModel")}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
          <button type="submit" disabled={busy || model === selection?.model}>
            {t("providerUse")}
          </button>
        </form>
      )}
      {selection?.mode === "platform" &&
      models.find((entry) => entry.id === selection.model)?.price ? (
        <small>
          {t("modelPricePerMillion")}{" "}
          {money(
            models.find((entry) => entry.id === selection.model)!.price!.input,
          )}{" "}
          /{" "}
          {money(
            models.find((entry) => entry.id === selection.model)!.price!.output,
          )}
        </small>
      ) : null}
      {error || loadError ? (
        <small role="alert">{error || loadError}</small>
      ) : null}
      {open ? <AiSettingsDialog onClose={() => setOpen(false)} t={t} /> : null}
    </div>
  );
}
