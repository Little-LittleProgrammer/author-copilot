import { useState, type FormEvent, type JSX } from "react";
import { ArrowRight, BookOpen, Check, LockKeyhole, Mail } from "lucide-react";

import type { MessageKey } from "../../i18n/index.js";

interface LoginPageProps {
  readonly onLogin: (account: string, remember: boolean) => void;
  readonly t: (key: MessageKey) => string;
}

export function LoginPage({ onLogin, t }: LoginPageProps): JSX.Element {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onLogin(account.trim(), remember);
  };

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
        <form className="login-form" onSubmit={submit}>
          <div className="login-heading">
            <span className="eyebrow">{t("welcomeBack")}</span>
            <h1>{t("loginTitle")}</h1>
            <p>{t("loginSubtitle")}</p>
          </div>

          <label className="login-field">
            <span>{t("account")}</span>
            <span className="login-input-wrap">
              <Mail size={16} aria-hidden="true" />
              <input
                autoFocus
                autoComplete="username"
                required
                type="email"
                value={account}
                placeholder={t("accountPlaceholder")}
                onChange={(event) => setAccount(event.target.value)}
              />
            </span>
          </label>

          <label className="login-field">
            <span>{t("password")}</span>
            <span className="login-input-wrap">
              <LockKeyhole size={16} aria-hidden="true" />
              <input
                autoComplete="current-password"
                minLength={6}
                required
                type="password"
                value={password}
                placeholder={t("passwordPlaceholder")}
                onChange={(event) => setPassword(event.target.value)}
              />
            </span>
          </label>

          <label className="remember-option">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>{t("rememberMe")}</span>
          </label>

          <button
            className="login-submit"
            type="submit"
            data-testid="login-submit"
          >
            <span>{t("login")}</span>
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </form>
      </section>
    </main>
  );
}
