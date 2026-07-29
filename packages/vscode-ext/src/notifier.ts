import { isStale, type RepoStatus } from '@repo-sentry/core';

/**
 * Decides which repositories deserve a notification right now.
 *
 * Notifying on every poll would train the team to ignore the popup, so a repo
 * is announced only when it newly falls behind, or falls further behind than
 * the count already announced.
 */
export interface TrackerOptions {
  /**
   * Re-announce a repo that is still stale this long after the last alert.
   * Zero disables it: an alert dismissed without pulling is never repeated.
   */
  readonly remindAfterMs?: number;
}

interface Announcement {
  readonly behind: number;
  readonly at: number;
}

export class TransitionTracker {
  /** repo path -> what was last announced for it, and when. */
  readonly #announced = new Map<string, Announcement>();
  /** repo path -> epoch ms until which notifications are suppressed. */
  readonly #snoozedUntil = new Map<string, number>();
  readonly #remindAfterMs: number;

  constructor(opts: TrackerOptions = {}) {
    this.#remindAfterMs = opts.remindAfterMs ?? 0;
  }

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

    const last = this.#announced.get(status.path);
    if (last !== undefined && status.behind <= last.behind && !this.#dueForReminder(last, now)) {
      return false;
    }

    this.#announced.set(status.path, { behind: status.behind, at: now });
    return true;
  }

  /**
   * Dismissing the alert does not make the repo any less stale, so an unheeded
   * warning is repeated rather than dropped. The clock restarts on each alert,
   * which keeps this to one reminder per interval instead of one per poll.
   */
  #dueForReminder(last: Announcement, now: number): boolean {
    if (this.#remindAfterMs <= 0) return false;
    return now - last.at >= this.#remindAfterMs;
  }
}
