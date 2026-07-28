import { analyzeAll } from './analyzer.js';
import type { AnalyzeOptions, RepoStatus } from './types.js';

export const DEFAULT_INTERVAL_MS = 60_000;

export interface SchedulerOptions extends AnalyzeOptions {
  /** Poll cadence. Defaults to 60000. */
  readonly intervalMs?: number;
  readonly onResults: (statuses: readonly RepoStatus[]) => void;
  readonly onError?: (err: unknown) => void;
}

/**
 * Drives periodic analysis across a set of repositories.
 *
 * A single timer covers all repos. Overlapping ticks are dropped rather than
 * queued, so a slow network round cannot pile up work.
 */
export class Scheduler {
  readonly #opts: SchedulerOptions;
  #timer: ReturnType<typeof setInterval> | null = null;
  #repos: readonly string[] = [];
  #inFlight: Promise<void> | null = null;
  #paused = false;

  constructor(opts: SchedulerOptions) {
    this.#opts = opts;
  }

  setRepos(repos: readonly string[]): void {
    this.#repos = [...repos];
  }

  start(): void {
    if (this.#timer !== null) return;
    const intervalMs = this.#opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
    void this.tick();
  }

  /** Resolves once any in-flight tick has finished. Used by tests. */
  async settled(): Promise<void> {
    await this.#inFlight;
  }

  async tick(): Promise<void> {
    if (this.#inFlight !== null || this.#paused || this.#repos.length === 0) return;

    const run = (async (): Promise<void> => {
      try {
        const statuses = await analyzeAll(this.#repos, this.#opts);
        this.#opts.onResults(statuses);
      } catch (err) {
        this.#opts.onError?.(err);
      }
    })();

    this.#inFlight = run.finally(() => {
      this.#inFlight = null;
    });
    await this.#inFlight;
  }
}
