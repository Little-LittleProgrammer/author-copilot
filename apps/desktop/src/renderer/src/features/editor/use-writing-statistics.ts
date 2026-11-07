import { useEffect, useMemo, useReducer } from "react";
import {
  localWritingDay,
  WritingStatisticsTracker,
} from "./writing-statistics.js";

export function useWritingStatistics(projectId: string | undefined) {
  const [, update] = useReducer((value: number) => value + 1, 0);
  const tracker = useMemo(
    () =>
      new WritingStatisticsTracker(
        projectId ?? "",
        crypto.randomUUID(),
        window.authorCopilot.writingStatistics,
      ),
    [projectId],
  );

  useEffect(() => {
    if (projectId === undefined) return;
    tracker.onChange = update;
    void tracker.refresh();
    let day = localWritingDay(new Date());
    let ticks = 0;
    const timer = window.setInterval(() => {
      const currentDay = localWritingDay(new Date());
      if (
        currentDay !== day ||
        (++ticks % 5 === 0 && tracker.snapshot().failed)
      ) {
        if (currentDay !== day) tracker.rate.reset();
        day = currentDay;
        void tracker.refresh();
      }
      update();
    }, 1000);
    const blur = () => {
      tracker.rate.reset();
      update();
    };
    const focus = () => {
      void tracker.refresh();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      tracker.onChange = () => undefined;
      window.clearInterval(timer);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, [projectId, tracker]);

  return { tracker, ...tracker.snapshot() };
}
