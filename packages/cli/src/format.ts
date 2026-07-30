import type { RepoStatus } from '@repo-sentry/core';

export function pluralCommits(n: number): string {
  return n === 1 ? '1 commit' : `${n} commits`;
}

/** The message a git hook prints when it refuses to let the operation proceed. */
export function formatBlockMessage(status: RepoStatus, stage: 'commit' | 'push'): string {
  const upstream = `${status.remote ?? 'origin'}/${status.branch ?? 'HEAD'}`;
  const header = `✗ repo-sentry: ${status.name} — ${status.branch ?? 'HEAD'} is ${pluralCommits(status.behind)} behind ${upstream}`;

  const body =
    stage === 'push'
      ? ['', '  Your push will be rejected. Pull first:', '    git pull --rebase']
      : ['', '  Pull before committing:', '    git pull --rebase'];

  const escape = ['', '  Skip this check:', `    git ${stage} --no-verify`, ''];

  return [header, ...body, ...escape].join('\n');
}

const GLYPH: Record<RepoStatus['state'], string> = {
  behind: '⚠',
  diverged: '⚠',
  synced: '✓',
  ahead: '↑',
  unreachable: '?',
  'no-upstream': '–',
  detached: '–',
};

/** One line per repository, aligned. Used by `repo-sentry status`. */
export function formatStatusTable(statuses: readonly RepoStatus[]): string {
  if (statuses.length === 0) return 'repo-sentry: no repositories found';

  const nameWidth = Math.max(...statuses.map((s) => s.name.length));
  const branchWidth = Math.max(...statuses.map((s) => (s.branch ?? '—').length));

  return statuses
    .map((s) => {
      const name = s.name.padEnd(nameWidth);
      const branch = (s.branch ?? '—').padEnd(branchWidth);
      return `${GLYPH[s.state]}  ${name}  ${branch}  ${detailOf(s)}`;
    })
    .join('\n');
}

function detailOf(s: RepoStatus): string {
  switch (s.state) {
    case 'behind':
      return `↓${s.behind}`;
    case 'diverged':
      return `↓${s.behind} ↑${s.ahead}  (diverged)`;
    case 'ahead':
      return `↑${s.ahead}`;
    case 'unreachable':
      return `unreachable — ${firstLine(s.error ?? 'unknown error')}`;
    case 'no-upstream':
      return 'no upstream';
    case 'detached':
      return 'detached HEAD';
    case 'synced':
      return '';
  }
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? text;
}
