import { useState, type JSX } from "react";
import { AiSettingsDialog } from "../assistant/AiSettingsDialog.js";
import { ArrowRight, BookOpen, Check } from "lucide-react";

import type { MessageKey } from "../../i18n/index.js";

interface LoginPageProps {
  readonly onContinue: () => void;
  readonly t: (key: MessageKey) => string;
}

export function LoginPage({ onContinue, t }: LoginPageProps): JSX.Element {
  const [accountOpen, setAccountOpen] = useState(false);
  return (
    <main className="login-page">
      <section className="login-intro" aria-label={t("loginIntroTitle")}>
        <div className="login-monogram" aria-hidden="true">
          <BookOpen size={28} strokeWidth={1.7} />
        </div>
        <p className="login-kicker">AUTHOR COPILOT</p>
        <h2>{t("loginIntroTitle")}</h2>
        <p>{t("loginIntroDescription")}</p>
        <div className="login-points" aria-hidden="true">
          <span>
            <Check size={14} />
            {t("loginPointCreate")}
          </span>
          <span>
            <Check size={14} />
            {t("loginPointManage")}
          </span>
          <span>
            <Check size={14} />
            {t("loginPointWrite")}
          </span>
        </div>
      </section>

      <section className="login-form-section">
        <div className="login-form">
          <div className="login-heading">
            <span className="eyebrow">{t("welcomeBack")}</span>
            <h1>{t("localWorkspace")}</h1>
            <p>{t("localWorkspaceDescription")}</p>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => setAccountOpen(true)}
          >
            {t("accountLogin")} / {t("accountRegister")}
          </button>
          <button
            className="login-submit"
            type="button"
            data-testid="continue-local"
            onClick={onContinue}
          >
            <span>{t("continueLocal")}</span>
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </section>
      {accountOpen ? (
        <AiSettingsDialog
          initialSection="account"
          onClose={() => setAccountOpen(false)}
          t={t}
        />
      ) : null}
    </main>
  );
}
