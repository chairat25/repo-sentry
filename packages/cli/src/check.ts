import { resolve } from 'node:path';
import { analyzeAll, discoverRepos, isStale, type RepoStatus } from '@repo-sentry/core';
import { formatBlockMessage } from './format.js';

/**
 * `undefined` is spelled out on every field because `parseArgs` hands back
 * `string | undefined` for absent flags, and `exactOptionalPropertyTypes`
 * distinguishes "absent" from "present and undefined".
 */
export interface CheckOptions {
  /** Directory to check. Defaults to the current working directory. */
  readonly path?: string | undefined;
  readonly json?: boolean | undefined;
  readonly noFetch?: boolean | undefined;
  readonly quiet?: boolean | undefined;
}

export interface CheckResult {
  readonly exitCode: 0 | 1 | 2;
  readonly output: string;
}

/**
 * Exit 1 only for `behind` and `diverged`. `unreachable` must never block —
 * a developer working offline still has to be able to commit.
 */
export async function runCheck(opts: CheckOptions = {}): Promise<CheckResult> {
  const root = resolve(opts.path ?? process.cwd());

  let repos: string[];
  try {
    repos = await discoverRepos([root]);
  } catch (err) {
    return { exitCode: 2, output: `repo-sentry: discovery failed — ${String(err)}` };
  }

  if (repos.length === 0) return { exitCode: 0, output: '' };

  const statuses: RepoStatus[] = await analyzeAll(repos, { fetch: opts.noFetch !== true });
  const stale = statuses.filter(isStale);
  const exitCode = stale.length > 0 ? 1 : 0;

  if (opts.json === true) {
    return { exitCode, output: JSON.stringify(statuses, null, 2) };
  }
  if (opts.quiet === true) {
    return { exitCode, output: '' };
  }
  if (stale.length === 0) {
    return { exitCode, output: '' };
  }

  const output = stale.map((s) => formatBlockMessage(s, 'commit')).join('\n');
  return { exitCode, output };
}
