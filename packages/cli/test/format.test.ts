import { describe, expect, it } from 'vitest';
import type { RepoStatus } from '@repo-sentry/core';
import { formatStatusTable, pluralCommits } from '../src/format.js';

function status(over: Partial<RepoStatus> & Pick<RepoStatus, 'name' | 'state'>): RepoStatus {
  return {
    path: `/x/${over.name}`,
    branch: 'dev',
    ahead: 0,
    behind: 0,
    checkedAt: '2026-07-28T00:00:00.000Z',
    ...over,
  };
}

describe('pluralCommits', () => {
  it('uses the singular form for one', () => {
    expect(pluralCommits(1)).toBe('1 commit');
  });

  it('uses the plural form for anything else', () => {
    expect(pluralCommits(0)).toBe('0 commits');
    expect(pluralCommits(3)).toBe('3 commits');
  });
});

describe('formatStatusTable', () => {
  it('says so when nothing was found', () => {
    expect(formatStatusTable([])).toBe('repo-sentry: no repositories found');
  });

  it('marks a behind repo with a warning glyph and the count', () => {
    const table = formatStatusTable([status({ name: 'service-a', state: 'behind', behind: 3 })]);

    expect(table).toContain('⚠');
    expect(table).toContain('service-a');
    expect(table).toContain('↓3');
  });

  it('shows both counts for a diverged repo', () => {
    const table = formatStatusTable([
      status({ name: 'service-d', state: 'diverged', behind: 4, ahead: 5 }),
    ]);

    expect(table).toContain('↓4 ↑5');
    expect(table).toContain('(diverged)');
  });

  it('marks a synced repo with a check and no detail', () => {
    const table = formatStatusTable([status({ name: 'service-b', state: 'synced' })]);

    expect(table).toContain('✓');
    expect(table).not.toContain('↓');
  });

  it('shows the ahead count for an ahead-only repo', () => {
    const table = formatStatusTable([status({ name: 'service-e', state: 'ahead', ahead: 2 })]);

    expect(table).toContain('↑2');
  });

  it('shows only the first line of a multi-line unreachable error', () => {
    const table = formatStatusTable([
      status({ name: 'service-f', state: 'unreachable', error: 'auth failed\nfatal: exiting' }),
    ]);

    expect(table).toContain('unreachable — auth failed');
    expect(table).not.toContain('fatal: exiting');
  });

  it('labels a branch with no upstream', () => {
    const table = formatStatusTable([status({ name: 'feature', state: 'no-upstream' })]);

    expect(table).toContain('no upstream');
  });

  it('renders an em dash for a detached HEAD', () => {
    const table = formatStatusTable([
      status({ name: 'weird', state: 'detached', branch: null }),
    ]);

    expect(table).toContain('detached HEAD');
    expect(table).toContain('—');
  });

  it('aligns names and branches into columns', () => {
    const table = formatStatusTable([
      status({ name: 'a', state: 'synced' }),
      status({ name: 'much-longer-name', state: 'synced' }),
    ]);
    const [first, second] = table.split('\n');

    // Both rows pad to the widest name, so the branch column starts at the
    // same offset on every line.
    expect(first?.indexOf('dev')).toBe(second?.indexOf('dev'));
  });
});
