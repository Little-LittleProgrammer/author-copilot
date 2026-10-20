import type { JSX } from "react";
import type { Locale, MessageKey } from "../../i18n/index.js";
import { AiSettingsDialog } from "./AiSettingsDialog.js";
export function CredentialDialog({
  onClose,
  t,
}: {
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly t: (key: MessageKey) => string;
}): JSX.Element {
  return <AiSettingsDialog onClose={onClose} t={t} />;
}
