import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { minimatch } from 'minimatch';

export const DEFAULT_MAX_DEPTH = 2;

/**
 * Directories that never contain a repository worth watching, and that are
 * expensive to walk.
 */
const PRUNED = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'vendor',
  'coverage',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
]);

/**
 * Walks each root looking for git repositories.
 *
 * A directory containing `.git` is reported and not descended into — a repo's
 * own subdirectories are part of that repo, not separate repos.
 */
export async function discoverRepos(
  roots: readonly string[],
  maxDepth: number = DEFAULT_MAX_DEPTH,
  exclude: readonly string[] = [],
): Promise<string[]> {
  const found = new Set<string>();

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (await isRepo(dir)) {
      found.add(dir);
      return;
    }
    if (depth >= maxDepth) return;

    const entries = await readDirSafe(dir);
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !PRUNED.has(entry.name))
        .map((entry) => walk(join(dir, entry.name), depth + 1)),
    );
  };

  await Promise.all(roots.map((root) => walk(root, 0)));

  return [...found]
    .filter((path) => !exclude.some((pattern) => minimatch(path, pattern)))
    .sort();
}

async function isRepo(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable or nonexistent directory — nothing to discover here.
    return [];
  }
}
