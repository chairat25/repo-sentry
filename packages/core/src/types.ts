export type RepoState =
  | 'synced' // behind === 0 && ahead === 0
  | 'behind' // behind > 0, ahead === 0
  | 'diverged' // behind > 0 && ahead > 0
  | 'ahead' // ahead > 0, behind === 0
  | 'no-upstream' // current branch has no tracking branch
  | 'detached' // detached HEAD
  | 'unreachable'; // fetch failed (network, auth, timeout)

export interface RepoStatus {
  /** Absolute path to the repository root. */
  readonly path: string;
  /** Basename of `path`, used for display. */
  readonly name: string;
  /** Current branch, or null when HEAD is detached. */
  readonly branch: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly state: RepoState;
  /** ISO-8601 timestamp of this analysis. */
  readonly checkedAt: string;
  /** Populated only when state === 'unreachable'. */
  readonly error?: string;
}

export interface AnalyzeOptions {
  /** Run `git fetch` before counting. Defaults to true. */
  readonly fetch?: boolean;
  /** Timeout for the fetch call. Defaults to 15000. */
  readonly fetchTimeoutMs?: number;
  /** Max repositories analyzed in parallel by analyzeAll. Defaults to 4. */
  readonly concurrency?: number;
}

/** A repository in one of the two states that require the developer to pull. */
export function isStale(status: RepoStatus): boolean {
  return status.state === 'behind' || status.state === 'diverged';
}
