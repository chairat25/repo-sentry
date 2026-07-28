import { isStale, type RepoStatus } from '@repo-sentry/core';

export interface BarView {
  /** Status bar label, including VS Code codicon syntax. */
  readonly text: string;
  /** True when the bar should use the warning background colour. */
  readonly warning: boolean;
  readonly tooltip: string;
}

/** Pass null before the first analysis has completed. */
export function renderBar(statuses: readonly RepoStatus[] | null): BarView {
  if (statuses === null) {
    return {
      text: '$(sync~spin) checking repos',
      warning: false,
      tooltip: 'repo-sentry: checking…',
    };
  }

  const stale = statuses.filter(isStale);
  if (stale.length > 0) {
    return {
      text: `$(warning) ${stale.length} ${stale.length === 1 ? 'repo' : 'repos'} behind`,
      warning: true,
      tooltip: stale.map((s) => `${s.name} (${s.branch ?? '—'}) ↓${s.behind}`).join('\n'),
    };
  }

  const unreachable = statuses.filter((s) => s.state === 'unreachable');
  if (unreachable.length > 0) {
    return {
      text: `$(question) repos: ${unreachable.length} unreachable`,
      warning: false,
      tooltip: unreachable.map((s) => `${s.name}: ${s.error ?? 'unknown error'}`).join('\n'),
    };
  }

  return {
    text: '$(check) repos synced',
    warning: false,
    tooltip: `repo-sentry: ${statuses.length} repositories synced`,
  };
}
