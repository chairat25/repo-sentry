import { describe, expect, it } from 'vitest';
import type { RepoStatus } from '@repo-sentry/core';
import { renderNotification } from '../src/messages.js';

function behind(name: string, count: number): RepoStatus {
  return {
    path: `/x/${name}`,
    name,
    branch: 'dev',
    ahead: 0,
    behind: count,
    state: 'behind',
    checkedAt: '2026-07-28T00:00:00.000Z',
  };
}

describe('renderNotification', () => {
  it('names the branch and count for a single repo', () => {
    expect(renderNotification([behind('transaction', 3)])).toBe(
      'transaction is 3 commits behind origin/dev',
    );
  });

  it('uses the singular form for one commit', () => {
    expect(renderNotification([behind('profile', 1)])).toBe(
      'profile is 1 commit behind origin/dev',
    );
  });

  it('aggregates when several repos are behind', () => {
    const message = renderNotification([
      behind('transaction', 3),
      behind('profile', 1),
      behind('genie-fe', 2),
    ]);

    expect(message).toBe('3 repos behind origin · transaction, profile, genie-fe');
  });

  it('returns an empty string for an empty list', () => {
    expect(renderNotification([])).toBe('');
  });
});
