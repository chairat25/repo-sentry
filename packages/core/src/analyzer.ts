import { basename } from 'node:path';
import { DEFAULT_CMD_TIMEOUT_MS, GitError, runGit } from './git.js';
import type { AnalyzeOptions, RepoState, RepoStatus } from './types.js';

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_CONCURRENCY = 4;

export function deriveState(ahead: number, behind: number): RepoState {
  if (behind > 0 && ahead > 0) return 'diverged';
  if (behind > 0) return 'behind';
  if (ahead > 0) return 'ahead';
  return 'synced';
}

export async function analyzeRepo(
  repoPath: string,
  opts: AnalyzeOptions = {},
): Promise<RepoStatus> {
  const shouldFetch = opts.fetch ?? true;
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const base = {
    path: repoPath,
    name: basename(repoPath),
    checkedAt: new Date().toISOString(),
    ahead: 0,
    behind: 0,
  };

  const branch = await readBranch(repoPath);
  if (branch === null) return { ...base, branch: null, remote: null, state: 'detached' };

  const upstream = await readUpstream(repoPath);
  if (upstream === null) return { ...base, branch, remote: null, state: 'no-upstream' };

  const remote = remoteOf(upstream);

  if (shouldFetch) {
    const failure = await tryFetch(repoPath, remote, remoteBranchOf(upstream), fetchTimeoutMs);
    if (failure !== null) {
      return { ...base, branch, remote, state: 'unreachable', error: failure };
    }
  }

  const { ahead, behind } = await countDivergence(repoPath, upstream);
  return { ...base, branch, remote, ahead, behind, state: deriveState(ahead, behind) };
}

export async function analyzeAll(
  repoPaths: readonly string[],
  opts: AnalyzeOptions = {},
): Promise<RepoStatus[]> {
  if (repoPaths.length === 0) return [];

  const limit = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, repoPaths.length));
  const results: RepoStatus[] = new Array(repoPaths.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const path = repoPaths[index];
      if (path === undefined) return;
      results[index] = await analyzeRepo(path, opts);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

/** Returns the current branch, or null when HEAD is detached. */
async function readBranch(repoPath: string): Promise<string | null> {
  try {
    // -q makes git exit 1 silently on a detached HEAD instead of printing.
    const { stdout } = await runGit(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD']);
    return stdout === '' ? null : stdout;
  } catch {
    return null;
  }
}

/** Returns the upstream ref (e.g. "origin/dev"), or null when there is none. */
async function readUpstream(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(repoPath, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{u}',
    ]);
    return stdout === '' ? null : stdout;
  } catch {
    return null;
  }
}

/**
 * Splits "origin/dev" into its remote name. Never assume the remote is called
 * "origin" — a repo can track any remote, and forks commonly track "upstream".
 */
function remoteOf(upstream: string): string {
  const slash = upstream.indexOf('/');
  return slash === -1 ? 'origin' : upstream.slice(0, slash);
}

/**
 * Splits "origin/dev" into the branch name on the remote. This can differ
 * from the local branch name — `git checkout -b my-name --track origin/dev`
 * produces exactly that — so fetching the local branch name instead of this
 * fails with "couldn't find remote ref", misreporting a perfectly reachable
 * repo as `unreachable`.
 */
function remoteBranchOf(upstream: string): string {
  const slash = upstream.indexOf('/');
  return slash === -1 ? upstream : upstream.slice(slash + 1);
}

/** Returns null on success, or the error text on failure. */
async function tryFetch(
  repoPath: string,
  remote: string,
  branch: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    await runGit(repoPath, ['fetch', '--quiet', remote, branch], timeoutMs);
    return null;
  } catch (err) {
    const e = err as GitError;
    return e.stderr !== '' ? e.stderr : e.message;
  }
}

async function countDivergence(
  repoPath: string,
  upstream: string,
): Promise<{ ahead: number; behind: number }> {
  const { stdout } = await runGit(
    repoPath,
    ['rev-list', '--left-right', '--count', `HEAD...${upstream}`],
    DEFAULT_CMD_TIMEOUT_MS,
  );
  const [aheadRaw, behindRaw] = stdout.split(/\s+/);
  return { ahead: Number(aheadRaw ?? 0), behind: Number(behindRaw ?? 0) };
}
