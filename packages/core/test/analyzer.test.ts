import { afterEach, describe, expect, it } from 'vitest';
import { analyzeAll, analyzeRepo, deriveState } from '../src/analyzer.js';
import { runGit } from '../src/git.js';
import {
  commitAndPush,
  commitLocal,
  makeClone,
  makeFixture,
  type Fixture,
} from './helpers/repo-fixture.js';

let fx: Fixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

describe('deriveState', () => {
  it('returns synced when neither side has commits', () => {
    expect(deriveState(0, 0)).toBe('synced');
  });

  it('returns behind when only the remote has commits', () => {
    expect(deriveState(0, 3)).toBe('behind');
  });

  it('returns ahead when only the local side has commits', () => {
    expect(deriveState(2, 0)).toBe('ahead');
  });

  it('returns diverged when both sides have commits', () => {
    expect(deriveState(2, 3)).toBe('diverged');
  });
});

describe('analyzeRepo', () => {
  it('reports synced for a fresh clone', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');

    const status = await analyzeRepo(repo);

    expect(status.state).toBe('synced');
    expect(status.branch).toBe('dev');
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
    expect(status.name).toBe('clone-a');
  });

  it('reports behind with the exact count after a teammate pushes', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');

    await commitAndPush(theirs, 'a.txt');
    await commitAndPush(theirs, 'b.txt');

    const status = await analyzeRepo(mine);

    expect(status.state).toBe('behind');
    expect(status.behind).toBe(2);
    expect(status.ahead).toBe(0);
  });

  it('reports diverged when both sides moved', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');

    await commitAndPush(theirs, 'theirs.txt');
    await commitLocal(mine, 'mine.txt');

    const status = await analyzeRepo(mine);

    expect(status.state).toBe('diverged');
    expect(status.behind).toBe(1);
    expect(status.ahead).toBe(1);
  });

  it('reports ahead when only the local side moved', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');

    await commitLocal(mine, 'mine.txt');

    const status = await analyzeRepo(mine);

    expect(status.state).toBe('ahead');
    expect(status.ahead).toBe(1);
  });

  it('reports detached when HEAD is not on a branch', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');
    const head = await runGit(repo, ['rev-parse', 'HEAD']);
    await runGit(repo, ['checkout', '--detach', head.stdout]);

    const status = await analyzeRepo(repo);

    expect(status.state).toBe('detached');
    expect(status.branch).toBeNull();
  });

  it('reports no-upstream for a branch with no tracking branch', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');
    await runGit(repo, ['checkout', '-b', 'feat/local-only']);

    const status = await analyzeRepo(repo);

    expect(status.state).toBe('no-upstream');
    expect(status.branch).toBe('feat/local-only');
  });

  it('reports the tracked remote name, not always "origin"', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    await runGit(mine, ['remote', 'rename', 'origin', 'upstream']);
    // Re-point the branch's tracking info at the renamed remote.
    await runGit(mine, ['branch', '--set-upstream-to=upstream/dev', 'dev']);
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');

    const status = await analyzeRepo(mine);

    expect(status.remote).toBe('upstream');
    expect(status.state).toBe('behind');
  });

  it('reports remote as null when there is no upstream', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');
    await runGit(repo, ['checkout', '-b', 'feat/local-only']);

    const status = await analyzeRepo(repo);

    expect(status.remote).toBeNull();
  });

  it('reports remote as null when detached', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');
    const head = await runGit(repo, ['rev-parse', 'HEAD']);
    await runGit(repo, ['checkout', '--detach', head.stdout]);

    const status = await analyzeRepo(repo);

    expect(status.remote).toBeNull();
  });

  it('reports the remote even when unreachable', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');
    await runGit(repo, ['remote', 'set-url', 'origin', '/nonexistent/remote.git']);

    const status = await analyzeRepo(repo);

    expect(status.state).toBe('unreachable');
    expect(status.remote).toBe('origin');
  });

  it('reports correctly when the local branch name differs from the remote branch it tracks', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    // A local branch named anything, tracking origin/dev under a different name —
    // this is what `git checkout -b <name> --track origin/dev` produces.
    await runGit(mine, ['checkout', '-b', 'my-local-name', '--track', 'origin/dev']);
    await commitAndPush(theirs, 'a.txt');

    const status = await analyzeRepo(mine);

    expect(status.state).toBe('behind');
    expect(status.behind).toBe(1);
    expect(status.branch).toBe('my-local-name');
  });

  it('reports unreachable and captures stderr when the remote is gone', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');
    await runGit(repo, ['remote', 'set-url', 'origin', '/nonexistent/remote.git']);

    const status = await analyzeRepo(repo);

    expect(status.state).toBe('unreachable');
    expect(status.error).toBeTruthy();
  });

  it('skips the network entirely when fetch is disabled', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'a.txt');
    // Break the remote. With fetch disabled this must not matter.
    await runGit(mine, ['remote', 'set-url', 'origin', '/nonexistent/remote.git']);

    const status = await analyzeRepo(mine, { fetch: false });

    // Cached refs are still at the seed commit, so this reads as synced.
    expect(status.state).toBe('synced');
  });

  it('does not mutate the options object it is given', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');
    const opts = { fetch: true, fetchTimeoutMs: 15_000 };
    const snapshot = { ...opts };

    await analyzeRepo(repo, opts);

    expect(opts).toEqual(snapshot);
  });
});

describe('analyzeAll', () => {
  it('returns one status per input path, in input order', async () => {
    fx = await makeFixture();
    const a = await makeClone(fx, 'a');
    const b = await makeClone(fx, 'b');
    const theirs = await makeClone(fx, 'theirs');
    await commitAndPush(theirs, 'x.txt');

    const statuses = await analyzeAll([a, b]);

    expect(statuses).toHaveLength(2);
    expect(statuses[0]?.path).toBe(a);
    expect(statuses[1]?.path).toBe(b);
    expect(statuses.every((s) => s.state === 'behind')).toBe(true);
  });

  it('returns an empty array for an empty input', async () => {
    expect(await analyzeAll([])).toEqual([]);
  });
});
