import { useCallback, useEffect, useState } from "react";

export type Theme = "custom" | "dark" | "dawn" | "ink" | "light";

export interface CustomTheme {
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
}

interface ThemeSettings {
  readonly backgroundImage?: string;
  readonly backgroundVisibility: number;
  readonly custom: CustomTheme;
  readonly theme: Theme;
}

export interface ThemeController extends ThemeSettings {
  readonly removeBackgroundImage: () => void;
  readonly setBackgroundImage: (image: string) => void;
  readonly setBackgroundVisibility: (visibility: number) => void;
  readonly setCustomTheme: (theme: CustomTheme) => void;
  readonly setTheme: (theme: Theme) => void;
}

const storageKey = "author-copilot.theme-settings";
const customVariables = [
  "--accent",
  "--accent-gradient",
  "--accent-hover",
  "--accent-soft",
  "--alert",
  "--alert-bg",
  "--bg",
  "--canvas",
  "--editor",
  "--line",
  "--muted",
  "--sidebar",
  "--surface",
  "--text",
  "--on-accent",
] as const;

const defaultCustomTheme: CustomTheme = {
  accent: "#276b59",
  background: "#f3f4f5",
  surface: "#ffffff",
  text: "#202429",
};

const canvasColors: Readonly<Record<Theme, string>> = {
  custom: defaultCustomTheme.background,
  dark: "#222427",
  dawn: "#f7f4f2",
  ink: "#171819",
  light: "#fbfaf8",
};

function isTheme(value: unknown): value is Theme {
  return (
    value === "custom" ||
    value === "dark" ||
    value === "dawn" ||
    value === "ink" ||
    value === "light"
  );
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value);
}

function initialSettings(): ThemeSettings {
  const fallbackTheme: Theme = window.matchMedia("(prefers-color-scheme: dark)")
    .matches
    ? "dark"
    : "light";
  const legacyTheme = localStorage.getItem("author-copilot.theme");
  const fallback: ThemeSettings = {
    backgroundVisibility: 24,
    custom: defaultCustomTheme,
    theme: isTheme(legacyTheme) ? legacyTheme : fallbackTheme,
  };

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return fallback;
    const parsed = JSON.parse(stored) as Partial<ThemeSettings>;
    const custom = parsed.custom;
    return {
      ...(typeof parsed.backgroundImage === "string"
        ? { backgroundImage: parsed.backgroundImage }
        : {}),
      backgroundVisibility:
        typeof parsed.backgroundVisibility === "number"
          ? Math.min(70, Math.max(8, parsed.backgroundVisibility))
          : fallback.backgroundVisibility,
      custom: {
        accent: isHexColor(custom?.accent)
          ? custom.accent
          : defaultCustomTheme.accent,
        background: isHexColor(custom?.background)
          ? custom.background
          : defaultCustomTheme.background,
        surface: isHexColor(custom?.surface)
          ? custom.surface
          : defaultCustomTheme.surface,
        text: isHexColor(custom?.text) ? custom.text : defaultCustomTheme.text,
      },
      theme: isTheme(parsed.theme) ? parsed.theme : fallback.theme,
    };
  } catch {
    return fallback;
  }
}

function hexToRgb(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function isDarkColor(hex: string): boolean {
  const [red, green, blue] = hexToRgb(hex);
  return red * 0.299 + green * 0.587 + blue * 0.114 < 145;
}

function applyCustomTheme(custom: CustomTheme): void {
  const root = document.documentElement.style;
  const dark = isDarkColor(custom.background);
  root.setProperty("--accent", custom.accent);
  root.setProperty(
    "--accent-gradient",
    `linear-gradient(135deg, color-mix(in srgb, ${custom.accent}, white 10%) 0%, color-mix(in srgb, ${custom.accent}, black 18%) 100%)`,
  );
  root.setProperty(
    "--accent-hover",
    `color-mix(in srgb, ${custom.accent}, ${dark ? "white" : "black"} 18%)`,
  );
  root.setProperty(
    "--accent-soft",
    `color-mix(in srgb, ${custom.accent} 16%, ${custom.background})`,
  );
  root.setProperty("--alert", dark ? "#f29a8f" : "#a13d32");
  root.setProperty("--alert-bg", dark ? "#432c2c" : "#f9e8e5");
  root.setProperty("--bg", custom.background);
  root.setProperty("--canvas", custom.background);
  root.setProperty("--editor", custom.surface);
  root.setProperty(
    "--line",
    `color-mix(in srgb, ${custom.text} 18%, ${custom.background})`,
  );
  root.setProperty(
    "--muted",
    `color-mix(in srgb, ${custom.text} 64%, ${custom.background})`,
  );
  root.setProperty(
    "--sidebar",
    `color-mix(in srgb, ${custom.background} 90%, ${custom.text})`,
  );
  root.setProperty("--surface", custom.surface);
  root.setProperty("--text", custom.text);
  root.setProperty(
    "--on-accent",
    isDarkColor(custom.accent) ? "#ffffff" : "#17201d",
  );
}

function clearCustomTheme(): void {
  const root = document.documentElement.style;
  for (const variable of customVariables) root.removeProperty(variable);
}

export function useTheme(): ThemeController {
  const [settings, setSettings] = useState<ThemeSettings>(initialSettings);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    if (settings.theme === "custom") applyCustomTheme(settings.custom);
    else clearCustomTheme();

    const image = settings.backgroundImage;
    document.documentElement.dataset.hasBackground = String(
      image !== undefined,
    );
    if (image === undefined) {
      document.documentElement.style.removeProperty("--theme-background-image");
      document.documentElement.style.removeProperty(
        "--theme-background-overlay",
      );
    } else {
      const canvas =
        settings.theme === "custom"
          ? settings.custom.background
          : canvasColors[settings.theme];
      const [red, green, blue] = hexToRgb(canvas);
      const overlayAlpha = 1 - settings.backgroundVisibility / 100;
      document.documentElement.style.setProperty(
        "--theme-background-image",
        `url("${image}")`,
      );
      document.documentElement.style.setProperty(
        "--theme-background-overlay",
        `rgb(${red} ${green} ${blue} / ${overlayAlpha})`,
      );
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
      localStorage.setItem("author-copilot.theme", settings.theme);
    } catch {
      // The active theme remains usable even when browser storage is full.
    }
  }, [settings]);

  const setTheme = useCallback((theme: Theme) => {
    setSettings((current) => ({ ...current, theme }));
  }, []);
  const setCustomTheme = useCallback((custom: CustomTheme) => {
    setSettings((current) => ({ ...current, custom, theme: "custom" }));
  }, []);
  const setBackgroundImage = useCallback((backgroundImage: string) => {
    setSettings((current) => ({ ...current, backgroundImage }));
  }, []);
  const removeBackgroundImage = useCallback(() => {
    setSettings((current) => {
      const next = { ...current };
      delete next.backgroundImage;
      return next;
    });
  }, []);
  const setBackgroundVisibility = useCallback(
    (backgroundVisibility: number) => {
      setSettings((current) => ({ ...current, backgroundVisibility }));
    },
    [],
  );

  return {
    ...settings,
    removeBackgroundImage,
    setBackgroundImage,
    setBackgroundVisibility,
    setCustomTheme,
    setTheme,
  };
}
