import { GitError, runGit, type RepoStatus } from '@repo-sentry/core';

export interface PullOutcome {
  readonly repo: string;
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Fast-forward only. If the branch has diverged, report and stop — choosing
 * merge or rebase on the developer's behalf is how working trees get wrecked.
 */
export async function pullFastForward(status: RepoStatus): Promise<PullOutcome> {
  try {
    await runGit(status.path, ['pull', '--ff-only'], 30_000);
    return { repo: status.name, ok: true };
  } catch (err) {
    const e = err as GitError;
    return { repo: status.name, ok: false, error: e.stderr !== '' ? e.stderr : e.message };
  }
}

export async function pullAll(statuses: readonly RepoStatus[]): Promise<PullOutcome[]> {
  const outcomes: PullOutcome[] = [];
  for (const status of statuses) {
    outcomes.push(await pullFastForward(status));
  }
  return outcomes;
}
