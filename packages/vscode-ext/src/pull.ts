import { GitError, runGit, stashChanges, type RepoStatus } from '@repo-sentry/core';

export interface PullOutcome {
  readonly repo: string;
  readonly ok: boolean;
  readonly error?: string;
  /** True when uncommitted changes were stashed before this pull ran. */
  readonly stashed?: boolean;
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

/**
 * Used once the developer has confirmed it — stashes uncommitted changes
 * first, so the pull that follows always lands on a clean tree. The stash is
 * never popped automatically; the developer restores it with
 * `git stash pop` once they've seen the pull succeed.
 */
export async function stashAndPull(status: RepoStatus): Promise<PullOutcome> {
  let stashed = false;
  try {
    stashed = (await stashChanges(status.path)).stashed;
  } catch (err) {
    const e = err as GitError;
    return {
      repo: status.name,
      ok: false,
      error: `stash failed: ${e.stderr !== '' ? e.stderr : e.message}`,
    };
  }

  return { ...(await pullFastForward(status)), stashed };
}

export async function pullAll(statuses: readonly RepoStatus[]): Promise<PullOutcome[]> {
  const outcomes: PullOutcome[] = [];
  for (const status of statuses) {
    outcomes.push(await pullFastForward(status));
  }
  return outcomes;
}
