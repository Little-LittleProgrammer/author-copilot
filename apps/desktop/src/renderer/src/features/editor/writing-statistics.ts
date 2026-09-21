import type {
  WritingStatisticsResponse,
  WritingStatisticsSnapshot,
} from "@author-copilot/contracts";
import type { AuthorCopilotApi } from "../../../../shared/desktop-api.js";

export function localWritingDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Count Unicode code points, including punctuation, excluding whitespace. */
export function countWritingCharacters(content: string): number {
  let count = 0;
  for (const character of content) if (!/\s/u.test(character)) count++;
  return count;
}

export class WritingRate {
  private samples: { at: number; characters: number }[] = [];
  private startedAt = 0;

  reset(): void {
    this.samples = [];
  }

  record(characters: number, now: number): void {
    this.value(now);
    if (characters <= 0) return;
    if (this.samples.length === 0) this.startedAt = now;
    this.samples.push({ at: now, characters });
  }

  value(now: number): number {
    const last = this.samples.at(-1);
    if (last === undefined) return 0;
    if (now < last.at || now - last.at >= 30_000) {
      this.reset();
      return 0;
    }
    this.samples = this.samples.filter((sample) => now - sample.at < 60_000);
    const characters = this.samples.reduce(
      (total, sample) => total + sample.characters,
      0,
    );
    // A ten-second warm-up floor avoids a huge rate for the very first keystroke.
    const duration = Math.max(10_000, Math.min(60_000, now - this.startedAt));
    return Math.round((characters * 60_000) / duration);
  }
}

interface SessionDay {
  sequence: number;
  netCharacters: number;
  persisted?: WritingStatisticsSnapshot;
  failed: boolean;
  acknowledgedAttempt: number;
}

/** Only explicit editor operations enter here; prop reloads never create activity. */
export class WritingStatisticsTracker {
  readonly rate = new WritingRate();
  private readonly days = new Map<string, SessionDay>();
  private syncAttempt = 0;
  onChange: () => void = () => undefined;

  constructor(
    private readonly projectId: string,
    private readonly sessionId: string,
    private readonly api: AuthorCopilotApi["writingStatistics"] | undefined,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  snapshot(): {
    today: number | undefined;
    rate: number;
    failed: boolean;
    pending: boolean;
  } {
    const state = this.state(localWritingDay(this.clock()));
    const saved = state.persisted;
    const today =
      saved &&
      saved.netCharacters + state.netCharacters - saved.sessionCharacters;
    return {
      today,
      rate: this.rate.value(this.clock().getTime()),
      failed: [...this.days.values()].some((day) => day.failed),
      pending: [...this.days.values()].some(
        (day) => day.sequence > (day.persisted?.sequence ?? 0),
      ),
    };
  }

  record(before: string, after: string, typing: boolean): void {
    const now = this.clock();
    const day = localWritingDay(now);
    const delta =
      countWritingCharacters(after) - countWritingCharacters(before);
    if (typing) this.rate.record(Math.max(0, delta), now.getTime());
    if (delta !== 0) {
      const state = this.state(day);
      state.netCharacters += delta;
      state.sequence++;
      // Dispatch immediately: closing a tab must not discard a debounced write.
      void this.sync(day);
    }
    this.onChange();
  }

  async refresh(): Promise<void> {
    const today = localWritingDay(this.clock());
    const pendingDays = [...this.days]
      .filter(([, state]) => state.sequence > (state.persisted?.sequence ?? 0))
      .map(([day]) => day);
    await Promise.all(
      [...new Set([today, ...pendingDays])].map((day) => this.sync(day)),
    );
  }

  private state(day: string): SessionDay {
    let state = this.days.get(day);
    if (state === undefined) {
      state = {
        sequence: 0,
        netCharacters: 0,
        failed: false,
        acknowledgedAttempt: 0,
      };
      this.days.set(day, state);
    }
    return state;
  }

  private async sync(day: string): Promise<void> {
    const state = this.state(day);
    const sequence = state.sequence;
    const attempt = ++this.syncAttempt;
    const request = {
      projectId: this.projectId,
      sessionId: this.sessionId,
      day,
    };
    try {
      if (this.api === undefined) throw new Error("Statistics unavailable");
      const result: WritingStatisticsResponse =
        sequence > (state.persisted?.sequence ?? 0)
          ? await this.api.record({
              ...request,
              sequence,
              netCharacters: state.netCharacters,
            })
          : await this.api.get(request);
      if (!result.ok) throw new Error("Statistics unavailable");
      if (result.snapshot.sequence >= (state.persisted?.sequence ?? 0)) {
        state.persisted = result.snapshot;
        state.failed = false;
        state.acknowledgedAttempt = Math.max(
          attempt,
          state.acknowledgedAttempt,
        );
      }
    } catch {
      // An older failure must not override a newer successful acknowledgement.
      if (attempt > state.acknowledgedAttempt) state.failed = true;
    }
    this.onChange();
  }
}
