import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGit } from '../src/git.js';
import { isDirty, stashChanges } from '../src/working-tree.js';
import { commitLocal, makeClone, makeFixture, type Fixture } from './helpers/repo-fixture.js';

let fx: Fixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

describe('isDirty', () => {
  it('is false for a fresh clone', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');

    expect(await isDirty(repo)).toBe(false);
  });

  it('is true when a tracked file has an uncommitted edit', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    await writeFile(join(repo, 'README.md'), 'edited\n');

    expect(await isDirty(repo)).toBe(true);
  });

  it('is true when there is an untracked file', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    await writeFile(join(repo, 'new-file.txt'), 'new\n');

    expect(await isDirty(repo)).toBe(true);
  });

  it('is false again once the change is committed', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    await commitLocal(repo, 'a.txt');

    expect(await isDirty(repo)).toBe(false);
  });
});

describe('stashChanges', () => {
  it('does nothing on a clean tree', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');

    const result = await stashChanges(repo);

    expect(result.stashed).toBe(false);
    const { stdout } = await runGit(repo, ['stash', 'list']);
    expect(stdout).toBe('');
  });

  it('stashes an uncommitted edit and leaves the tree clean', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    await writeFile(join(repo, 'README.md'), 'edited\n');

    const result = await stashChanges(repo);

    expect(result.stashed).toBe(true);
    expect(await isDirty(repo)).toBe(false);
  });

  it('stashes untracked files too', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    await writeFile(join(repo, 'new-file.txt'), 'new\n');

    await stashChanges(repo);

    expect(await isDirty(repo)).toBe(false);
  });

  it('records a message identifying repo-sentry as the source of the stash', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    await writeFile(join(repo, 'README.md'), 'edited\n');

    await stashChanges(repo);

    const { stdout } = await runGit(repo, ['stash', 'list']);
    expect(stdout).toContain('repo-sentry');
  });

  it('is fully recoverable with git stash pop', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    await writeFile(join(repo, 'README.md'), 'edited\n');

    await stashChanges(repo);
    await runGit(repo, ['stash', 'pop']);

    expect(await isDirty(repo)).toBe(true);
  });

  it('lets a fast-forward pull proceed after stashing a non-conflicting change', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    const theirs = await makeClone(fx, 'theirs');
    await commitLocal(theirs, 'their-file.txt');
    await runGit(theirs, ['push', 'origin', 'HEAD']);
    await writeFile(join(mine, 'my-scratch.txt'), 'scratch\n');

    await stashChanges(mine);
    await runGit(mine, ['pull', '--ff-only']);
    await runGit(mine, ['stash', 'pop']);

    expect(await isDirty(mine)).toBe(true);
  });
});
