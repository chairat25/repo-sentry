import { describe, expect, it } from 'vitest';
import type { BlockedRepo } from '@repo-sentry/core';
import { BootBlockTracker, renderBootBlockMessage } from '../src/boot-block.js';

const NOW = 1_700_000_000_000;

function blocked(name: string, behind = 3, at: string = new Date(NOW).toISOString()): BlockedRepo {
  return { path: `/x/${name}`, name, branch: 'dev', remote: 'origin', ahead: 0, behind, blockedAt: at };
}

describe('renderBootBlockMessage', () => {
  it('names the service, the branch, and the count', () => {
    const message = renderBootBlockMessage(blocked('service-e', 3));

    expect(message).toContain('service-e');
    expect(message).toContain('3 commits behind');
    expect(message).toContain('origin/dev');
  });

  it('uses the singular form for one commit', () => {
    expect(renderBootBlockMessage(blocked('service-b', 1))).toContain('1 commit behind');
  });

  it('explains why booting stale is dangerous, not just that it was blocked', () => {
    const message = renderBootBlockMessage(blocked('service-a', 2));

    expect(message.toLowerCase()).toContain('column');
  });

  it('uses the actual tracked remote name, not always "origin"', () => {
    const entry: BlockedRepo = {
      path: '/x/service-a',
      name: 'service-a',
      branch: 'dev',
      remote: 'upstream',
      ahead: 0,
      behind: 2,
      blockedAt: new Date(NOW).toISOString(),
    };

    expect(renderBootBlockMessage(entry)).toContain('upstream/dev');
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
