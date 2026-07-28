import { afterEach, describe, expect, it } from 'vitest';
import { GitError, runGit } from '../src/git.js';
import { makeClone, makeFixture, type Fixture } from './helpers/repo-fixture.js';

let fx: Fixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

describe('runGit', () => {
  it('returns trimmed stdout for a successful command', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');

    const result = await runGit(repo, ['symbolic-ref', '--short', 'HEAD']);

    expect(result.stdout).toBe('dev');
  });

  it('throws GitError with code "failed" when git exits non-zero', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');

    await expect(runGit(repo, ['rev-parse', 'no-such-ref'])).rejects.toSatisfy(
      (err: unknown) => err instanceof GitError && err.code === 'failed',
    );
  });

  it('throws GitError with code "not-found" when the binary is missing', async () => {
    fx = await makeFixture();

    await expect(runGit('/definitely/not/a/directory', ['status'])).rejects.toBeInstanceOf(
      GitError,
    );
  });

  it('throws GitError with code "timeout" when the command exceeds the budget', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'clone-a');

    // `git fetch` against a nonexistent path fails fast, so drive the timeout
    // with a command that sleeps instead.
    await expect(
      runGit(repo, ['-c', 'alias.slow=!sleep 3', 'slow'], 200),
    ).rejects.toSatisfy((err: unknown) => err instanceof GitError && err.code === 'timeout');
  });
});
