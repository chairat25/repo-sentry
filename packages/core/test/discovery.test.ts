import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverRepos } from '../src/discovery.js';

let root = '';
afterEach(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true });
  root = '';
});

/** Creates a directory that looks like a git repo to the discovery walker. */
async function fakeRepo(...segments: string[]): Promise<string> {
  const path = join(root, ...segments);
  await mkdir(join(path, '.git'), { recursive: true });
  await writeFile(join(path, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
  return path;
}

describe('discoverRepos', () => {
  it('finds every repo one level below the root', async () => {
    root = await mkdtemp(join(tmpdir(), 'discovery-'));
    const a = await fakeRepo('service-a');
    const b = await fakeRepo('service-b');

    expect(await discoverRepos([root])).toEqual([a, b].sort());
  });

  it('finds the root itself when the root is a repo', async () => {
    root = await mkdtemp(join(tmpdir(), 'discovery-'));
    await mkdir(join(root, '.git'), { recursive: true });

    expect(await discoverRepos([root])).toEqual([root]);
  });

  it('does not descend into a repo it has already found', async () => {
    root = await mkdtemp(join(tmpdir(), 'discovery-'));
    const outer = await fakeRepo('outer');
    await fakeRepo('outer', 'nested');

    expect(await discoverRepos([root])).toEqual([outer]);
  });

  it('respects maxDepth', async () => {
    root = await mkdtemp(join(tmpdir(), 'discovery-'));
    await fakeRepo('a', 'b', 'c', 'deep');

    expect(await discoverRepos([root], 2)).toEqual([]);
  });

  it('prunes node_modules and other build directories', async () => {
    root = await mkdtemp(join(tmpdir(), 'discovery-'));
    await fakeRepo('node_modules', 'some-pkg');
    await fakeRepo('dist', 'bundled');
    const real = await fakeRepo('service-a');

    expect(await discoverRepos([root])).toEqual([real]);
  });

  it('applies exclude glob patterns', async () => {
    root = await mkdtemp(join(tmpdir(), 'discovery-'));
    const keep = await fakeRepo('keep-me');
    await fakeRepo('drop-me');

    expect(await discoverRepos([root], 2, ['**/drop-*'])).toEqual([keep]);
  });

  it('deduplicates when two roots overlap', async () => {
    root = await mkdtemp(join(tmpdir(), 'discovery-'));
    const a = await fakeRepo('service-a');

    expect(await discoverRepos([root, root])).toEqual([a]);
  });

  it('ignores roots that do not exist', async () => {
    root = await mkdtemp(join(tmpdir(), 'discovery-'));

    expect(await discoverRepos([join(root, 'nope')])).toEqual([]);
  });
});
