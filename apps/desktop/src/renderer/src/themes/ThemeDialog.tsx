import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react";
import { ImagePlus, RotateCcw, Trash2, X } from "lucide-react";

import type { MessageKey } from "../i18n/index.js";
import type { CustomTheme, Theme, ThemeController } from "./index.js";

interface ThemeDialogProps {
  readonly controller: ThemeController;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly t: (key: MessageKey) => string;
}

const themes: readonly {
  readonly colors: readonly [string, string, string];
  readonly id: Theme;
  readonly label: MessageKey;
}[] = [
  {
    colors: ["#fbfaf8", "#276b59", "#202429"],
    id: "light",
    label: "themeLight",
  },
  { colors: ["#222427", "#64b69d", "#eef0f1"], id: "dark", label: "themeDark" },
  { colors: ["#f7f4f2", "#a34d4b", "#29272a"], id: "dawn", label: "themeDawn" },
  { colors: ["#171819", "#d2a857", "#f2eee4"], id: "ink", label: "themeInk" },
  {
    colors: ["#f3f4f5", "#276b59", "#ffffff"],
    id: "custom",
    label: "themeCustom",
  },
];

const customFields: readonly { key: keyof CustomTheme; label: MessageKey }[] = [
  { key: "accent", label: "themeAccent" },
  { key: "background", label: "themeBackground" },
  { key: "surface", label: "themeSurface" },
  { key: "text", label: "themeText" },
];

async function prepareBackground(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("invalid");
  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 1800;
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("invalid");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.8);
    if (image.length > 3_500_000) throw new Error("large");
    return image;
  } finally {
    bitmap.close();
  }
}

export function ThemeDialog({
  controller,
  onClose,
  open,
  t,
}: ThemeDialogProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [imageError, setImageError] = useState<MessageKey>();
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
  }, [open]);

  if (!open) return null;

  const updateCustom = (key: keyof CustomTheme, value: string): void => {
    controller.setCustomTheme({ ...controller.custom, [key]: value });
  };

  const selectBackground = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    setProcessing(true);
    setImageError(undefined);
    try {
      controller.setBackgroundImage(await prepareBackground(file));
    } catch (reason) {
      setImageError(
        reason instanceof Error && reason.message === "large"
          ? "backgroundTooLarge"
          : "backgroundInvalid",
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="theme-dialog"
      onCancel={onClose}
      onClose={onClose}
    >
      <header className="theme-dialog-header">
        <div>
          <span className="eyebrow">{t("appearance")}</span>
          <h2>{t("themeSettings")}</h2>
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

      <div className="theme-dialog-body">
        <section className="theme-section">
          <div className="theme-section-heading">
            <h3>{t("presetThemes")}</h3>
            <span>{t("themeAutoSave")}</span>
          </div>
          <div className="theme-presets">
            {themes.map(({ colors, id, label }) => (
              <button
                key={id}
                className={controller.theme === id ? "active" : ""}
                type="button"
                aria-pressed={controller.theme === id}
                onClick={() => controller.setTheme(id)}
              >
                <span className="theme-swatch" aria-hidden="true">
                  {colors.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                <strong>{t(label)}</strong>
              </button>
            ))}
          </div>
        </section>

        {controller.theme === "custom" ? (
          <section className="theme-section custom-colors">
            <div className="theme-section-heading">
              <h3>{t("customColors")}</h3>
              <button
                type="button"
                onClick={() =>
                  controller.setCustomTheme({
                    accent: "#276b59",
                    background: "#f3f4f5",
                    surface: "#ffffff",
                    text: "#202429",
                  })
                }
              >
                <RotateCcw size={13} />
                {t("resetColors")}
              </button>
            </div>
            <div className="color-fields">
              {customFields.map(({ key, label }) => (
                <label key={key}>
                  <span>{t(label)}</span>
                  <span className="color-input">
                    <input
                      type="color"
                      value={controller.custom[key]}
                      onChange={(event) =>
                        updateCustom(key, event.target.value)
                      }
                    />
                    <code>{controller.custom[key].toLocaleUpperCase()}</code>
                  </span>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        <section className="theme-section background-settings">
          <div className="theme-section-heading">
            <div>
              <h3>{t("backgroundImage")}</h3>
              <p>{t("backgroundImageHint")}</p>
            </div>
          </div>
          {controller.backgroundImage === undefined ? (
            <label className="background-upload">
              <ImagePlus size={21} />
              <strong>
                {processing ? t("processingImage") : t("chooseBackground")}
              </strong>
              <small>{t("backgroundFormats")}</small>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={processing}
                onChange={(event) => void selectBackground(event)}
              />
            </label>
          ) : (
            <div className="background-preview">
              <img src={controller.backgroundImage} alt="" />
              <div className="background-controls">
                <label>
                  <span>{t("backgroundVisibility")}</span>
                  <strong>{controller.backgroundVisibility}%</strong>
                  <input
                    type="range"
                    min="8"
                    max="70"
                    step="1"
                    value={controller.backgroundVisibility}
                    onChange={(event) =>
                      controller.setBackgroundVisibility(
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button secondary"
                  onClick={controller.removeBackgroundImage}
                >
                  <Trash2 size={14} />
                  {t("removeBackground")}
                </button>
              </div>
            </div>
          )}
          {imageError !== undefined ? (
            <p className="inline-theme-error" role="alert">
              {t(imageError)}
            </p>
          ) : null}
        </section>
      </div>
    </dialog>
  );
}
