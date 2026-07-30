import { afterEach, describe, expect, it } from 'vitest';
import { runGit } from '@repo-sentry/core';
import { runCheck } from '../src/check.js';
import { formatBlockMessage } from '../src/format.js';
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

describe('runCheck', () => {
  it('exits 0 when the repo is synced', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');

    const result = await runCheck({ path: repo });

    expect(result.exitCode).toBe(0);
  });

  it('exits 1 when the repo is behind', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');

    const result = await runCheck({ path: mine });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('1 commit behind');
  });

  it('exits 1 when the repo is diverged', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'theirs.txt');
    await commitLocal(mine, 'mine.txt');

    expect((await runCheck({ path: mine })).exitCode).toBe(1);
  });

  it('exits 0 when the repo is only ahead', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    await commitLocal(mine, 'mine.txt');

    expect((await runCheck({ path: mine })).exitCode).toBe(0);
  });

  it('exits 0 when the remote is unreachable, so offline work is not blocked', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    await runGit(mine, ['remote', 'set-url', 'origin', '/nonexistent/remote.git']);

    expect((await runCheck({ path: mine })).exitCode).toBe(0);
  });

  it('exits 0 for a branch with no upstream', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    await runGit(mine, ['checkout', '-b', 'feat/local-only']);

    expect((await runCheck({ path: mine })).exitCode).toBe(0);
  });

  it('emits parseable JSON when json is set', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');

    const result = await runCheck({ path: mine, json: true });
    const parsed: unknown = JSON.parse(result.output);

    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as { state: string }[])[0]?.state).toBe('behind');
  });

  it('produces no output when quiet is set', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');

    const result = await runCheck({ path: mine, quiet: true });

    expect(result.output).toBe('');
    expect(result.exitCode).toBe(1);
  });

  it('uses push wording when the push stage is requested', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');

    const result = await runCheck({ path: mine, stage: 'push' });

    expect(result.output).toContain('will be rejected');
    expect(result.output).toContain('git push --no-verify');
    expect(result.output).not.toContain('before committing');
  });

  it('defaults to commit wording', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');

    const result = await runCheck({ path: mine });

    expect(result.output).toContain('before committing');
  });

  it('detects a teammate push on a freshly cloned repo, without relying on cached refs', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    // `mine` has never fetched since this push, so only a live fetch can see it.
    await commitAndPush(theirs, 'a.txt');

    const result = await runCheck({ path: mine, fetchTimeoutMs: 3_000 });

    expect(result.exitCode).toBe(1);
  });

  it('discovers every repo below the path when the path is not itself a repo', async () => {
    fx = await makeFixture();
    await makeClone(fx, 'a');
    await makeClone(fx, 'b');

    const result = await runCheck({ path: fx.root, json: true });

    // The fixture root also holds the bare remote and the seed clone.
    const parsed = JSON.parse(result.output) as { name: string }[];
    expect(parsed.map((s) => s.name)).toEqual(expect.arrayContaining(['a', 'b']));
  });
});

describe('formatBlockMessage', () => {
  it('tells the developer to pull before committing', () => {
    const message = formatBlockMessage(
      {
        path: '/x/service-a',
        name: 'service-a',
        branch: 'dev',
        ahead: 0,
        behind: 3,
        state: 'behind',
        checkedAt: '2026-07-28T00:00:00.000Z',
      },
      'commit',
    );

    expect(message).toContain('service-a');
    expect(message).toContain('3 commits behind');
    expect(message).toContain('git pull --rebase');
    expect(message).toContain('git commit --no-verify');
  });

  it('warns that the push will be rejected', () => {
    const message = formatBlockMessage(
      {
        path: '/x/service-a',
        name: 'service-a',
        branch: 'dev',
        ahead: 1,
        behind: 3,
        state: 'diverged',
        checkedAt: '2026-07-28T00:00:00.000Z',
      },
      'push',
    );

    expect(message).toContain('will be rejected');
    expect(message).toContain('git push --no-verify');
  });

  it('uses the singular form for a single commit', () => {
    const message = formatBlockMessage(
      {
        path: '/x/service-b',
        name: 'service-b',
        branch: 'dev',
        ahead: 0,
        behind: 1,
        state: 'behind',
        checkedAt: '2026-07-28T00:00:00.000Z',
      },
      'commit',
    );

    expect(message).toContain('1 commit behind');
    expect(message).not.toContain('1 commits');
  });
});
