import type { RepoStatus } from '@repo-sentry/core';

/**
 * One repo gets a specific message. Several get an aggregate, because five
 * stacked popups is worse than one.
 */
export function renderNotification(stale: readonly RepoStatus[]): string {
  if (stale.length === 0) return '';

  const first = stale[0];
  if (stale.length === 1 && first !== undefined) {
    const commits = first.behind === 1 ? '1 commit' : `${first.behind} commits`;
    return `${first.name} is ${commits} behind origin/${first.branch ?? 'HEAD'}`;
  }

  return `${stale.length} repos behind origin · ${stale.map((s) => s.name).join(', ')}`;
}
