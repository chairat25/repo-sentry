import type { RepoStatus } from '@repo-sentry/core';

/** Keep the dialog a readable size no matter how many repos are stale. */
const MAX_LISTED = 8;

function commitsOf(behind: number): string {
  return behind === 1 ? '1 commit' : `${behind} commits`;
}

/**
 * One repo gets a specific message. Several get an aggregate, because five
 * stacked popups is worse than one.
 */
export function renderNotification(stale: readonly RepoStatus[]): string {
  if (stale.length === 0) return '';

  const first = stale[0];
  if (stale.length === 1 && first !== undefined) {
    return `${first.name} is ${commitsOf(first.behind)} behind origin/${first.branch ?? 'HEAD'}`;
  }

  return `${stale.length} repos behind origin · ${stale.map((s) => s.name).join(', ')}`;
}

export interface ModalAlert {
  /** Rendered large and bold by VS Code. Must carry the instruction on its own. */
  readonly message: string;
  /** Smaller supporting text beneath it. */
  readonly detail: string;
}

/**
 * The blocking version of the alert.
 *
 * A corner toast fades after a few seconds and gets ignored, which is exactly
 * how the stale-checkout problem keeps happening. This takes the screen and
 * states the action first — the reasoning goes in the detail, where someone who
 * already knows the drill can skip it.
 */
export function renderModalAlert(stale: readonly RepoStatus[]): ModalAlert {
  if (stale.length === 0) return { message: '', detail: '' };

  const first = stale[0];
  const subject =
    stale.length === 1 && first !== undefined
      ? `${first.name} is ${commitsOf(first.behind)} behind`
      : `${stale.length} repos are behind origin`;

  const listed = stale
    .slice(0, MAX_LISTED)
    .map((s) => `  ${s.name} (${s.branch ?? 'detached'})  ↓${s.behind}`);
  const overflow = stale.length - MAX_LISTED;
  if (overflow > 0) listed.push(`  …and ${overflow} more`);

  return {
    message: `⛔  PULL FIRST — ${subject}`,
    detail: [
      ...listed,
      '',
      'If you keep working without pulling:',
      '  •  your next push will be rejected',
      '  •  starting a service may drop columns a teammate just added,',
      '     and that data cannot be recovered',
    ].join('\n'),
  };
}

/**
 * `git pull --ff-only` already refuses on its own when an incoming change
 * would overwrite an uncommitted one — that safety net doesn't change here.
 * This is for the quieter case: an uncommitted change that pull *can* carry
 * forward without conflict, silently. Asking first, rather than letting it
 * happen unannounced, is the whole point of this dialog.
 */
export function renderDirtyWarning(names: readonly string[]): ModalAlert {
  if (names.length === 0) return { message: '', detail: '' };

  const subject = names.length === 1 ? `${names[0]} has` : `${names.length} repos have`;
  const listed = names.length > 1 ? names.map((n) => `  ${n}`) : [];

  return {
    message: `⚠  ${subject} uncommitted changes`,
    detail: [
      ...listed,
      ...(listed.length > 0 ? [''] : []),
      'Pulling now could carry those changes forward mixed in with new commits.',
      '',
      '  Stash & Pull  —  set your changes aside, then pull. Recover them',
      '                   afterward with "git stash pop".',
      '  Pull Anyway   —  pull now. git still refuses if anything actually',
      '                   conflicts — nothing is ever overwritten silently.',
    ].join('\n'),
  };
}
