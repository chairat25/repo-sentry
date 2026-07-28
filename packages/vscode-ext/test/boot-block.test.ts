import { describe, expect, it } from 'vitest';
import type { BlockedRepo } from '@repo-sentry/core';
import { BootBlockTracker, renderBootBlockMessage } from '../src/boot-block.js';

const NOW = 1_700_000_000_000;

function blocked(name: string, behind = 3, at: string = new Date(NOW).toISOString()): BlockedRepo {
  return { path: `/x/${name}`, name, branch: 'dev', ahead: 0, behind, blockedAt: at };
}

describe('renderBootBlockMessage', () => {
  it('names the service, the branch, and the count', () => {
    const message = renderBootBlockMessage(blocked('authentication', 3));

    expect(message).toContain('authentication');
    expect(message).toContain('3 commits behind');
    expect(message).toContain('origin/dev');
  });

  it('uses the singular form for one commit', () => {
    expect(renderBootBlockMessage(blocked('profile', 1))).toContain('1 commit behind');
  });

  it('explains why booting stale is dangerous, not just that it was blocked', () => {
    const message = renderBootBlockMessage(blocked('transaction', 2));

    expect(message.toLowerCase()).toContain('column');
  });
});

describe('BootBlockTracker', () => {
  it('surfaces a newly blocked repo', () => {
    const tracker = new BootBlockTracker();

    expect(tracker.pickUnseen([blocked('a')]).map((r) => r.name)).toEqual(['a']);
  });

  it('does not surface the same block twice', () => {
    const tracker = new BootBlockTracker();
    const entry = blocked('a');
    tracker.pickUnseen([entry]);

    expect(tracker.pickUnseen([entry])).toEqual([]);
  });

  it('surfaces a repeat boot attempt, because the developer tried again', () => {
    const tracker = new BootBlockTracker();
    tracker.pickUnseen([blocked('a', 3, new Date(NOW).toISOString())]);

    const retry = blocked('a', 3, new Date(NOW + 5_000).toISOString());

    expect(tracker.pickUnseen([retry])).toHaveLength(1);
  });

  it('forgets a repo once it disappears from the blocked list', () => {
    const tracker = new BootBlockTracker();
    const entry = blocked('a');
    tracker.pickUnseen([entry]);
    tracker.pickUnseen([]);

    expect(tracker.pickUnseen([entry])).toHaveLength(1);
  });

  it('surfaces several repos independently', () => {
    const tracker = new BootBlockTracker();
    tracker.pickUnseen([blocked('a')]);

    expect(tracker.pickUnseen([blocked('a'), blocked('b')]).map((r) => r.name)).toEqual(['b']);
  });

  it('returns nothing for an empty list', () => {
    expect(new BootBlockTracker().pickUnseen([])).toEqual([]);
  });
});
