import { describe, expect, it } from 'vitest';
import type { RepoStatus } from '@repo-sentry/core';
import { TransitionTracker } from '../src/notifier.js';

const NOW = 1_700_000_000_000;

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

function synced(name: string): RepoStatus {
  return { ...behind(name, 0), behind: 0, state: 'synced' };
}

describe('TransitionTracker', () => {
  it('notifies the first time a repo goes behind', () => {
    const tracker = new TransitionTracker();

    expect(tracker.pickNotifiable([behind('a', 2)], NOW)).toHaveLength(1);
  });

  it('does not notify again for the same behind count', () => {
    const tracker = new TransitionTracker();
    tracker.pickNotifiable([behind('a', 2)], NOW);

    expect(tracker.pickNotifiable([behind('a', 2)], NOW + 60_000)).toHaveLength(0);
  });

  it('notifies again when the remote advances further', () => {
    const tracker = new TransitionTracker();
    tracker.pickNotifiable([behind('a', 2)], NOW);

    expect(tracker.pickNotifiable([behind('a', 5)], NOW + 60_000)).toHaveLength(1);
  });

  it('never notifies for a synced repo', () => {
    const tracker = new TransitionTracker();

    expect(tracker.pickNotifiable([synced('a')], NOW)).toHaveLength(0);
  });

  it('re-notifies after a repo is pulled and falls behind again', () => {
    const tracker = new TransitionTracker();
    tracker.pickNotifiable([behind('a', 2)], NOW);
    tracker.pickNotifiable([synced('a')], NOW + 1_000);

    expect(tracker.pickNotifiable([behind('a', 1)], NOW + 2_000)).toHaveLength(1);
  });

  it('suppresses notifications while snoozed', () => {
    const tracker = new TransitionTracker();
    tracker.snooze(['/x/a'], NOW + 30 * 60_000);

    expect(tracker.pickNotifiable([behind('a', 2)], NOW)).toHaveLength(0);
  });

  it('notifies again once the snooze expires', () => {
    const tracker = new TransitionTracker();
    tracker.snooze(['/x/a'], NOW + 30 * 60_000);
    tracker.pickNotifiable([behind('a', 2)], NOW);

    expect(tracker.pickNotifiable([behind('a', 2)], NOW + 31 * 60_000)).toHaveLength(1);
  });

  it('snoozes only the named repos', () => {
    const tracker = new TransitionTracker();
    tracker.snooze(['/x/a'], NOW + 30 * 60_000);

    const notifiable = tracker.pickNotifiable([behind('a', 1), behind('b', 1)], NOW);

    expect(notifiable.map((s) => s.name)).toEqual(['b']);
  });

  it('forgets all state on reset', () => {
    const tracker = new TransitionTracker();
    tracker.pickNotifiable([behind('a', 2)], NOW);
    tracker.reset();

    expect(tracker.pickNotifiable([behind('a', 2)], NOW)).toHaveLength(1);
  });
});
