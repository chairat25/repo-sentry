import { afterEach, describe, expect, it } from 'vitest';
import { analyzeRepo } from '@repo-sentry/core';
import { pullAll, pullFastForward } from '../src/pull.js';
import {
  commitAndPush,
  commitLocal,
  makeClone,
  makeFixture,
  type Fixture,
} from '../../core/test/helpers/repo-fixture.js';

let fx: Fixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

describe('pullFastForward', () => {
  it('fast-forwards a repo that is only behind', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');
    const before = await analyzeRepo(mine);

    const outcome = await pullFastForward(before);

    expect(outcome.ok).toBe(true);
    expect((await analyzeRepo(mine)).state).toBe('synced');
  });

  it('refuses to merge a diverged branch and reports the git error', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'theirs.txt');
    await commitLocal(mine, 'mine.txt');
    const before = await analyzeRepo(mine);

    const outcome = await pullFastForward(before);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    // The local commit must survive — nothing was merged or rebased.
    expect((await analyzeRepo(mine)).state).toBe('diverged');
  });

  it('reports failure when the remote is unreachable', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const status = await analyzeRepo(mine, { fetch: false });
    await fx.cleanup();
    fx = null;

    const outcome = await pullFastForward(status);

    expect(outcome.ok).toBe(false);
  });
});

describe('pullAll', () => {
  it('returns one outcome per repo', async () => {
    fx = await makeFixture();
    const a = await makeClone(fx, 'a');
    const b = await makeClone(fx, 'b');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'x.txt');

    const outcomes = await pullAll([await analyzeRepo(a), await analyzeRepo(b)]);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(outcomes.map((o) => o.repo)).toEqual(['a', 'b']);
  });

  it('returns an empty array for no targets', async () => {
    expect(await pullAll([])).toEqual([]);
  });
});
