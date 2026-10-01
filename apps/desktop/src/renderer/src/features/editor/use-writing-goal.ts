import { useCallback, useEffect, useState } from "react";
import type { WritingGoalResponse } from "@author-copilot/contracts";

interface WritingGoalState {
  readonly dailyTarget: number | undefined;
  readonly failed: boolean;
  readonly pending: boolean;
}

export function useWritingGoal(
  projectId: string | undefined,
): WritingGoalState & {
  readonly refresh: () => Promise<void>;
  readonly save: (dailyTarget: number) => Promise<void>;
} {
  const [state, setState] = useState<WritingGoalState>({
    dailyTarget: undefined,
    failed: false,
    pending: false,
  });

  const refresh = useCallback(async () => {
    if (projectId === undefined) return;
    setState((current) => ({ ...current, pending: true, failed: false }));
    try {
      const response = await window.authorCopilot.writingGoal.get({
        projectId,
      });
      if (!response.ok) throw new Error(response.error);
      setState({
        dailyTarget: response.goal.dailyTarget,
        failed: false,
        pending: false,
      });
    } catch {
      setState((current) => ({ ...current, failed: true, pending: false }));
    }
  }, [projectId]);

  const save = useCallback(
    async (dailyTarget: number) => {
      if (projectId === undefined) throw new Error("Project is unavailable.");
      setState((current) => ({ ...current, pending: true, failed: false }));
      try {
        const response: WritingGoalResponse =
          await window.authorCopilot.writingGoal.set({
            projectId,
            dailyTarget,
          });
        if (!response.ok) throw new Error(response.error);
        setState({
          dailyTarget: response.goal.dailyTarget,
          failed: false,
          pending: false,
        });
      } catch (error) {
        setState((current) => ({ ...current, failed: true, pending: false }));
        throw error;
      }
    },
    [projectId],
  );

  useEffect(() => {
    setState({ dailyTarget: undefined, failed: false, pending: false });
    void refresh();
  }, [refresh]);

  return { ...state, refresh, save };
}
