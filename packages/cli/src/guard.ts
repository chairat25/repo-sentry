import { resolve } from 'node:path';
import { analyzeRepo, isStale, runGit } from '@repo-sentry/core';
import { blockRepo, unblockRepo } from './marker.js';
import { pluralCommits } from './format.js';

/** Boot-time fetch budget. Booting is already slow; a few seconds is affordable. */
export const GUARD_FETCH_TIMEOUT_MS = 8_000;

export interface GuardOptions {
  /** Directory to guard. Defaults to the current working directory. */
  readonly path?: string | undefined;
  /** Bypass entirely. Wired to the REPO_SENTRY_SKIP environment variable. */
  readonly skip?: boolean | undefined;
  /** Override the home directory that holds the marker file. Tests only. */
  readonly home?: string | undefined;
  readonly fetchTimeoutMs?: number | undefined;
}

export interface GuardResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
}

/**
 * Refuses to let a service boot against a stale checkout.
 *
 * This exists because these services run TypeORM with `synchronize: true`, so
 * booting with stale entities makes the ORM drop columns a teammate added.
 * The data is gone and cannot be backfilled — that is why this blocks rather
 * than warns.
 *
 * Guards exactly one repository: the one being booted. A sibling service being
 * behind is not this boot's problem.
 */
export async function runGuard(opts: GuardOptions = {}): Promise<GuardResult> {
  if (opts.skip === true) return { exitCode: 0, output: '' };

  const start = resolve(opts.path ?? process.cwd());
  const repoRoot = await findRepoRoot(start);
  // Not a git repository — nothing to be stale against.
  if (repoRoot === null) return { exitCode: 0, output: '' };

  const status = await analyzeRepo(repoRoot, {
    fetch: true,
    fetchTimeoutMs: opts.fetchTimeoutMs ?? GUARD_FETCH_TIMEOUT_MS,
  });

  if (!isStale(status)) {
    // Whatever blocked a previous attempt is resolved; stop advertising it.
    await unblockRepo(repoRoot, opts.home);
    return { exitCode: 0, output: '' };
  }

  await blockRepo(status, opts.home);
  return { exitCode: 1, output: formatGuardMessage(status.name, status.branch, status.behind) };
}

/**
 * Resolves the repository root from any directory inside it, so the guard
 * works from a subdirectory of the service.
 */
async function findRepoRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(dir, ['rev-parse', '--show-toplevel']);
    return stdout === '' ? null : stdout;
  } catch {
    return null;
  }
}

export function formatGuardMessage(
  name: string,
  branch: string | null,
  behind: number,
): string {
  const upstream = `origin/${branch ?? 'HEAD'}`;
  return [
    '',
    '  ╭──────────────────────────────────────────────────────────────╮',
    '  │  BOOT BLOCKED — repo-sentry                                  │',
    '  ╰──────────────────────────────────────────────────────────────╯',
    '',
    `  ${name} is ${pluralCommits(behind)} behind ${upstream}.`,
    '',
    '  Starting now would run against stale entities. With TypeORM',
    '  synchronize enabled that drops columns your teammates added,',
    '  and the data in them cannot be recovered.',
    '',
    '  Pull first:',
    '    git pull --rebase',
    '',
    '  Start anyway (you accept the risk):',
    '    REPO_SENTRY_SKIP=1 <your start command>',
    '',
  ].join('\n');
}
