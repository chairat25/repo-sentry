import type { BlockedRepo } from '@repo-sentry/core';

/**
 * Tracks which boot blocks have already been shown, keyed on the repo and the
 * timestamp of the attempt.
 *
 * Keying on the timestamp rather than the repo alone is deliberate: if the
 * developer runs the start command a second time without pulling, that is a
 * new attempt and deserves the modal again. Keying on the repo alone would
 * show it once and then stay silent while they kept trying.
 */
export class BootBlockTracker {
  /** repo path -> blockedAt of the attempt already surfaced. */
  readonly #shown = new Map<string, string>();

  pickUnseen(blocked: readonly BlockedRepo[]): BlockedRepo[] {
    const live = new Set(blocked.map((b) => b.path));
    for (const path of [...this.#shown.keys()]) {
      // Cleared from the marker — the next block on this repo is new again.
      if (!live.has(path)) this.#shown.delete(path);
    }

    return blocked.filter((entry) => {
      if (this.#shown.get(entry.path) === entry.blockedAt) return false;
      this.#shown.set(entry.path, entry.blockedAt);
      return true;
    });
  }

  reset(): void {
    this.#shown.clear();
  }
}

export function renderBootBlockMessage(entry: BlockedRepo): string {
  const commits = entry.behind === 1 ? '1 commit' : `${entry.behind} commits`;
  const upstream = `${entry.remote ?? 'origin'}/${entry.branch ?? 'HEAD'}`;
  return (
    `${entry.name} could not start — it is ${commits} behind ${upstream}.\n\n` +
    'Starting on a stale checkout lets TypeORM synchronize drop columns your ' +
    'teammates just added. That data cannot be recovered.'
  );
}
