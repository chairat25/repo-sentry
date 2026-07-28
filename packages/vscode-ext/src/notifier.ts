import { isStale, type RepoStatus } from '@repo-sentry/core';

/**
 * Decides which repositories deserve a notification right now.
 *
 * Notifying on every poll would train the team to ignore the popup, so a repo
 * is announced only when it newly falls behind, or falls further behind than
 * the count already announced.
 */
export class TransitionTracker {
  /** repo path -> the behind count most recently announced. */
  readonly #announced = new Map<string, number>();
  /** repo path -> epoch ms until which notifications are suppressed. */
  readonly #snoozedUntil = new Map<string, number>();

  pickNotifiable(statuses: readonly RepoStatus[], now: number): RepoStatus[] {
    return statuses.filter((status) => this.#shouldNotify(status, now));
  }

  snooze(paths: readonly string[], until: number): void {
    for (const path of paths) this.#snoozedUntil.set(path, until);
  }

  reset(): void {
    this.#announced.clear();
    this.#snoozedUntil.clear();
  }

  #shouldNotify(status: RepoStatus, now: number): boolean {
    if (!isStale(status)) {
      // Caught up — the next time it falls behind counts as new.
      this.#announced.delete(status.path);
      return false;
    }

    const until = this.#snoozedUntil.get(status.path);
    if (until !== undefined && now < until) return false;

    const announced = this.#announced.get(status.path);
    if (announced !== undefined && status.behind <= announced) return false;

    this.#announced.set(status.path, status.behind);
    return true;
  }
}
