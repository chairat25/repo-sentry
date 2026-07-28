import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGit } from '@repo-sentry/core';
import { runGuard } from '../src/guard.js';
import { readBlocked } from '../src/marker.js';
import {
  commitAndPush,
  commitLocal,
  makeClone,
  makeFixture,
  type Fixture,
} from '../../core/test/helpers/repo-fixture.js';

let fx: Fixture | null = null;
let home = '';

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'guard-home-'));
});
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
  await rm(home, { recursive: true, force: true });
  home = '';
});

describe('runGuard', () => {
  it('allows boot when the repo is synced', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');

    const result = await runGuard({ path: repo, home });

    expect(result.exitCode).toBe(0);
    expect(await readBlocked(home)).toEqual([]);
  });

  it('refuses boot when the repo is behind', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');

    const result = await runGuard({ path: mine, home });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('mine');
    expect(result.output).toContain('1 commit behind');
  });

  it('refuses boot when the repo is diverged', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'theirs.txt');
    await commitLocal(mine, 'mine.txt');

    expect((await runGuard({ path: mine, home })).exitCode).toBe(1);
  });

  it('records the blocked repo so the editor can raise a modal', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');
    await commitAndPush(theirs, 'b.txt');

    await runGuard({ path: mine, home });

    const blocked = await readBlocked(home);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.name).toBe('mine');
    expect(blocked[0]?.behind).toBe(2);
  });

  it('clears its own marker once the repo is pulled', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');
    await runGuard({ path: mine, home });
    await runGit(mine, ['pull', '--ff-only']);

    const result = await runGuard({ path: mine, home });

    expect(result.exitCode).toBe(0);
    expect(await readBlocked(home)).toEqual([]);
  });

  it('allows boot when the repo is only ahead', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    await commitLocal(mine, 'mine.txt');

    expect((await runGuard({ path: mine, home })).exitCode).toBe(0);
  });

  it('allows boot when the remote is unreachable', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    await runGit(mine, ['remote', 'set-url', 'origin', '/nonexistent/remote.git']);

    expect((await runGuard({ path: mine, home })).exitCode).toBe(0);
  });

  it('allows boot for a branch with no upstream', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    await runGit(mine, ['checkout', '-b', 'feat/local-only']);

    expect((await runGuard({ path: mine, home })).exitCode).toBe(0);
  });

  it('allows boot outside a git repository', async () => {
    const notARepo = await mkdtemp(join(tmpdir(), 'not-a-repo-'));

    const result = await runGuard({ path: notARepo, home });

    expect(result.exitCode).toBe(0);
    await rm(notARepo, { recursive: true, force: true });
  });

  it('is bypassed by the skip flag', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');

    const result = await runGuard({ path: mine, home, skip: true });

    expect(result.exitCode).toBe(0);
    expect(await readBlocked(home)).toEqual([]);
  });

  it('checks only the repo it was given, not its siblings', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const other = await makeClone(fx, 'other');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');
    // `other` is also behind, but booting `mine` must not care.
    void other;

    await runGuard({ path: mine, home });

    expect((await readBlocked(home)).map((r) => r.name)).toEqual(['mine']);
  });

  it('names the reason the block matters', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');

    const result = await runGuard({ path: mine, home });

    expect(result.output).toContain('git pull --rebase');
    expect(result.output).toContain('REPO_SENTRY_SKIP=1');
  });
});
