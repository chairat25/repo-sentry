import { runGit } from './git.js';

/**
 * True when the working tree has anything not committed — staged, unstaged,
 * or untracked.
 *
 * `git pull --ff-only` already refuses on its own when an incoming change
 * would overwrite an uncommitted one — nothing here changes that safety.
 * This exists for the quieter case: an uncommitted change that pull *can*
 * carry forward without conflict, silently. That's technically safe but easy
 * to lose track of, so callers use this to warn before it happens.
 */
export async function isDirty(repoPath: string): Promise<boolean> {
  const { stdout } = await runGit(repoPath, ['status', '--porcelain']);
  return stdout.length > 0;
}

export interface StashResult {
  /** False when the tree was already clean — stashing was a no-op. */
  readonly stashed: boolean;
}

const STASH_MESSAGE = 'repo-sentry: auto-stash before pull';

/**
 * Stashes tracked and untracked changes so a pull can proceed on a clean
 * tree. Tagged with STASH_MESSAGE so `git stash list` reads as something
 * repo-sentry put there, not a stash the developer forgot about.
 */
export async function stashChanges(repoPath: string): Promise<StashResult> {
  if (!(await isDirty(repoPath))) return { stashed: false };
  await runGit(repoPath, [
    'stash',
    'push',
    '--include-untracked',
    '-m',
    STASH_MESSAGE,
  ]);
  return { stashed: true };
}
