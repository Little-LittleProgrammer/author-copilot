import { useCallback, useEffect, useState } from "react";
import type {
  AiSettingsRequest,
  AiSettingsState,
} from "@author-copilot/contracts";
export async function settingsRequest(
  request: AiSettingsRequest,
): Promise<
  Extract<
    Awaited<ReturnType<typeof window.authorCopilot.aiSettings>>,
    { ok: true }
  >
> {
  const response = await window.authorCopilot.aiSettings(request);
  if (!response.ok) throw new Error(response.error.message);
  return response;
}
export function announceSettings(): void {
  window.dispatchEvent(new Event("ai-settings-changed"));
}
export function useAiSettings(): {
  state: AiSettingsState | undefined;
  error: string;
  reload: () => Promise<void>;
} {
  const [state, setState] = useState<AiSettingsState>();
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setState((await settingsRequest({ action: "state" })).state);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "AI settings unavailable.",
      );
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      void reload();
    }, 0);
    const refresh = (): void => {
      void reload();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("ai-settings-changed", refresh);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("ai-settings-changed", refresh);
    };
  }, [reload]);
  return { state, error, reload };
}
