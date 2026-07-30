import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blockRepo, markerPath, readBlocked, unblockRepo } from '../src/marker.js';

let home = '';
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'marker-home-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  home = '';
});

const entry = (name: string, behind = 3) => ({
  path: `/x/${name}`,
  name,
  branch: 'dev',
  remote: 'origin',
  ahead: 0,
  behind,
  state: 'behind' as const,
  checkedAt: '2026-07-28T00:00:00.000Z',
});

describe('readBlocked', () => {
  it('returns an empty list when the file does not exist', async () => {
    expect(await readBlocked(home)).toEqual([]);
  });

  it('returns an empty list when the file is unparseable', async () => {
    // A half-written file must never crash a commit or a boot.
    await writeFile(markerPath(home), '{ not json', 'utf8').catch(async () => {
      await blockRepo(entry('seed'), home);
      await writeFile(markerPath(home), '{ not json', 'utf8');
    });

    expect(await readBlocked(home)).toEqual([]);
  });

  it('returns an empty list when the payload is the wrong shape', async () => {
    await blockRepo(entry('seed'), home);
    await writeFile(markerPath(home), JSON.stringify({ version: 1, repos: 'nope' }), 'utf8');

    expect(await readBlocked(home)).toEqual([]);
  });
});

describe('blockRepo', () => {
  it('records a blocked repo', async () => {
    await blockRepo(entry('service-a'), home);

    const blocked = await readBlocked(home);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.name).toBe('service-a');
    expect(blocked[0]?.behind).toBe(3);
    expect(blocked[0]?.blockedAt).toBeTruthy();
  });

  it('creates the directory when it does not exist', async () => {
    await blockRepo(entry('a'), home);

    await expect(readFile(markerPath(home), 'utf8')).resolves.toContain('a');
  });

  it('keeps entries for other repos', async () => {
    await blockRepo(entry('a'), home);
    await blockRepo(entry('b'), home);

    expect((await readBlocked(home)).map((r) => r.name).sort()).toEqual(['a', 'b']);
  });

  it('replaces the entry for the same repo instead of duplicating it', async () => {
    await blockRepo(entry('a', 1), home);
    await blockRepo(entry('a', 4), home);

    const blocked = await readBlocked(home);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.behind).toBe(4);
  });
});

describe('unblockRepo', () => {
  it('removes only the named repo', async () => {
    await blockRepo(entry('a'), home);
    await blockRepo(entry('b'), home);

    await unblockRepo('/x/a', home);

    expect((await readBlocked(home)).map((r) => r.name)).toEqual(['b']);
  });

  it('is a no-op when the repo was never blocked', async () => {
    await blockRepo(entry('a'), home);

    await unblockRepo('/x/never', home);

    expect(await readBlocked(home)).toHaveLength(1);
  });

  it('is a no-op when the file does not exist', async () => {
    await expect(unblockRepo('/x/a', home)).resolves.toBeUndefined();
  });
});
