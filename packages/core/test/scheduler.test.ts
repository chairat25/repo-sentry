import { afterEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/scheduler.js';
import type { RepoStatus } from '../src/types.js';
import { commitAndPush, makeClone, makeFixture, type Fixture } from './helpers/repo-fixture.js';

let fx: Fixture | null = null;
let scheduler: Scheduler | null = null;

afterEach(async () => {
  scheduler?.stop();
  scheduler = null;
  await fx?.cleanup();
  fx = null;
});

describe('Scheduler', () => {
  it('delivers results for every watched repo on tick', async () => {
    fx = await makeFixture();
    const a = await makeClone(fx, 'a');
    const b = await makeClone(fx, 'b');
    const batches: RepoStatus[][] = [];

    scheduler = new Scheduler({ onResults: (s) => batches.push([...s]) });
    scheduler.setRepos([a, b]);
    await scheduler.tick();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('does nothing when no repos are set', async () => {
    let calls = 0;
    scheduler = new Scheduler({ onResults: () => { calls += 1; } });

    await scheduler.tick();

    expect(calls).toBe(0);
  });

  it('does not deliver results while paused', async () => {
    fx = await makeFixture();
    const a = await makeClone(fx, 'a');
    let calls = 0;

    scheduler = new Scheduler({ onResults: () => { calls += 1; } });
    scheduler.setRepos([a]);
    scheduler.pause();
    await scheduler.tick();

    expect(calls).toBe(0);
  });

  it('runs an immediate tick on resume', async () => {
    fx = await makeFixture();
    const a = await makeClone(fx, 'a');
    let calls = 0;

    scheduler = new Scheduler({ onResults: () => { calls += 1; } });
    scheduler.setRepos([a]);
    scheduler.pause();
    scheduler.resume();
    await scheduler.settled();

    expect(calls).toBe(1);
  });

  it('skips overlapping ticks instead of stacking them', async () => {
    fx = await makeFixture();
    const a = await makeClone(fx, 'a');
    let calls = 0;

    scheduler = new Scheduler({ onResults: () => { calls += 1; } });
    scheduler.setRepos([a]);
    await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()]);

    expect(calls).toBe(1);
  });

  it('reflects an updated repo list on the next tick', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');
    const batches: RepoStatus[][] = [];

    scheduler = new Scheduler({ onResults: (s) => batches.push([...s]) });
    scheduler.setRepos([]);
    await scheduler.tick();
    scheduler.setRepos([mine]);
    await scheduler.tick();

    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]?.state).toBe('behind');
  });
});
