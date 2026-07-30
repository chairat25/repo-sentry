import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RepoStatus } from './types.js';

/**
 * The bridge between the terminal and the editor.
 *
 * `repo-sentry guard` runs in a shell and cannot talk to the editor directly,
 * so it records what it blocked here. The extension watches this file and
 * raises a modal.
 */
export const MARKER_DIR = '.repo-sentry';
export const MARKER_FILE = 'blocked.json';

export interface BlockedRepo {
  readonly path: string;
  readonly name: string;
  readonly branch: string | null;
  /** The remote this branch tracks (e.g. "origin"), or null when there is none. */
  readonly remote: string | null;
  readonly ahead: number;
  readonly behind: number;
  /** ISO-8601 timestamp of the boot attempt that was refused. */
  readonly blockedAt: string;
}

interface MarkerFile {
  readonly version: 1;
  readonly repos: readonly BlockedRepo[];
}

export function markerDir(home: string = homedir()): string {
  return join(home, MARKER_DIR);
}

export function markerPath(home: string = homedir()): string {
  return join(markerDir(home), MARKER_FILE);
}

/**
 * Never throws. A missing, half-written, or malformed marker must not be able
 * to break a boot — the worst acceptable outcome is "no block".
 */
export async function readBlocked(home: string = homedir()): Promise<BlockedRepo[]> {
  let raw: string;
  try {
    raw = await readFile(markerPath(home), 'utf8');
  } catch {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const repos = (parsed as Partial<MarkerFile> | null)?.repos;
    if (!Array.isArray(repos)) return [];
    return repos.filter(isBlockedRepo);
  } catch {
    return [];
  }
}

export async function blockRepo(status: RepoStatus, home: string = homedir()): Promise<void> {
  const others = (await readBlocked(home)).filter((r) => r.path !== status.path);
  const entry: BlockedRepo = {
    path: status.path,
    name: status.name,
    branch: status.branch,
    remote: status.remote,
    ahead: status.ahead,
    behind: status.behind,
    blockedAt: new Date().toISOString(),
  };
  await write([...others, entry], home);
}

export async function unblockRepo(repoPath: string, home: string = homedir()): Promise<void> {
  const remaining = (await readBlocked(home)).filter((r) => r.path !== repoPath);
  if (remaining.length === 0) {
    // Remove the file entirely so the watcher sees a clean state rather than
    // an empty list it has to special-case.
    await rm(markerPath(home), { force: true });
    return;
  }
  await write(remaining, home);
}

/**
 * Writes via a temp file and rename so a reader never observes a partial
 * document — the guard writes this from a different process than the one
 * watching it.
 */
async function write(repos: readonly BlockedRepo[], home: string): Promise<void> {
  const dir = markerDir(home);
  await mkdir(dir, { recursive: true });
  const payload: MarkerFile = { version: 1, repos };
  const tmp = join(dir, `${MARKER_FILE}.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await rename(tmp, markerPath(home));
}

function isBlockedRepo(value: unknown): value is BlockedRepo {
  const r = value as Partial<BlockedRepo> | null;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.path === 'string' &&
    typeof r.name === 'string' &&
    typeof r.behind === 'number'
  );
}
